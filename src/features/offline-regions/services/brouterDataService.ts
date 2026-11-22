import {
  Directory,
  DownloadTask,
  File,
  Paths,
  type DownloadPauseState,
} from 'expo-file-system';

import {
  BROUTER_DATA_BASE_URL,
  BROUTER_MANIFEST_TIMEOUT_MS,
  ROUTING_DOWNLOAD_PROGRESS_THROTTLE_MS,
  SUPPORTED_BROUTER_ENGINE_VERSION,
} from '../config';
import {
  OfflineRegionsError,
  type OfflineRegionBounds,
} from '../types/offlineRegion.types';
import type {
  BrouterDownloadCallbacks,
  BrouterInstallOutcome,
  BrouterManifest,
  BrouterManifestTile,
  BrouterRegionInspection,
  BrouterRegionPackage,
} from '../types/brouter.types';
import { sha256OfFile } from '../utils/verifyPackage';
import { isSha256 } from '../utils/packagePath';
import { tilesForBounds } from '../utils/brouterTiles';

const OFFLINE_ROOT = 'offline-regions';
const ROUTING_DIRECTORY = 'routing';
const PACKAGE_FILE = 'manifest.json';
const MANIFEST_CACHE_MS = 5 * 60_000;
const SHARED_ROOT = 'brouter';
const SEGMENTS_DIRECTORY = 'segments4';
const PLACES_DIRECTORY = 'places';

type ActiveInstall = {
  cancelled: boolean;
  paused: boolean;
  currentTask: DownloadTask | null;
  currentTaskKey: string | null;
  downloadedBytes: number;
  currentFileProgressBytes: number;
  totalBytes: number;
};

class PauseRequested extends Error {}
class CancelRequested extends Error {}

const activeInstalls = new Map<string, ActiveInstall>();
const pausedTasks = new Map<string, DownloadPauseState>();

let manifestCache:
  | { expiresAt: number; value: BrouterManifest }
  | null = null;

export function isBrouterConfigured(): boolean {
  return BROUTER_DATA_BASE_URL.length > 0;
}

export function getBrouterDataBaseUrl(): string {
  if (!BROUTER_DATA_BASE_URL) {
    throw new OfflineRegionsError(
      'routing_configuration',
      'BRouter data is not configured. Set EXPO_PUBLIC_BROUTER_DATA_BASE_URL to the release asset URL.',
    );
  }

  return BROUTER_DATA_BASE_URL;
}

export function getBrouterSegmentsDirectory(): Directory {
  return new Directory(Paths.document, SHARED_ROOT, SEGMENTS_DIRECTORY);
}

export function getBrouterPlacesDirectory(): Directory {
  return new Directory(Paths.document, SHARED_ROOT, PLACES_DIRECTORY);
}

export function getBrouterRegionDirectory(regionId: string): Directory {
  return new Directory(Paths.document, OFFLINE_ROOT, regionId, ROUTING_DIRECTORY);
}

export function getBrouterRegionManifestPath(regionId: string): string {
  return `${getBrouterRegionDirectory(regionId).uri.replace(/\/+$/u, '')}/${PACKAGE_FILE}`;
}

