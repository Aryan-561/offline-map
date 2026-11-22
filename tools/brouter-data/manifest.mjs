#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_SEGMENT_SOURCE = 'https://brouter.de/brouter/segments4';
export const MANIFEST_FILE = 'brouter-manifest.json';

export function createManifest({ source = DEFAULT_SEGMENT_SOURCE } = {}) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source,
    segments: { source, tiles: [] },
    places: { tiles: [] },
    profiles: { version: null, files: [] },
  };
}

export async function readManifest(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return validateManifest(parsed);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeManifest(file, manifest) {
  const validated = validateManifest(manifest);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
  return validated;
}

export function validateManifest(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Manifest must be an object.');
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported manifest schema version: ${value.schemaVersion}`);
  }

  const segments = value.segments ?? {};
  const tiles = Array.isArray(segments.tiles) ? segments.tiles : [];
  const places = Array.isArray(value.places?.tiles) ? value.places.tiles : [];

  for (const tile of [...tiles, ...places]) {
    if (typeof tile.name !== 'string' || !/^[EW]\d+_[NS]\d+$/u.test(tile.name)) {
      throw new Error(`Invalid tile entry name: ${tile.name}`);
    }
    if (typeof tile.file !== 'string' || tile.file.length === 0) {
      throw new Error(`Tile ${tile.name} is missing a file name.`);
    }
    if (!Number.isInteger(tile.sizeBytes) || tile.sizeBytes <= 0) {
      throw new Error(`Tile ${tile.name} has an invalid size.`);
    }
    if (typeof tile.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(tile.sha256)) {
      throw new Error(`Tile ${tile.name} has an invalid SHA-256.`);
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : new Date().toISOString(),
    source: typeof value.source === 'string' ? value.source : DEFAULT_SEGMENT_SOURCE,
    segments: {
      source: typeof segments.source === 'string' ? segments.source : DEFAULT_SEGMENT_SOURCE,
      tiles: dedupeBy(tiles, (tile) => tile.name),
    },
    places: {
      tiles: dedupeBy(places, (tile) => tile.name),
    },
    profiles: {
      version: typeof value.profiles?.version === 'string' ? value.profiles.version : null,
      files: Array.isArray(value.profiles?.files) ? value.profiles.files : [],
    },
  };
}

export function upsertSegmentTile(manifest, tile) {
  manifest.segments.tiles = upsertBy(manifest.segments.tiles, tile, (item) => item.name);
  manifest.generatedAt = new Date().toISOString();
}

export function upsertPlaceTile(manifest, tile) {
  manifest.places.tiles = upsertBy(manifest.places.tiles, tile, (item) => item.name);
  manifest.generatedAt = new Date().toISOString();
}

export async function fileDigest(file) {
  const hash = createHash('sha256');
  const stream = createReadStream(file);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  const info = await stat(file);

  return { sizeBytes: info.size, sha256: hash.digest('hex') };
}

function upsertBy(list, item, key) {
  const next = list.filter((entry) => key(entry) !== key(item));
  next.push(item);
  return next.sort((a, b) => key(a).localeCompare(key(b)));
}

function dedupeBy(list, key) {
  return [...new Map(list.map((item) => [key(item), item])).values()].sort((a, b) =>
    key(a).localeCompare(key(b)),
  );
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifestPath = option('--manifest', path.join('tools', 'brouter-data', MANIFEST_FILE));
  const file = option('--file');
  const name = option('--name');
  const kind = option('--kind', 'segment');

  if (!file || !name) {
    console.error(
      'Usage: manifest.mjs --manifest <file> --name <tile> --file <asset> [--kind segment|place]',
    );
    process.exit(2);
  }

  (async () => {
    const manifest = (await readManifest(manifestPath)) ?? createManifest();
    const digest = await fileDigest(file);
    const entry = { name, file: path.basename(file), ...digest };

    if (kind === 'place') {
      upsertPlaceTile(manifest, entry);
    } else {
      upsertSegmentTile(manifest, entry);
    }

    await writeManifest(manifestPath, manifest);
  })().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
