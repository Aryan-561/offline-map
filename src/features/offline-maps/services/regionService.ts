import { MAX_MERCATOR_LATITUDE } from '@/constants/map';

import {
  OfflineMapsError,
  type OfflineBounds,
  type StyleCapabilities,
} from '../types/offlineMap';

const EARTH_KM_PER_DEGREE_LAT = 110.574;
const EARTH_KM_PER_DEGREE_LON_AT_EQUATOR = 111.32;
const MIN_ZOOM = 0;
const MAX_ZOOM = 22;
export const MAX_ESTIMATED_TILES = 250_000;

export function validateBounds(bounds: OfflineBounds): OfflineBounds {
  if (!Array.isArray(bounds) || bounds.length !== 4) {
    throw new OfflineMapsError(
      'invalid_bounds',
      'Bounds must be [west, south, east, north].',
    );
  }

  const [west, south, east, north] = bounds;

  if (![west, south, east, north].every((value) => Number.isFinite(value))) {
    throw new OfflineMapsError('invalid_bounds', 'Bounds must contain finite numbers.');
  }

  if (west < -180 || west > 180 || east < -180 || east > 180) {
    throw new OfflineMapsError(
      'invalid_bounds',
      'Longitudes must be between -180 and 180 degrees.',
    );
  }

  if (
    south < -MAX_MERCATOR_LATITUDE ||
    south > MAX_MERCATOR_LATITUDE ||
    north < -MAX_MERCATOR_LATITUDE ||
    north > MAX_MERCATOR_LATITUDE
  ) {
    throw new OfflineMapsError(
      'invalid_bounds',
      `Latitudes must be between -${MAX_MERCATOR_LATITUDE.toFixed(4)} and ${MAX_MERCATOR_LATITUDE.toFixed(4)} degrees.`,
    );
  }

  if (west >= east) {
    throw new OfflineMapsError(
      'invalid_bounds',
      'West longitude must be less than east longitude. Regions crossing the antimeridian are not supported.',
    );
  }

  if (south >= north) {
    throw new OfflineMapsError(
      'invalid_bounds',
      'South latitude must be less than north latitude.',
    );
  }

  return [west, south, east, north];
}

export function boundsForRadius(
  latitude: number,
  longitude: number,
  radiusKm: number,
): OfflineBounds {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new OfflineMapsError('invalid_bounds', 'A valid location is required.');
  }

  if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
    throw new OfflineMapsError('invalid_bounds', 'Radius must be greater than zero.');
  }

  const latitudeDelta = radiusKm / EARTH_KM_PER_DEGREE_LAT;
  const longitudeScale = Math.cos((latitude * Math.PI) / 180);
  const longitudeDelta =
    Math.abs(longitudeScale) < 1e-6
      ? 180
      : radiusKm / (EARTH_KM_PER_DEGREE_LON_AT_EQUATOR * Math.abs(longitudeScale));

  const south = clamp(latitude - latitudeDelta, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const north = clamp(latitude + latitudeDelta, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  let west = clamp(longitude - longitudeDelta, -180, 180);
  let east = clamp(longitude + longitudeDelta, -180, 180);

  if (west === -180 && longitudeDelta >= 180) {
    west = -179.999999;
  }
  if (east === 180 && longitudeDelta >= 180) {
    east = 179.999999;
  }

  return validateBounds([west, south, east, north]);
}

/**
 * Rough number of tiles the native downloader will need. Used to warn before a
 * very large download is queued; it is an estimate, not an exact count.
 */
export function estimateTileCount(
  bounds: OfflineBounds,
  minZoom: number,
  maxZoom: number,
): number {
  const [west, south, east, north] = bounds;
  let total = 0;

  for (let zoom = Math.max(MIN_ZOOM, minZoom); zoom <= Math.min(MAX_ZOOM, maxZoom); zoom += 1) {
    const tilesPerAxis = 2 ** zoom;
    const x0 = clamp(Math.floor(((west + 180) / 360) * tilesPerAxis), 0, tilesPerAxis - 1);
    const x1 = clamp(Math.floor(((east + 180) / 360) * tilesPerAxis), 0, tilesPerAxis - 1);
    const y0 = latitudeToTileY(north, tilesPerAxis);
    const y1 = latitudeToTileY(south, tilesPerAxis);

    total += (x1 - x0 + 1) * (y1 - y0 + 1);

    if (total > MAX_ESTIMATED_TILES) {
      return total;
    }
  }

  return total;
}

export function assertReasonableTileCount(
  bounds: OfflineBounds,
  minZoom: number,
  maxZoom: number,
): number {
  const count = estimateTileCount(bounds, minZoom, maxZoom);

  if (count > MAX_ESTIMATED_TILES) {
    throw new OfflineMapsError(
      'storage',
      `This region needs more than ${MAX_ESTIMATED_TILES.toLocaleString()} tiles. Reduce the area or the maximum zoom.`,
    );
  }

  return count;
}

export function assertZoomRange(
  minZoom: number,
  maxZoom: number,
  capabilities: StyleCapabilities,
): void {
  if (!Number.isInteger(minZoom) || !Number.isInteger(maxZoom)) {
    throw new OfflineMapsError('invalid_zoom', 'Zoom levels must be whole numbers.');
  }

  if (minZoom < capabilities.minZoom || maxZoom > capabilities.maxZoom) {
    throw new OfflineMapsError(
      'invalid_zoom',
      `This style can be downloaded between zoom ${capabilities.minZoom} and ${capabilities.maxZoom}.`,
    );
  }

  if (minZoom > maxZoom) {
    throw new OfflineMapsError(
      'invalid_zoom',
      'Minimum zoom must be less than or equal to maximum zoom.',
    );
  }
}

export function defaultZoomRange(capabilities: StyleCapabilities): {
  minZoom: number;
  maxZoom: number;
} {
  const maxZoom = Math.min(capabilities.maxZoom, 22);
  const minZoom = Math.max(capabilities.minZoom, maxZoom - 3);

  return { minZoom, maxZoom };
}

export function boundsCenter(bounds: OfflineBounds): [longitude: number, latitude: number] {
  const [west, south, east, north] = bounds;
  return [(west + east) / 2, (south + north) / 2];
}

export function boundsKey(
  bounds: OfflineBounds,
  minZoom: number,
  maxZoom: number,
): string {
  return `${bounds.map((value) => value.toFixed(5)).join(',')}:${minZoom}-${maxZoom}`;
}

export function boundsMatch(a: OfflineBounds, b: OfflineBounds, tolerance = 1e-5): boolean {
  return a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
}

export function formatBounds(bounds: OfflineBounds): string {
  const [west, south, east, north] = bounds;
  return `${south.toFixed(4)}, ${west.toFixed(4)} → ${north.toFixed(4)}, ${east.toFixed(4)}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function latitudeToTileY(latitude: number, tilesPerAxis: number): number {
  const latRad = (clamp(latitude, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE) * Math.PI) / 180;
  const value =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * tilesPerAxis;

  return clamp(Math.floor(value), 0, tilesPerAxis - 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
