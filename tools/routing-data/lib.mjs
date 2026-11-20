import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_ENGINE_VERSION =
  process.env.VALHALLA_ENGINE_VERSION?.trim() || '3.9.1';

const KM_PER_DEGREE_LAT = 110.574;
const KM_PER_DEGREE_LON_AT_EQUATOR = 111.32;

export function parseBounds(value, label = 'bounds') {
  const parts = String(value)
    .split(',')
    .map((part) => Number(part.trim()));

  if (parts.length !== 4 || !parts.every(Number.isFinite)) {
    throw new Error(
      `${label} must be "west,south,east,north" with four finite numbers.`,
    );
  }

  const [west, south, east, north] = parts;

  if (west < -180 || east > 180 || south < -90 || north > 90) {
    throw new Error(`${label} is outside valid longitude/latitude ranges.`);
  }

  if (west >= east || south >= north) {
    throw new Error(`${label} must have west < east and south < north.`);
  }

  return { west, south, east, north };
}

export function validateBounds(bounds, label = 'bounds') {
  return parseBounds(
    [bounds.west, bounds.south, bounds.east, bounds.north].join(','),
    label,
  );
}

export function boundsCenter(bounds) {
  return {
    latitude: (bounds.south + bounds.north) / 2,
    longitude: (bounds.west + bounds.east) / 2,
  };
}

/**
 * Must stay in sync with src/features/offline-regions/utils/calculateBounds.ts.
 * This is the coverage area the backend must build tiles for.
 */
export function expandBounds(bounds, bufferKm) {
  validateBounds(bounds);

  if (!Number.isFinite(bufferKm) || bufferKm <= 0) {
    return bounds;
  }

  const center = boundsCenter(bounds);
  const latitudeDelta = bufferKm / KM_PER_DEGREE_LAT;
  const longitudeScale = Math.cos((center.latitude * Math.PI) / 180);
  const longitudeDelta =
    Math.abs(longitudeScale) < 1e-6
      ? 180
      : bufferKm / (KM_PER_DEGREE_LON_AT_EQUATOR * Math.abs(longitudeScale));

  return validateBounds({
    west: Math.max(-180, bounds.west - longitudeDelta),
    south: Math.max(-85.05112878, bounds.south - latitudeDelta),
    east: Math.min(180, bounds.east + longitudeDelta),
    north: Math.min(85.05112878, bounds.north + latitudeDelta),
  });
}

export function boundsContain(container, inner, tolerance = 1e-5) {
  return (
    container.west <= inner.west + tolerance &&
    container.south <= inner.south + tolerance &&
    container.east >= inner.east - tolerance &&
    container.north >= inner.north - tolerance
  );
}

export function formatBbox(bounds) {
  validateBounds(bounds);
  return [bounds.west, bounds.south, bounds.east, bounds.north]
    .map((value) => value.toFixed(6))
    .join(',');
}

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

export async function walkFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    const relativePath = path
      .relative(root, absolutePath)
      .split(path.sep)
      .join('/');

    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to package a symbolic link: ${relativePath}`);
    }

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, absolutePath)));
      continue;
    }

    if (entry.isFile() && relativePath !== 'manifest.json') {
      files.push(absolutePath);
    }
  }

  return files;
}

export async function buildFileEntries(root) {
  const absoluteFiles = (await walkFiles(root)).sort();
  const entries = [];

  for (const absolutePath of absoluteFiles) {
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');

    if (relativePath.includes('\\') || relativePath.split('/').includes('..')) {
      throw new Error(`Unsafe package path: ${relativePath}`);
    }

    const info = await stat(absolutePath);

    if (!info.isFile() || info.size <= 0) {
      throw new Error(`Refusing to package an empty or non-regular file: ${relativePath}`);
    }

    entries.push({
      path: relativePath,
      url: relativePath,
      sizeBytes: info.size,
      sha256: await sha256File(absolutePath),
    });
  }

  return entries;
}

export function manifestDownloadBytes(manifest) {
  if (manifest.packageFormat === 'zip') {
    return manifest.archive?.sizeBytes ?? manifest.downloadSizeBytes;
  }

  return (
    manifest.files?.reduce((total, file) => total + file.sizeBytes, 0) ??
    manifest.downloadSizeBytes
  );
}
