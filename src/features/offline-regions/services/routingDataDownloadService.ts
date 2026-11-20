import {
  Directory,
  DownloadTask,
  File,
  Paths,
  type DownloadPauseState,
} from 'expo-file-system';

import {
  MAX_IN_MEMORY_ARCHIVE_BYTES,
  MAX_UNCOMPRESSED_BYTES,
  MIN_FREE_STORAGE_MARGIN_BYTES,
  ROUTING_DOWNLOAD_PROGRESS_THROTTLE_MS,
} from '../config';
import {
  OfflineRegionsError,
} from '../types/offlineRegion.types';
import type {
  RoutingPackageFile,
  RoutingPackageManifest,
} from '../types/routingPackage.types';
import {
  assertValhallaEngineCompatible,
  fileUrlList,
  manifestDownloadBytes,
  validateRoutingManifest,
} from './routingPackageService';
import {
  ensureParentDirectory,
  extractZipSafely,
  fileForPackagePath,
  sha256OfFile,
  verifyPackageFiles,
} from '../utils/verifyPackage';

const OFFLINE_ROOT = 'offline-regions';
const INSTALLED_DIRECTORY = 'routing';
const STAGING_DIRECTORY = 'routing-staging';
const BACKUP_DIRECTORY = 'routing-backup';
const ARCHIVE_NAME = 'routing-package.zip';
const MANIFEST_NAME = 'manifest.json';

export type RoutingDownloadProgress = {
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
  currentFile: string | null;
};

export type RoutingDownloadCallbacks = {
  onProgress?: (progress: RoutingDownloadProgress) => void;
  onManifest?: (manifest: RoutingPackageManifest) => void;
};

export type RoutingDownloadOutcome =
  | {
      status: 'completed';
      manifest: RoutingPackageManifest;
      installedPath: string;
      sizeBytes: number;
      checksumVerified: true;
    }
  | {
      status: 'paused';
      manifest: RoutingPackageManifest;
      downloadedBytes: number;
      totalBytes: number;
    };

export type InstalledRoutingInspection =
  | {
      ok: true;
      manifest: RoutingPackageManifest;
      installedPath: string;
      sizeBytes: number;
    }
  | {
      ok: false;
      reason: string;
    };

type ActiveDownload = {
  cancelled: boolean;
  paused: boolean;
  currentTask: DownloadTask | null;
  resolveCompletion: () => void;
  completion: Promise<void>;
};

class PauseRequested extends Error {}
class CancelRequested extends Error {}

const activeDownloads = new Map<string, ActiveDownload>();
const pausedTasks = new Map<string, DownloadPauseState>();

export function isRoutingDownloadActive(regionId: string): boolean {
  return activeDownloads.has(regionId);
}

export function getOfflineRegionDirectory(regionId: string): Directory {
  return new Directory(Paths.document, OFFLINE_ROOT, regionId);
}

export function getRoutingInstalledDirectory(regionId: string): Directory {
  return new Directory(getOfflineRegionDirectory(regionId), INSTALLED_DIRECTORY);
}

export function getRoutingStagingDirectory(regionId: string): Directory {
  return new Directory(getOfflineRegionDirectory(regionId), STAGING_DIRECTORY);
}

export async function downloadRoutingPackage(input: {
  regionId: string;
  manifest: RoutingPackageManifest;
  callbacks?: RoutingDownloadCallbacks;
}): Promise<RoutingDownloadOutcome> {
  const { regionId, manifest, callbacks } = input;

  if (activeDownloads.has(regionId)) {
    throw new OfflineRegionsError(
      'duplicate',
      'Routing data for this region is already downloading.',
    );
  }

  assertValhallaEngineCompatible(manifest);

  const totalBytes = manifestDownloadBytes(manifest);
  assertStorageAvailable(regionId, totalBytes, manifest);

  const root = getOfflineRegionDirectory(regionId);
  const staging = getRoutingStagingDirectory(regionId);

  root.create({ intermediates: true, idempotent: true });
  staging.create({ intermediates: true, idempotent: true });
  await writeManifest(staging, manifest);

  let resolveCompletion = () => {};
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const active: ActiveDownload = {
    cancelled: false,
    paused: false,
    currentTask: null,
    resolveCompletion,
    completion,
  };
  activeDownloads.set(regionId, active);

  const progress = createProgressReporter(totalBytes, callbacks);
  callbacks?.onManifest?.(manifest);

  try {
    if (manifest.packageFormat === 'zip') {
      await downloadArchivePackage(regionId, manifest, active, progress);
    } else {
      await downloadDirectoryPackage(regionId, manifest, active, progress);
    }

    if (active.cancelled) {
      throw new CancelRequested();
    }
    if (active.paused) {
      throw new PauseRequested();
    }

    await writeManifest(staging, manifest);
    const installedPath = await installStaging(regionId);
    const installedDirectory = getRoutingInstalledDirectory(regionId);
    const sizeBytes = installedDirectory.size ?? manifestDownloadBytes(manifest);

    progress(manifest, totalBytes, null, true);

    return {
      status: 'completed',
      manifest,
      installedPath,
      sizeBytes,
      checksumVerified: true,
    };
  } catch (error) {
    if (error instanceof PauseRequested || active.paused) {
      return {
        status: 'paused',
        manifest,
        downloadedBytes: progress.downloadedBytes(),
        totalBytes,
      };
    }

    if (error instanceof CancelRequested || active.cancelled) {
      throw new OfflineRegionsError('cancelled', 'The routing download was cancelled.');
    }

    throw error;
  } finally {
    active.currentTask = null;
    activeDownloads.delete(regionId);
    active.resolveCompletion();
  }
}

