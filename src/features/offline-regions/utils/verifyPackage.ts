import { Directory, File } from 'expo-file-system';
import { unzipSync } from 'fflate';

import {
  OfflineRegionsError,
  type OfflineRegionBounds,
} from '../types/offlineRegion.types';
import type {
  RoutingPackageFile,
  RoutingPackageManifest,
} from '../types/routingPackage.types';
import { boundsContain } from './calculateBounds';
import { isSha256, normalizePackagePath } from './packagePath';

export function assertInsideRoot(root: Directory, file: File): void {
  const rootUri = root.uri.endsWith('/') ? root.uri : `${root.uri}/`;

  if (!file.uri.startsWith(rootUri)) {
    throw new OfflineRegionsError(
      'routing_extraction',
      'The package attempted to write outside the staging directory.',
    );
  }
}

export function fileForPackagePath(root: Directory, relativePath: string): File {
  const segments = normalizePackagePath(relativePath);
  const file = new File(root, ...segments);
  assertInsideRoot(root, file);
  return file;
}

export function ensureParentDirectory(root: Directory, relativePath: string): void {
  const segments = normalizePackagePath(relativePath);

  if (segments.length <= 1) {
    return;
  }

  const parent = new Directory(root, ...segments.slice(0, -1));
  assertInsideRoot(root, new File(parent, segments[segments.length - 1]));
  parent.create({ intermediates: true, idempotent: true });
}

export async function sha256OfFile(file: File): Promise<string> {
  if (!file.exists) {
    throw new OfflineRegionsError('checksum_mismatch', `Missing package file: ${file.name}`);
  }

  return file.digest('SHA-256');
}

export async function verifyFileIntegrity(
  root: Directory,
  entry: RoutingPackageFile,
): Promise<number> {
  const file = fileForPackagePath(root, entry.path);

  if (!file.exists) {
    throw new OfflineRegionsError(
      'checksum_mismatch',
      `Routing package file is missing: ${entry.path}`,
    );
  }

  const size = file.size;

  if (size !== entry.sizeBytes) {
    throw new OfflineRegionsError(
      'checksum_mismatch',
      `Routing package file has the wrong size: ${entry.path}`,
    );
  }

  if (!isSha256(entry.sha256)) {
    throw new OfflineRegionsError(
      'routing_manifest',
      `Routing package manifest has an invalid checksum for ${entry.path}.`,
    );
  }

  const digest = await sha256OfFile(file);

  if (digest.toLowerCase() !== entry.sha256.toLowerCase()) {
    throw new OfflineRegionsError(
      'checksum_mismatch',
      `Checksum mismatch for ${entry.path}. The download is corrupted; retry it.`,
    );
  }

  return size;
}

export async function verifyPackageFiles(
  root: Directory,
  files: RoutingPackageFile[],
  onProgress?: (verified: number, total: number) => void,
): Promise<number> {
  let totalBytes = 0;

  for (let index = 0; index < files.length; index += 1) {
    totalBytes += await verifyFileIntegrity(root, files[index]);
    onProgress?.(index + 1, files.length);
  }

  return totalBytes;
}

/**
 * Safely extracts a ZIP that is already in memory. The caller must enforce a
 * maximum archive size before calling this. Every entry path is validated and
 * the total uncompressed size is bounded.
 */
export async function extractZipSafely(
  archiveBytes: Uint8Array,
  staging: Directory,
  maxUncompressedBytes: number,
): Promise<string[]> {
  let entries: Record<string, Uint8Array>;
  let declaredTotal = 0;

  try {
    entries = unzipSync(archiveBytes, {
      filter: (entry) => {
        const path = entry.name;

        if (path.endsWith('/')) {
          normalizePackagePath(path.slice(0, -1));
          return false;
        }

        // Validate every path before any filesystem write.
        normalizePackagePath(path);

        declaredTotal += entry.originalSize;

        if (declaredTotal > maxUncompressedBytes) {
          throw new OfflineRegionsError(
            'routing_extraction',
            'The routing archive expands beyond the allowed size.',
          );
        }

        return true;
      },
    });
  } catch (error) {
    if (error instanceof OfflineRegionsError) {
      throw error;
    }

    throw new OfflineRegionsError(
      'routing_extraction',
      'The routing archive could not be extracted.',
      { cause: error },
    );
  }

  let total = 0;

  for (const [path, data] of Object.entries(entries)) {
    total += data.byteLength;

    if (total > maxUncompressedBytes) {
      throw new OfflineRegionsError(
        'routing_extraction',
        'The routing archive expands beyond the allowed size.',
      );
    }

    normalizePackagePath(path);
  }

  const written: string[] = [];

  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith('/')) {
      const segments = normalizePackagePath(path.slice(0, -1));
      const directory = new Directory(staging, ...segments);
      assertInsideRoot(staging, new File(directory, '.keep'));
      directory.create({ intermediates: true, idempotent: true });
      continue;
    }

    ensureParentDirectory(staging, path);
    const file = fileForPackagePath(staging, path);
    await file.write(data);
    written.push(path);
  }

  return written;
}

export function summarizeManifestCoverage(
  manifest: RoutingPackageManifest,
): OfflineRegionBounds {
  return manifest.coverageBounds;
}

export function assertManifestCovers(
  manifest: RoutingPackageManifest,
  requested: OfflineRegionBounds,
): void {
  if (!boundsContain(manifest.coverageBounds, requested)) {
    throw new OfflineRegionsError(
      'routing_manifest',
      'The routing package does not cover the requested region. Choose the region again or contact the data provider.',
    );
  }
}
