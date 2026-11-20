import {
  boundsForRadius as tupleBoundsForRadius,
  boundsCenter as tupleBoundsCenter,
  estimateTileCount,
  formatBounds as formatTupleBounds,
  validateBounds as validateTupleBounds,
} from '@/features/offline-maps/services/regionService';
import { OfflineMapsError } from '@/features/offline-maps/types/offlineMap';

import {
  OfflineRegionsError,
  fromLngLatBounds,
  toLngLatBounds,
  type OfflineRegionBounds,
  type OfflineRegionCoordinate,
} from '../types/offlineRegion.types';

const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_DEGREE_LAT = 110.574;
const KM_PER_DEGREE_LON_AT_EQUATOR = 111.32;

export function validateCenter(center: OfflineRegionCoordinate): void {
  if (
    !Number.isFinite(center.latitude) ||
    !Number.isFinite(center.longitude) ||
    center.latitude < -90 ||
    center.latitude > 90 ||
    center.longitude < -180 ||
    center.longitude > 180
  ) {
    throw new OfflineRegionsError('invalid_bounds', 'Choose a valid center coordinate.');
  }
}

export function validateRadius(radiusKm: number): void {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
    throw new OfflineRegionsError('invalid_radius', 'Radius must be greater than zero.');
  }

  if (radiusKm > 500) {
    throw new OfflineRegionsError(
      'invalid_radius',
      'Radius must be 500 km or less. Download a smaller region to keep the routing package manageable.',
    );
  }
}

export function validateRegionBounds(bounds: OfflineRegionBounds): OfflineRegionBounds {
  try {
    validateTupleBounds(toLngLatBounds(bounds));
    return bounds;
  } catch (error) {
    if (error instanceof OfflineMapsError) {
      throw new OfflineRegionsError('invalid_bounds', error.message, { cause: error });
    }
    throw error;
  }
}

export function boundsForRadius(
  center: OfflineRegionCoordinate,
  radiusKm: number,
): OfflineRegionBounds {
  validateCenter(center);
  validateRadius(radiusKm);

  try {
    return fromLngLatBounds(
      tupleBoundsForRadius(center.latitude, center.longitude, radiusKm),
    );
  } catch (error) {
    if (error instanceof OfflineMapsError) {
      throw new OfflineRegionsError('invalid_bounds', error.message, { cause: error });
    }
    throw error;
  }
}

export function boundsCenter(bounds: OfflineRegionBounds): OfflineRegionCoordinate {
  const [longitude, latitude] = tupleBoundsCenter(toLngLatBounds(bounds));
  return { latitude, longitude };
}

/**
 * Smallest integer radius that contains every corner of the bounds. Used when
 * attaching routing to a map area that was downloaded without one.
 */
export function radiusKmForBounds(bounds: OfflineRegionBounds): number {
  const center = boundsCenter(bounds);
  const corners: OfflineRegionCoordinate[] = [
    { latitude: bounds.south, longitude: bounds.west },
    { latitude: bounds.south, longitude: bounds.east },
    { latitude: bounds.north, longitude: bounds.west },
    { latitude: bounds.north, longitude: bounds.east },
  ];
  const radius = Math.max(
    ...corners.map((corner) => distanceKm(center, corner)),
  );

  return Math.max(1, Math.ceil(radius));
}

export function formatBounds(bounds: OfflineRegionBounds): string {
  return formatTupleBounds(toLngLatBounds(bounds));
}

export function estimateMapTileCount(
  bounds: OfflineRegionBounds,
  minZoom: number,
  maxZoom: number,
): number {
  return estimateTileCount(toLngLatBounds(bounds), minZoom, maxZoom);
}

export function estimateMapSizeBytes(
  bounds: OfflineRegionBounds,
  minZoom: number,
  maxZoom: number,
  averageTileBytes: number,
  resourceOverheadBytes: number,
): number {
  const tiles = estimateMapTileCount(bounds, minZoom, maxZoom);
  return Math.round(tiles * averageTileBytes + resourceOverheadBytes);
}

/**
 * True when `container` fully contains `inner`, with a small tolerance for
 * floating-point differences. Used to reject routing packages whose buffered
 * coverage does not cover the selected map region.
 */
export function boundsContain(
  container: OfflineRegionBounds,
  inner: OfflineRegionBounds,
  tolerance = 1e-5,
): boolean {
  return (
    container.west <= inner.west + tolerance &&
    container.south <= inner.south + tolerance &&
    container.east >= inner.east - tolerance &&
    container.north >= inner.north - tolerance
  );
}

export function expandBoundsByKm(
  bounds: OfflineRegionBounds,
  bufferKm: number,
): OfflineRegionBounds {
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

  return validateRegionBounds({
    west: Math.max(-180, bounds.west - longitudeDelta),
    south: Math.max(-85.05112878, bounds.south - latitudeDelta),
    east: Math.min(180, bounds.east + longitudeDelta),
    north: Math.min(85.05112878, bounds.north + latitudeDelta),
  });
}

export function distanceKm(
  a: OfflineRegionCoordinate,
  b: OfflineRegionCoordinate,
): number {
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const deltaLat = lat2 - lat1;
  const deltaLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Rough camera zoom that fits a radius in a phone-sized viewport. Only used for
 * the visual preview, never for download calculations.
 */
export function zoomForRadius(radiusKm: number): number {
  const safeRadius = Math.max(0.25, radiusKm);
  const meters = safeRadius * 2_000;
  const zoom = Math.log2(40_075_016 / Math.max(1, meters)) - 1.2;
  return Math.max(3, Math.min(16, Math.round(zoom * 10) / 10));
}

export function createRegionId(): string {
  return `region_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function boundsEqual(
  a: OfflineRegionBounds,
  b: OfflineRegionBounds,
  tolerance = 1e-5,
): boolean {
  return (
    Math.abs(a.west - b.west) <= tolerance &&
    Math.abs(a.south - b.south) <= tolerance &&
    Math.abs(a.east - b.east) <= tolerance &&
    Math.abs(a.north - b.north) <= tolerance
  );
}