export async function pauseRoutingDownload(regionId: string): Promise<boolean> {
  const active = activeDownloads.get(regionId);

  if (!active) {
    return false;
  }

  active.paused = true;

  if (active.currentTask) {
    try {
      await active.currentTask.pauseAsync();
    } catch {
      // The task may have completed between the state check and the pause.
    }
  }

  return true;
}

export async function cancelRoutingDownload(regionId: string): Promise<void> {
  const active = activeDownloads.get(regionId);

  if (active) {
    active.cancelled = true;
    try {
      active.currentTask?.cancel();
    } catch {
      // Native task may already be finished.
    }
    await active.completion;
  }

  clearPausedTasks(regionId);
  deleteRoutingPartial(regionId);
}

/**
 * Removes only partial download artifacts. Installed routing data is kept so a
 * cancelled retry never destroys a previously verified package.
 */
export function deleteRoutingPartial(regionId: string): void {
  const root = getOfflineRegionDirectory(regionId);
  const candidates = [
    getRoutingStagingDirectory(regionId),
    new Directory(root, BACKUP_DIRECTORY),
  ];

  for (const directory of candidates) {
    try {
      if (directory.exists) {
        directory.delete();
      }
    } catch {
      // Best effort cleanup.
    }
  }

  const archive = new File(root, ARCHIVE_NAME);
  try {
    if (archive.exists) {
      archive.delete();
    }
  } catch {
    // Best effort.
  }
}

export async function deleteRoutingData(regionId: string): Promise<void> {
  const root = getOfflineRegionDirectory(regionId);
  const candidates = [
    getRoutingInstalledDirectory(regionId),
    getRoutingStagingDirectory(regionId),
    new Directory(root, BACKUP_DIRECTORY),
  ];

  for (const directory of candidates) {
    try {
      if (directory.exists) {
        directory.delete();
      }
    } catch {
      // Best effort cleanup; a locked directory can be removed on the next run.
    }
  }

  const archive = new File(root, ARCHIVE_NAME);
  try {
    if (archive.exists) {
      archive.delete();
    }
  } catch {
    // Best effort.
  }

  clearPausedTasks(regionId);
}

/**
 * Lightweight restart check. It does not hash every tile; it verifies the
 * atomic-install marker (manifest), engine compatibility and a representative
 * file from each part of the package. Full checksums are available via
 * `verifyInstalledRoutingData`.
 */
export async function inspectInstalledRouting(
  regionId: string,
): Promise<InstalledRoutingInspection> {
  const installed = getRoutingInstalledDirectory(regionId);

  if (!installed.exists) {
    return { ok: false, reason: 'Routing data is not installed.' };
  }

  let manifest: RoutingPackageManifest;
  try {
    manifest = readManifest(installed);
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? error.message
          : 'The installed routing manifest is invalid.',
    };
  }

  if (manifest.regionId !== regionId) {
    return {
      ok: false,
      reason: 'The installed routing data belongs to a different region.',
    };
  }

  try {
    assertValhallaEngineCompatible(manifest);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Unsupported Valhalla version.',
    };
  }

  const files = fileUrlList(manifest);
  const samples = sampleFiles(files);

  for (const entry of samples) {
    const file = fileForPackagePath(installed, entry.path);

    if (!file.exists || file.size !== entry.sizeBytes) {
      return {
        ok: false,
        reason: `Routing data is incomplete (missing ${entry.path}). Download it again.`,
      };
    }
  }

  return {
    ok: true,
    manifest,
    installedPath: installed.uri,
    sizeBytes: installed.size ?? manifestDownloadBytes(manifest),
  };
}