export async function fetchBrouterManifest(options: {
  force?: boolean;
} = {}): Promise<BrouterManifest> {
  if (
    !options.force &&
    manifestCache &&
    manifestCache.expiresAt > Date.now()
  ) {
    return manifestCache.value;
  }

  const url = `${getBrouterDataBaseUrl()}/brouter-manifest.json`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    BROUTER_MANIFEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new OfflineRegionsError(
        'routing_manifest',
        `The BRouter manifest returned HTTP ${response.status}.`,
      );
    }

    const payload = (await response.json()) as unknown;
    const manifest = validateBrouterManifest(payload);

    manifestCache = {
      value: manifest,
      expiresAt: Date.now() + MANIFEST_CACHE_MS,
    };

    return manifest;
  } catch (error) {
    if (error instanceof OfflineRegionsError) {
      throw error;
    }

    throw new OfflineRegionsError(
      'routing_manifest',
      'The BRouter manifest could not be downloaded. Check your connection and retry.',
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function estimateBrouterRegion(
  bounds: OfflineRegionBounds,
): Promise<{
  estimatedSizeBytes: number | null;
  coverageBounds: OfflineRegionBounds;
  buildOnDemand: boolean;
}> {
  const manifest = await fetchBrouterManifest();
  const required = requiredTiles(manifest, bounds);

  if (required.segmentEntries.some((entry) => entry === null)) {
    return {
      estimatedSizeBytes: null,
      coverageBounds: bounds,
      buildOnDemand: false,
    };
  }

  const total = [...required.segmentEntries, ...required.placeEntries].reduce(
    (sum, entry) => sum + (entry?.sizeBytes ?? 0),
    0,
  );

  return {
    estimatedSizeBytes: total,
    coverageBounds: bounds,
    buildOnDemand: false,
  };
}

export async function installBrouterRegion(input: {
  regionId: string;
  bounds: OfflineRegionBounds;
  callbacks?: BrouterDownloadCallbacks;
  manifest?: BrouterManifest;
}): Promise<BrouterInstallOutcome> {
  const { regionId, bounds, callbacks } = input;
  const existing = activeInstalls.get(regionId);

  if (existing) {
    if (!existing.paused && !existing.cancelled) {
      throw new OfflineRegionsError(
        'routing_download_failed',
        'A BRouter download is already running for this region.',
      );
    }

    await waitForInstallToStop(regionId);
  }

  const manifest = input.manifest ?? (await fetchBrouterManifest());
  const required = requiredTiles(manifest, bounds);

  if (required.segmentEntries.some((entry) => entry === null)) {
    throw new OfflineRegionsError(
      'routing_manifest',
      'The BRouter data mirror does not contain every segment tile needed for this region. Choose a smaller area or update the mirror.',
    );
  }

  const segmentEntries = required.segmentEntries as BrouterManifestTile[];
  const placeEntries = required.placeEntries.filter(
    (entry): entry is BrouterManifestTile => entry !== null,
  );
  const allEntries = [...segmentEntries, ...placeEntries];
  const totalBytes = allEntries.reduce(
    (sum, entry) => sum + entry.sizeBytes,
    0,
  );

  const active: ActiveInstall = {
    cancelled: false,
    paused: false,
    currentTask: null,
    currentTaskKey: null,
    downloadedBytes: 0,
    currentFileProgressBytes: 0,
    totalBytes,
  };
  activeInstalls.set(regionId, active);

  const segmentsDir = getBrouterSegmentsDirectory();
  const placesDir = getBrouterPlacesDirectory();
  segmentsDir.create({ intermediates: true, idempotent: true });
  placesDir.create({ intermediates: true, idempotent: true });

  let lastProgressAt = 0;
  const reportProgress = (currentFile: string | null, force = false) => {
    const now = Date.now();

    if (!force && now - lastProgressAt < ROUTING_DOWNLOAD_PROGRESS_THROTTLE_MS) {
      return;
    }

    lastProgressAt = now;
    callbacks?.onProgress?.({
      downloadedBytes: Math.min(
        totalBytes,
        active.downloadedBytes + active.currentFileProgressBytes,
      ),
      totalBytes,
      progress:
        totalBytes > 0
          ? ((active.downloadedBytes + active.currentFileProgressBytes) /
              totalBytes) *
            100
          : 0,
      currentFile,
    });
  };

  try {
    await installEntries({
      regionId,
      active,
      entries: segmentEntries,
      directory: segmentsDir,
      fileSuffix: '.rd5',
      reportProgress,
    });

    await installEntries({
      regionId,
      active,
      entries: placeEntries,
      directory: placesDir,
      fileSuffix: '.sqlite',
      reportProgress,
    });

    const sizeBytes = allEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    const installedAt = new Date().toISOString();
    const packageRecord: BrouterRegionPackage = {
      schemaVersion: 1,
      backend: 'brouter',
      regionId,
      engineVersion: SUPPORTED_BROUTER_ENGINE_VERSION,
      dataVersion: manifest.generatedAt,
      bounds,
      coverageBounds: bounds,
      segmentTiles: segmentEntries.map((entry) => entry.name),
      placeTiles: placeEntries.map((entry) => entry.name),
      segmentFiles: segmentEntries,
      placeFiles: placeEntries,
      installedAt,
      sizeBytes,
    };

    const routingDir = getBrouterRegionDirectory(regionId);
    routingDir.create({ intermediates: true, idempotent: true });
    const manifestFile = new File(routingDir, PACKAGE_FILE);
    await manifestFile.write(`${JSON.stringify(packageRecord, null, 2)}\n`);

    reportProgress(null, true);

    return {
      status: 'completed',
      package: packageRecord,
      installedPath: routingDir.uri,
      manifestPath: manifestFile.uri,
      sizeBytes,
    };
  } catch (error) {
    if (
      error instanceof PauseRequested ||
      active.paused
    ) {
      return {
        status: 'paused',
        downloadedBytes: Math.min(
          totalBytes,
          active.downloadedBytes + active.currentFileProgressBytes,
        ),
        totalBytes,
      };
    }

    if (error instanceof CancelRequested || active.cancelled) {
      throw new OfflineRegionsError(
        'cancelled',
        'The routing download was cancelled. Retry to download it again.',
      );
    }

    if (error instanceof OfflineRegionsError) {
      throw error;
    }

    throw new OfflineRegionsError(
      'routing_download_failed',
      'The BRouter data download failed. Check your connection and retry.',
      { cause: error },
    );
  } finally {
    activeInstalls.delete(regionId);
  }
}

export function pauseBrouterRegion(regionId: string): void {
  const active = activeInstalls.get(regionId);

  if (!active) {
    return;
  }

  active.paused = true;

  if (active.currentTask) {
    try {
      active.currentTask.pause();
    } catch {}
  }
}

export function cancelBrouterRegion(regionId: string): void {
  const active = activeInstalls.get(regionId);

  if (!active) {
    return;
  }

  active.cancelled = true;

  if (active.currentTask) {
    try {
      active.currentTask.cancel();
    } catch {}
  }
}

export function isBrouterDownloadActive(regionId: string): boolean {
  return activeInstalls.has(regionId);
}

export async function readBrouterRegionPackage(
  regionId: string,
): Promise<BrouterRegionPackage | null> {
  const file = new File(getBrouterRegionDirectory(regionId), PACKAGE_FILE);

  if (!file.exists) {
    return null;
  }

  try {
    return validateBrouterRegionPackage(
      JSON.parse(file.textSync()) as unknown,
      regionId,
    );
  } catch {
    return null;
  }
}

export async function inspectInstalledBrouter(
  regionId: string,
  options: { verifyChecksums?: boolean } = {},
): Promise<BrouterRegionInspection> {
  const packageRecord = await readBrouterRegionPackage(regionId);

  if (!packageRecord) {
    return {
      ok: false,
      reason:
        'The offline routing manifest is missing. Download the routing data again.',
    };
  }

  const segmentsDir = getBrouterSegmentsDirectory();
  const placesDir = getBrouterPlacesDirectory();
  let sizeBytes = 0;

  for (const entry of packageRecord.segmentFiles) {
    const result = await inspectTile({
      directory: segmentsDir,
      fileName: entry.file,
      entry,
      verifyChecksum: options.verifyChecksums === true,
    });

    if (!result.ok) {
      return result;
    }

    sizeBytes += result.sizeBytes;
  }

  for (const entry of packageRecord.placeFiles) {
    const result = await inspectTile({
      directory: placesDir,
      fileName: entry.file,
      entry,
      verifyChecksum: options.verifyChecksums === true,
    });

    if (!result.ok) {
      return result;
    }

    sizeBytes += result.sizeBytes;
  }

  return {
    ok: true,
    package: packageRecord,
    installedPath: getBrouterRegionDirectory(regionId).uri,
    manifestPath: getBrouterRegionManifestPath(regionId),
    sizeBytes,
  };
}

export async function deleteBrouterRegion(regionId: string): Promise<void> {
  cancelBrouterRegion(regionId);
  await waitForInstallToStop(regionId);

  const directory = getBrouterRegionDirectory(regionId);

  if (directory.exists) {
    directory.delete();
  }

  await pruneBrouterTiles(regionId);
}

async function waitForInstallToStop(regionId: string): Promise<void> {
  const deadline = Date.now() + 10_000;

  while (activeInstalls.has(regionId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function pruneBrouterTiles(removedRegionId: string): Promise<void> {
  if (activeInstalls.size > 0) {
    return;
  }

  const regionsDir = new Directory(Paths.document, OFFLINE_ROOT);
  const requiredSegments = new Set<string>();
  const requiredPlaces = new Set<string>();

  if (regionsDir.exists) {
    for (const item of regionsDir.list()) {
      if (!(item instanceof Directory) || item.name === removedRegionId) {
        continue;
      }

      const manifestFile = new File(item, ROUTING_DIRECTORY, PACKAGE_FILE);

      if (!manifestFile.exists) {
        continue;
      }

      try {
        const parsed = validateBrouterRegionPackage(
          JSON.parse(manifestFile.textSync()) as unknown,
          item.name,
        );

        for (const name of parsed.segmentTiles) {
          requiredSegments.add(name);
        }
        for (const name of parsed.placeTiles) {
          requiredPlaces.add(name);
        }
      } catch {}
    }
  }

  pruneSharedDirectory(getBrouterSegmentsDirectory(), requiredSegments, '.rd5');
  pruneSharedDirectory(
    getBrouterPlacesDirectory(),
    requiredPlaces,
    '.sqlite',
  );
}

function pruneSharedDirectory(
  directory: Directory,
  requiredTiles: Set<string>,
  suffix: string,
): void {
  if (!directory.exists) {
    return;
  }

  for (const item of directory.list()) {
    if (!(item instanceof File)) {
      continue;
    }

    const name = item.name.endsWith(suffix)
      ? item.name.slice(0, -suffix.length)
      : null;

    if (name && requiredTiles.has(name)) {
      continue;
    }

    try {
      item.delete();
    } catch {}
  }
}

async function installEntries(input: {
  regionId: string;
  active: ActiveInstall;
  entries: BrouterManifestTile[];
  directory: Directory;
  fileSuffix: string;
  reportProgress: (currentFile: string | null, force?: boolean) => void;
}): Promise<void> {
  const { regionId, active, entries, directory, fileSuffix, reportProgress } =
    input;
  const ordered = [...entries].sort(
    (a, b) => b.sizeBytes - a.sizeBytes,
  );

  for (const entry of ordered) {
    if (active.cancelled) {
      throw new CancelRequested();
    }
    if (active.paused) {
      throw new PauseRequested();
    }

    const fileName = entry.file.endsWith(fileSuffix)
      ? entry.file
      : `${entry.name}${fileSuffix}`;
    const destination = new File(directory, safeFileName(fileName));
    const existing = await inspectExistingTile(destination, entry);

    if (existing) {
      active.downloadedBytes += entry.sizeBytes;
      active.currentFileProgressBytes = 0;
      reportProgress(entry.name);
      continue;
    }

    if (destination.exists) {
      try {
        destination.delete();
      } catch {}
    }

    await downloadTile({
      regionId,
      active,
      entry,
      destination,
      reportProgress,
    });

    active.downloadedBytes += entry.sizeBytes;
    active.currentFileProgressBytes = 0;
    reportProgress(entry.name, true);
  }
}

async function downloadTile(input: {
  regionId: string;
  active: ActiveInstall;
  entry: BrouterManifestTile;
  destination: File;
  reportProgress: (currentFile: string | null, force?: boolean) => void;
}): Promise<void> {
  const { regionId, active, entry, destination, reportProgress } = input;
  const url = tileUrl(entry);
  const taskKey = `${regionId}:${entry.name}:${entry.file}`;
  const saved = pausedTasks.get(taskKey);
  let task: DownloadTask | null = null;

  reportProgress(entry.name, true);

  try {
    const onProgress = ({ bytesWritten }: { bytesWritten: number }) => {
      active.currentFileProgressBytes = Math.min(
        entry.sizeBytes,
        Math.max(0, bytesWritten),
      );
      reportProgress(entry.name);
    };

    if (saved) {
      pausedTasks.delete(taskKey);
      task = DownloadTask.fromSavable(saved, { onProgress });
    } else {
      task = File.createDownloadTask(url, destination, { onProgress });
    }

    active.currentTask = task;
    active.currentTaskKey = taskKey;
    active.currentFileProgressBytes = 0;
    const result = saved ? await task.resumeAsync() : await task.downloadAsync();

    if (active.cancelled) {
      throw new CancelRequested();
    }

    if (active.paused || result === null) {
      try {
        pausedTasks.set(taskKey, task.savable());
      } catch {}
      throw new PauseRequested();
    }
  } catch (error) {
    if (
      error instanceof PauseRequested ||
      error instanceof CancelRequested ||
      active.paused ||
      active.cancelled
    ) {
      throw error;
    }

    try {
      if (destination.exists) {
        destination.delete();
      }
    } catch {}

    throw new OfflineRegionsError(
      'routing_download_failed',
      `Downloading BRouter tile "${entry.name}" failed.`,
      { cause: error },
    );
  } finally {
    if (task) {
      try {
        task.release();
      } catch {}
    }
    if (active.currentTask === task) {
      active.currentTask = null;
      active.currentTaskKey = null;
    }
  }

  if (!destination.exists) {
    throw new OfflineRegionsError(
      'routing_download_failed',
      `BRouter tile "${entry.name}" did not finish downloading.`,
    );
  }

  if (destination.size !== entry.sizeBytes) {
    try {
      destination.delete();
    } catch {}
    throw new OfflineRegionsError(
      'checksum_mismatch',
      `BRouter tile "${entry.name}" has the wrong size after download.`,
    );
  }

  const digest = await sha256OfFile(destination);

  if (digest.toLowerCase() !== entry.sha256.toLowerCase()) {
    try {
      destination.delete();
    } catch {}
    throw new OfflineRegionsError(
      'checksum_mismatch',
      `Checksum mismatch for BRouter tile "${entry.name}". The download is corrupted.`,
    );
  }
}

async function inspectExistingTile(
  file: File,
  entry: BrouterManifestTile,
): Promise<boolean> {
  if (!file.exists || file.size !== entry.sizeBytes) {
    return false;
  }

  try {
    const digest = await sha256OfFile(file);
    return digest.toLowerCase() === entry.sha256.toLowerCase();
  } catch {
    return false;
  }
}

async function inspectTile(input: {
  directory: Directory;
  fileName: string;
  entry: BrouterManifestTile | null;
  verifyChecksum: boolean;
}): Promise<
  | { ok: true; sizeBytes: number }
  | { ok: false; reason: string }
> {
  const { directory, fileName, entry, verifyChecksum } = input;
  const file = new File(directory, safeFileName(fileName));

  if (!file.exists) {
    return {
      ok: false,
      reason: `BRouter tile ${fileName} is missing. Download the routing data again.`,
    };
  }

  if (entry && entry.sizeBytes > 0 && file.size !== entry.sizeBytes) {
    return {
      ok: false,
      reason: `BRouter tile ${fileName} is corrupted. Download the routing data again.`,
    };
  }

  if (entry && entry.sha256 && verifyChecksum) {
    const digest = await sha256OfFile(file);

    if (digest.toLowerCase() !== entry.sha256.toLowerCase()) {
      return {
        ok: false,
        reason: `Checksum mismatch for BRouter tile ${fileName}.`,
      };
    }
  }

  return { ok: true, sizeBytes: file.size };
}

function requiredTiles(
  manifest: BrouterManifest,
  bounds: OfflineRegionBounds,
): {
  segments: (string | null)[];
  places: (string | null)[];
  segmentEntries: (BrouterManifestTile | null)[];
  placeEntries: (BrouterManifestTile | null)[];
} {
  const names = tilesForBounds(bounds);
  const segmentEntries = names.map((name) =>
    findTile(manifest.segments.tiles, name),
  );
  const placeEntries = names.map((name) =>
    findTile(manifest.places.tiles, name),
  );

  return {
    segments: names.map((name, index) =>
      segmentEntries[index] ? name : null,
    ),
    places: names.map((name, index) =>
      placeEntries[index] ? name : null,
    ),
    segmentEntries,
    placeEntries,
  };
}

function findTile(
  tiles: BrouterManifestTile[],
  name: string,
): BrouterManifestTile | null {
  return tiles.find((tile) => tile.name === name) ?? null;
}

function tileUrl(entry: BrouterManifestTile): string {
  if (entry.url && /^https?:\/\//iu.test(entry.url)) {
    return entry.url;
  }

  const relative = entry.url || entry.file;
  return `${getBrouterDataBaseUrl()}/${relative.replace(/^\/+/u, '')}`;
}

function safeFileName(value: string): string {
  if (
    value.length === 0 ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    value === '.' ||
    value === '..'
  ) {
    throw new OfflineRegionsError(
      'routing_manifest',
      'The BRouter manifest contains an unsafe file name.',
    );
  }

  return value;
}

function validateBrouterManifest(value: unknown): BrouterManifest {
  if (!value || typeof value !== 'object') {
    throw new OfflineRegionsError(
      'routing_manifest',
      'The BRouter manifest is not an object.',
    );
  }

  const record = value as Record<string, unknown>;

  if (record.schemaVersion !== 1) {
    throw new OfflineRegionsError(
      'routing_manifest',
      `Unsupported BRouter manifest version: ${String(record.schemaVersion)}.`,
    );
  }

  const segments = record.segments as Record<string, unknown> | undefined;
  const places = record.places as Record<string, unknown> | undefined;

  const segmentTiles = validateTiles(segments?.tiles, 'segment');
  const placeTiles = validateTiles(places?.tiles, 'places');

  return {
    schemaVersion: 1,
    generatedAt:
      typeof record.generatedAt === 'string'
        ? record.generatedAt
        : new Date().toISOString(),
    source:
      typeof record.source === 'string'
        ? record.source
        : typeof segments?.source === 'string'
          ? segments.source
          : '',
    segments: {
      source:
        typeof segments?.source === 'string'
          ? segments.source
          : typeof record.source === 'string'
            ? record.source
            : '',
      tiles: segmentTiles,
    },
    places: { tiles: placeTiles },
    profiles: commitProfiles(record.profiles),
  };
}

function validateTiles(
  value: unknown,
  kind: 'segment' | 'places',
): BrouterManifestTile[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new OfflineRegionsError(
      'routing_manifest',
      `The BRouter ${kind} tile list is not an array.`,
    );
  }

  return value.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new OfflineRegionsError(
        'routing_manifest',
        `The BRouter ${kind} tile entry is invalid.`,
      );
    }

    const tile = item as Record<string, unknown>;
    const name = tile.name;
    const file = tile.file;
    const sizeBytes = tile.sizeBytes;
    const sha256 = tile.sha256;

    if (
      typeof name !== 'string' ||
      !/^[EW]\d+_[NS]\d+$/u.test(name)
    ) {
      throw new OfflineRegionsError(
        'routing_manifest',
        `The BRouter ${kind} tile has an invalid name.`,
      );
    }

    if (typeof file !== 'string' || !isSafeFileName(file)) {
      throw new OfflineRegionsError(
        'routing_manifest',
        `The BRouter ${kind} tile ${name} has an invalid file name.`,
      );
    }

    if (
      typeof sizeBytes !== 'number' ||
      !Number.isInteger(sizeBytes) ||
      sizeBytes <= 0
    ) {
      throw new OfflineRegionsError(
        'routing_manifest',
        `The BRouter ${kind} tile ${name} has an invalid size.`,
      );
    }

    if (!isSha256(sha256)) {
      throw new OfflineRegionsError(
        'routing_manifest',
        `The BRouter ${kind} tile ${name} has an invalid checksum.`,
      );
    }

    return {
      name,
      file,
      url: typeof tile.url === 'string' ? tile.url : undefined,
      sizeBytes,
      sha256: sha256.toLowerCase(),
    };
  });
}

function validateBrouterRegionPackage(
  value: unknown,
  regionId: string,
): BrouterRegionPackage {
  if (!value || typeof value !== 'object') {
    throw new OfflineRegionsError(
      'routing_manifest',
      'The installed BRouter manifest is invalid.',
    );
  }

  const record = value as Record<string, unknown>;

  if (record.schemaVersion !== 1 || record.backend !== 'brouter') {
    throw new OfflineRegionsError(
      'routing_manifest',
      'The installed routing data is not a BRouter package.',
    );
  }

  if (record.regionId !== regionId) {
    throw new OfflineRegionsError(
      'routing_manifest',
      'The installed routing manifest belongs to a different region.',
    );
  }

  return {
    schemaVersion: 1,
    backend: 'brouter',
    regionId,
    engineVersion:
      typeof record.engineVersion === 'string'
        ? record.engineVersion
        : SUPPORTED_BROUTER_ENGINE_VERSION,
    dataVersion:
      typeof record.dataVersion === 'string' ? record.dataVersion : '',
    bounds: validateBounds(record.bounds),
    coverageBounds: validateBounds(record.coverageBounds ?? record.bounds),
    segmentTiles: validateTileNames(record.segmentTiles),
    placeTiles: validateTileNames(record.placeTiles),
    segmentFiles: validateOptionalTileFiles(
      record.segmentFiles,
      validateTileNames(record.segmentTiles),
      '.rd5',
    ),
    placeFiles: validateOptionalTileFiles(
      record.placeFiles,
      validateTileNames(record.placeTiles),
      '.sqlite',
    ),
    installedAt:
      typeof record.installedAt === 'string'
        ? record.installedAt
        : new Date().toISOString(),
    sizeBytes:
      typeof record.sizeBytes === 'number' ? record.sizeBytes : 0,
  };
}

function validateBounds(value: unknown): OfflineRegionBounds {
  if (!value || typeof value !== 'object') {
    throw new OfflineRegionsError(
      'routing_manifest',
      'The routing manifest has invalid bounds.',
    );
  }

  const bounds = value as Record<string, unknown>;
  const north = Number(bounds.north);
  const south = Number(bounds.south);
  const east = Number(bounds.east);
  const west = Number(bounds.west);

  if (
    ![north, south, east, west].every(Number.isFinite) ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north
  ) {
    throw new OfflineRegionsError(
      'routing_manifest',
      'The routing manifest has invalid bounds.',
    );
  }

  return { north, south, east, west };
}

function validateOptionalTileFiles(
  value: unknown,
  names: string[],
  suffix: string,
): BrouterManifestTile[] {
  if (value === undefined) {
    return names.map((name) => ({
      name,
      file: `${name}${suffix}`,
      sizeBytes: 0,
      sha256: '',
    }));
  }

  if (!Array.isArray(value)) {
    throw new OfflineRegionsError(
      'routing_manifest',
      'The routing manifest has an invalid tile list.',
    );
  }

  return value.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new OfflineRegionsError(
        'routing_manifest',
        'The routing manifest has an invalid tile entry.',
      );
    }

    const tile = item as Record<string, unknown>;

    if (
      typeof tile.name !== 'string' ||
      typeof tile.file !== 'string' ||
      typeof tile.sizeBytes !== 'number' ||
      !isSha256(tile.sha256)
    ) {
      throw new OfflineRegionsError(
        'routing_manifest',
        'The routing manifest has an invalid tile entry.',
      );
    }

    return {
      name: tile.name,
      file: tile.file,
      url: typeof tile.url === 'string' ? tile.url : undefined,
      sizeBytes: tile.sizeBytes,
      sha256: tile.sha256.toLowerCase(),
    };
  });
}

function validateTileNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new OfflineRegionsError(
      'routing_manifest',
      'The routing manifest has an invalid tile list.',
    );
  }

  return value.map((name) => {
    if (typeof name !== 'string' || !/^[EW]\d+_[NS]\d+$/u.test(name)) {
      throw new OfflineRegionsError(
        'routing_manifest',
        'The routing manifest has an invalid tile name.',
      );
    }

    return name;
  });
}

function isSafeFileName(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    value !== '.' &&
    value !== '..'
  );
}

function commitProfiles(value: unknown): BrouterManifest['profiles'] {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return {
    version: typeof record.version === 'string' ? record.version : null,
    files: Array.isArray(record.files) ? record.files : [],
  };
}
