import type { OfflineRegionBounds } from '../types/offlineRegion.types';

export const BROUTER_TILE_SIZE_DEGREES = 5;

const MAX_LATITUDE = 90;
const MIN_LATITUDE = -90;
const MAX_LONGITUDE = 180;
const MIN_LONGITUDE = -180;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function floorTile(value: number): number {
  return Math.floor(value / BROUTER_TILE_SIZE_DEGREES) * BROUTER_TILE_SIZE_DEGREES;
}

function axisLabel(value: number, positive: string, negative: string): string {
  if (value < 0) {
    return `${negative}${Math.abs(value)}`;
  }
  return `${positive}${value}`;
}

export function tileNameForCoordinate(
  latitude: number,
  longitude: number,
): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Tile coordinates must be finite numbers.');
  }

  const lat = clamp(latitude, MIN_LATITUDE, MAX_LATITUDE);
  const lon = clamp(longitude, MIN_LONGITUDE, MAX_LONGITUDE);

  const south = floorTile(
    lat === MAX_LATITUDE ? MAX_LATITUDE - BROUTER_TILE_SIZE_DEGREES : lat,
  );
  const west = floorTile(
    lon === MAX_LONGITUDE ? MAX_LONGITUDE - BROUTER_TILE_SIZE_DEGREES : lon,
  );

  return `${axisLabel(west, 'E', 'W')}_${axisLabel(south, 'N', 'S')}`;
}

export function parseTileName(name: string): {
  name: string;
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const match = /^([EW])(\d+)_([NS])(\d+)$/u.exec(name);

  if (!match) {
    throw new Error(`Invalid BRouter tile name: ${name}`);
  }

  const west = Number(match[2]) * (match[1] === 'W' ? -1 : 1);
  const south = Number(match[4]) * (match[3] === 'S' ? -1 : 1);

  if (
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    west < -180 ||
    west > 180 ||
    south < -90 ||
    south > 90
  ) {
    throw new Error(`BRouter tile is outside the world: ${name}`);
  }

  return {
    name,
    west,
    south,
    east: Math.min(MAX_LONGITUDE, west + BROUTER_TILE_SIZE_DEGREES),
    north: Math.min(MAX_LATITUDE, south + BROUTER_TILE_SIZE_DEGREES),
  };
}

export function tilesForBounds(bounds: OfflineRegionBounds): string[] {
  const west = Number(bounds.west);
  const south = Number(bounds.south);
  const east = Number(bounds.east);
  const north = Number(bounds.north);

  if (![west, south, east, north].every(Number.isFinite)) {
    throw new Error('Bounds must contain finite west, south, east and north values.');
  }

  if (west < MIN_LONGITUDE || east > MAX_LONGITUDE) {
    throw new Error('Longitudes must be between -180 and 180.');
  }

  if (south < MIN_LATITUDE || north > MAX_LATITUDE) {
    throw new Error('Latitudes must be between -90 and 90.');
  }

  if (west >= east) {
    throw new Error('West must be less than east. Antimeridian regions are not supported.');
  }

  if (south >= north) {
    throw new Error('South must be less than north.');
  }

  const tiles = new Set<string>();
  const firstSouth = floorTile(south);
  const lastSouth = floorTile(
    north === MAX_LATITUDE ? north - BROUTER_TILE_SIZE_DEGREES : north,
  );
  const firstWest = floorTile(west);
  const lastWest = floorTile(
    east === MAX_LONGITUDE ? east - BROUTER_TILE_SIZE_DEGREES : east,
  );

  for (
    let tileSouth = firstSouth;
    tileSouth <= lastSouth;
    tileSouth += BROUTER_TILE_SIZE_DEGREES
  ) {
    for (
      let tileWest = firstWest;
      tileWest <= lastWest;
      tileWest += BROUTER_TILE_SIZE_DEGREES
    ) {
      tiles.add(tileNameForCoordinate(tileSouth, tileWest));
    }
  }

  return [...tiles].sort();
}

export function brouterPlacesDatabaseName(tileName: string): string {
  return `places-${tileName}.sqlite`;
}