export async function verifyInstalledRoutingData(
  regionId: string,
  onProgress?: (verified: number, total: number) => void,
): Promise<{ ok: boolean; message: string; manifest: RoutingPackageManifest | null }> {
  const installed = getRoutingInstalledDirectory(regionId);

  if (!installed.exists) {
    return { ok: false, message: 'Routing data is not installed.', manifest: null };
  }

  let manifest: RoutingPackageManifest;

  try {
    manifest = readManifest(installed);
    assertValhallaEngineCompatible(manifest);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Routing manifest is invalid.',
      manifest: null,
    };
  }

  try {
    await verifyPackageFiles(installed, fileUrlList(manifest), onProgress);
    return {
      ok: true,
      message: 'Routing tiles and metadata match the package checksums.',
      manifest,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof OfflineRegionsError
          ? error.message
          : 'Routing data failed checksum verification.',
      manifest,
    };
  }
}

export async function readStagingManifest(
  regionId: string,
): Promise<RoutingPackageManifest | null> {
  const staging = getRoutingStagingDirectory(regionId);

  if (!staging.exists) {
    return null;
  }

  try {
    return readManifest(staging);
  } catch {
    return null;
  }
}

export async function readInstalledManifest(
  regionId: string,
): Promise<RoutingPackageManifest | null> {
  const installed = getRoutingInstalledDirectory(regionId);

  if (!installed.exists) {
    return null;
  }

  try {
    return readManifest(installed);
  } catch {
    return null;
  }
}

async function downloadDirectoryPackage(
  regionId: string,
  manifest: RoutingPackageManifest,
  active: ActiveDownload,
  progress: ProgressReporter,
): Promise<void> {
  const staging = getRoutingStagingDirectory(regionId);
  const files = manifest.files ?? [];
  let completedBytes = 0;

  for (const entry of files) {
    throwIfStopped(active);

    const file = fileForPackagePath(staging, entry.path);
    const resumed = await reuseExistingFile(file, entry, active, progress, completedBytes, manifest);

    if (resumed) {
      completedBytes += entry.sizeBytes;
      progress(manifest, completedBytes, entry.path, false);
      continue;
    }

    await downloadFile(
      regionId,
      entry,
      staging,
      active,
      (bytesWritten) => {
        progress(manifest, completedBytes + bytesWritten, entry.path, false);
      },
    );

    completedBytes += entry.sizeBytes;
    progress(manifest, completedBytes, entry.path, false);
  }
}

async function downloadArchivePackage(
  regionId: string,
  manifest: RoutingPackageManifest,
  active: ActiveDownload,
  progress: ProgressReporter,
): Promise<void> {
  const archiveInfo = manifest.archive;

  if (!archiveInfo) {
    throw new OfflineRegionsError(
      'routing_manifest',
      'The routing package is missing archive information.',
    );
  }

  if (archiveInfo.sizeBytes > MAX_IN_MEMORY_ARCHIVE_BYTES) {
    throw new OfflineRegionsError(
      'routing_extraction',
      'This ZIP package is too large to extract safely on device. Ask the data provider for a directory-format package.',
    );
  }

  const root = getOfflineRegionDirectory(regionId);
  const staging = getRoutingStagingDirectory(regionId);
  const archive = new File(root, ARCHIVE_NAME);

  if (!archive.exists || archive.size !== archiveInfo.sizeBytes) {
    if (archive.exists) {
      archive.delete();
    }

    await downloadFile(
      regionId,
      {
        path: ARCHIVE_NAME,
        url: archiveInfo.url,
        sizeBytes: archiveInfo.sizeBytes,
        sha256: archiveInfo.sha256,
      },
      root,
      active,
      (bytesWritten) => {
        progress(manifest, bytesWritten, ARCHIVE_NAME, false);
      },
    );
  }

  const digest = await sha256OfFile(archive);

  if (digest.toLowerCase() !== archiveInfo.sha256.toLowerCase()) {
    try {
      archive.delete();
    } catch {
      // Best effort.
    }
    throw new OfflineRegionsError(
      'checksum_mismatch',
      'The routing archive checksum does not match the manifest.',
    );
  }

  // Extracting into a clean directory prevents stale files from a previous
  // interrupted package being treated as part of this one.
  if (staging.exists) {
    staging.delete();
  }
  staging.create({ intermediates: true, idempotent: true });

  const bytes = await archive.bytes();
  await extractZipSafely(bytes, staging, MAX_UNCOMPRESSED_BYTES);

  try {
    archive.delete();
  } catch {
    // The archive is no longer needed.
  }

  await verifyPackageFiles(staging, archiveInfo.files);
  progress(manifest, archiveInfo.sizeBytes, null, false);
}

