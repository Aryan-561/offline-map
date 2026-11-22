#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

export const TILE_SIZE_DEGREES = 5;

const MAX_LATITUDE = 90;
const MIN_LATITUDE = -90;
const MAX_LONGITUDE = 180;
const MIN_LONGITUDE = -180;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function floorTile(value) {
  return Math.floor(value / TILE_SIZE_DEGREES) * TILE_SIZE_DEGREES;
}

function axisLabel(value, positive, negative) {
  if (value < 0) {
    return `${negative}${Math.abs(value)}`;
  }
  return `${positive}${value}`;
}

export function tileNameForCoordinate(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Tile coordinates must be finite numbers.');
  }

  const lat = clamp(latitude, MIN_LATITUDE, MAX_LATITUDE);
  const lon = clamp(longitude, MIN_LONGITUDE, MAX_LONGITUDE);

  const south = floorTile(lat === MAX_LATITUDE ? MAX_LATITUDE - TILE_SIZE_DEGREES : lat);
  const west = floorTile(lon === MAX_LONGITUDE ? MAX_LONGITUDE - TILE_SIZE_DEGREES : lon);

  return `${axisLabel(west, 'E', 'W')}_${axisLabel(south, 'N', 'S')}`;
}

export function parseTileName(name) {
  const match = /^([EW])(\d+)_([NS])(\d+)$/u.exec(name);

  if (!match) {
    throw new Error(`Invalid BRouter tile name: ${name}`);
  }

  const west = Number(match[2]) * (match[1] === 'W' ? -1 : 1);
  const south = Number(match[4]) * (match[3] === 'S' ? -1 : 1);

  if (match[2] === '180') {
    return { name, west: -180, south, east: -175, north: south + TILE_SIZE_DEGREES };
  }

  if (west % TILE_SIZE_DEGREES !== 0 || south % TILE_SIZE_DEGREES !== 0) {
    throw new Error(`Tile is not aligned to ${TILE_SIZE_DEGREES} degrees: ${name}`);
  }

  return {
    name,
    west,
    south,
    east: west + TILE_SIZE_DEGREES,
    north: south + TILE_SIZE_DEGREES,
  };
}

function normalizeBounds(bounds) {
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

  return { west, south, east, north };
}

export function tilesForBounds(bounds) {
  const normalized = normalizeBounds(bounds);
  const tiles = new Set();

  const firstSouth = floorTile(normalized.south);
  const lastSouth = floorTile(
    normalized.north === MAX_LATITUDE ? normalized.north - TILE_SIZE_DEGREES : normalized.north,
  );
  const firstWest = floorTile(normalized.west);
  const lastWest = floorTile(
    normalized.east === MAX_LONGITUDE ? normalized.east - TILE_SIZE_DEGREES : normalized.east,
  );

  for (let south = firstSouth; south <= lastSouth; south += TILE_SIZE_DEGREES) {
    for (let west = firstWest; west <= lastWest; west += TILE_SIZE_DEGREES) {
      tiles.add(tileNameForCoordinate(south, west));
    }
  }

  return [...tiles].sort();
}

export function tileUrl(name, baseUrl = 'https://brouter.de/brouter/segments4') {
  return `${baseUrl.replace(/\/+$/u, '')}/${name}.rd5`;
}

export function placesAssetName(name) {
  return `places-${name}.sqlite`;
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = option('--bounds');

  if (!raw) {
    console.error('Usage: tiles.mjs --bounds west,south,east,north');
    process.exit(2);
  }

  const [west, south, east, north] = raw.split(',').map(Number);

  try {
    const names = tilesForBounds({ west, south, east, north });

    if (process.argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify(names, null, 2)}\n`);
    } else {
      process.stdout.write(`${names.join('\n')}\n`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