async function reuseExistingFile(
  file: File,
  entry: RoutingPackageFile,
  active: ActiveDownload,
  progress: ProgressReporter,
  completedBytes: number,
  manifest: RoutingPackageManifest,
): Promise<boolean> {
  if (!file.exists || file.size !== entry.sizeBytes) {
    return false;
  }

  throwIfStopped(active);
  progress(manifest, completedBytes, entry.path, false);

  const digest = await sha256OfFile(file);

  if (digest.toLowerCase() === entry.sha256.toLowerCase()) {
    return true;
  }

  // A corrupt partial file must be removed before retrying.
  try {
    file.delete();
  } catch {
    // The download will fail below if the file cannot be replaced.
  }

  return false;
}

async function downloadFile(
  regionId: string,
  entry: RoutingPackageFile,
  root: Directory,
  active: ActiveDownload,
  onProgress: (bytesWritten: number) => void,
): Promise<void> {
  const destination = fileForPackagePath(root, entry.path);
  ensureParentDirectory(root, entry.path);

  const taskKey = destination.uri;
  const saved = pausedTasks.get(taskKey);

  // Keep a partial file when native resume data is available for it. Deleting
  // it would invalidate the saved offset and restart the transfer.
  if (destination.exists && !saved) {
    try {
      destination.delete();
    } catch {
      // The native downloader will overwrite with idempotent behavior.
    }
  }

  let task: DownloadTask | null = null;

  try {
    if (saved) {
      pausedTasks.delete(taskKey);
      task = DownloadTask.fromSavable(saved, {
        onProgress: ({ bytesWritten }) => onProgress(bytesWritten),
      });
      active.currentTask = task;
      const result = await task.resumeAsync();
      handleTaskResult(result, active, taskKey);
    } else {
      task = File.createDownloadTask(entry.url, destination, {
        onProgress: ({ bytesWritten }) => onProgress(bytesWritten),
      });
      active.currentTask = task;
      const result = await task.downloadAsync();
      handleTaskResult(result, active, taskKey);
    }
  } catch (error) {
    if (error instanceof PauseRequested || error instanceof CancelRequested) {
      throw error;
    }

    try {
      if (destination.exists) {
        destination.delete();
      }
    } catch {
      // Best effort.
    }

    if (error instanceof OfflineRegionsError) {
      throw error;
    }

    throw new OfflineRegionsError(
      'routing_download_failed',
      `Downloading routing file "${entry.path}" failed.`,
      { cause: error },
    );
  } finally {
    if (task) {
      try {
        task.release();
      } catch {
        // Releasing an already-finished native task is safe to ignore.
      }
    }
    if (active.currentTask === task) {
      active.currentTask = null;
    }
  }

  if (!destination.exists) {
    throw new OfflineRegionsError(
      'routing_download_failed',
      `Routing file "${entry.path}" did not finish downloading.`,
    );
  }

  if (destination.size !== entry.sizeBytes) {
    try {
      destination.delete();
    } catch {
      // Best effort.
    }
    throw new OfflineRegionsError(
      'checksum_mismatch',
      `Routing file "${entry.path}" has the wrong size after download.`,
    );
  }

  const digest = await sha256OfFile(destination);

  if (digest.toLowerCase() !== entry.sha256.toLowerCase()) {
    try {
      destination.delete();
    } catch {
      // Best effort.
    }
    throw new OfflineRegionsError(
      'checksum_mismatch',
      `Checksum mismatch for "${entry.path}". The routing download is corrupted.`,
    );
  }
}

function handleTaskResult(
  result: File | null,
  active: ActiveDownload,
  taskKey: string,
): void {
  if (active.cancelled) {
    throw new CancelRequested();
  }

  if (result === null || active.paused) {
    const task = active.currentTask;

    if (task) {
      try {
        pausedTasks.set(taskKey, task.savable());
      } catch {
        // Saved resume data is an optimization. If unavailable, the file is
        // restarted from the beginning on resume.
      }
    }
    throw new PauseRequested();
  }
}

function throwIfStopped(active: ActiveDownload): void {
  if (active.cancelled) {
    throw new CancelRequested();
  }
  if (active.paused) {
    throw new PauseRequested();
  }
}

function clearPausedTasks(regionId: string): void {
  const prefix = `${getOfflineRegionDirectory(regionId).uri}`;

  for (const key of pausedTasks.keys()) {
    if (key.startsWith(prefix)) {
      pausedTasks.delete(key);
    }
  }
}

async function installStaging(regionId: string): Promise<string> {
  const root = getOfflineRegionDirectory(regionId);
  const staging = getRoutingStagingDirectory(regionId);
  const installed = getRoutingInstalledDirectory(regionId);
  const backup = new Directory(root, BACKUP_DIRECTORY);

  if (!staging.exists) {
    throw new OfflineRegionsError(
      'routing_download_failed',
      'The routing staging directory disappeared before installation.',
    );
  }

  if (backup.exists) {
    backup.delete();
  }

  if (installed.exists) {
    await installed.move(backup);
  }

  try {
    await staging.move(installed);
  } catch (error) {
    if (backup.exists && !installed.exists) {
      try {
        await backup.move(installed);
      } catch {
        // The backup remains on disk for manual recovery.
      }
    }

    throw new OfflineRegionsError(
      'routing_download_failed',
      'The verified routing data could not be installed atomically.',
      { cause: error },
    );
  }

  if (backup.exists) {
    try {
      backup.delete();
    } catch {
      // Leaving the backup is harmless; it is removed on the next install.
    }
  }

  return getRoutingInstalledDirectory(regionId).uri;
}

async function writeManifest(
  directory: Directory,
  manifest: RoutingPackageManifest,
): Promise<void> {
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, MANIFEST_NAME);
  await file.write(JSON.stringify(manifest, null, 2));
}

function readManifest(directory: Directory): RoutingPackageManifest {
  const file = new File(directory, MANIFEST_NAME);

  if (!file.exists) {
    throw new OfflineRegionsError(
      'routing_manifest',
      'The routing package is missing manifest.json.',
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(file.textSync());
  } catch (error) {
    throw new OfflineRegionsError(
      'routing_manifest',
      'The installed routing manifest is not valid JSON.',
      { cause: error },
    );
  }

  return validateRoutingManifest(parsed);
}

function sampleFiles(files: RoutingPackageFile[]): RoutingPackageFile[] {
  if (files.length <= 4) {
    return files;
  }

  return [
    files[0],
    files[Math.floor(files.length / 3)],
    files[Math.floor((files.length * 2) / 3)],
    files[files.length - 1],
  ];
}

function assertStorageAvailable(
  regionId: string,
  totalBytes: number,
  manifest: RoutingPackageManifest,
): void {
  let available: number;

  try {
    available = Paths.availableDiskSpace;
  } catch {
    return;
  }

  if (!Number.isFinite(available) || available < 0) {
    return;
  }

  const staging = getRoutingStagingDirectory(regionId);
  let alreadyDownloaded = 0;

  try {
    alreadyDownloaded = staging.exists ? staging.size ?? 0 : 0;
  } catch {
    alreadyDownloaded = 0;
  }

  const extractionBytes =
    manifest.packageFormat === 'zip'
      ? (manifest.archive?.files ?? []).reduce(
          (total, file) => total + file.sizeBytes,
          0,
        )
      : 0;
  const required =
    Math.max(0, totalBytes - alreadyDownloaded) +
    extractionBytes +
    MIN_FREE_STORAGE_MARGIN_BYTES;

  if (available < required) {
    throw new OfflineRegionsError(
      'storage',
      `Not enough free storage for routing data. Need about ${formatMegabytes(required)} MB; ${formatMegabytes(available)} MB is available.`,
    );
  }
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}

type ProgressReporter = ((
  manifest: RoutingPackageManifest,
  downloadedBytes: number,
  currentFile: string | null,
  force: boolean,
) => void) & {
  downloadedBytes: () => number;
};

function createProgressReporter(
  totalBytes: number,
  callbacks?: RoutingDownloadCallbacks,
): ProgressReporter {
  let lastEmit = 0;
  let lastBytes = 0;

  const emit = (
    manifest: RoutingPackageManifest,
    downloadedBytes: number,
    currentFile: string | null,
    force: boolean,
  ) => {
    lastBytes = downloadedBytes;
    const now = Date.now();

    if (!force && now - lastEmit < ROUTING_DOWNLOAD_PROGRESS_THROTTLE_MS) {
      return;
    }

    lastEmit = now;
    callbacks?.onProgress?.({
      downloadedBytes: Math.min(totalBytes, Math.max(0, downloadedBytes)),
      totalBytes,
      progress:
        totalBytes > 0
          ? Math.min(100, Math.max(0, (downloadedBytes / totalBytes) * 100))
          : 0,
      currentFile: currentFile ?? manifest.regionId,
    });
  };

  const reporter = emit as ProgressReporter;
  reporter.downloadedBytes = () => lastBytes;
  return reporter;
}
