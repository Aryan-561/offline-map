#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

import {
  createManifest,
  DEFAULT_SEGMENT_SOURCE,
  fileDigest,
  MANIFEST_FILE,
  readManifest,
  upsertSegmentTile,
  writeManifest,
} from './manifest.mjs';
import { tileUrl } from './tiles.mjs';

const DEFAULT_CONFIG = path.join('tools', 'brouter-data', 'mirror.json');
const DEFAULT_DATA_DIR = path.join('tools', 'brouter-data', 'data');

async function fetchTile(url, destination, { retries = 3, timeoutMs = 120_000 } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });

        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status} for ${url}`);
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (/text\/html/iu.test(contentType)) {
          throw new Error(`Received HTML instead of an rd5 segment: ${url}`);
        }

        await mkdir(path.dirname(destination), { recursive: true });
        const temporary = `${destination}.part`;
        await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));

        const digest = await fileDigest(temporary);
        if (digest.sizeBytes < 1024) {
          await rm(temporary, { force: true });
          throw new Error(`Downloaded segment is unexpectedly small: ${url}`);
        }

        await rename(temporary, destination);
        return digest;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function readMirrorConfig(file) {
  const { readFile } = await import('node:fs/promises');
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  const tiles = Array.isArray(parsed.tiles) ? parsed.tiles : [];

  return {
    tiles: tiles.filter((tile) => typeof tile === 'string' && tile.length > 0),
  };
}

export async function mirrorSegments({
  tiles,
  dataDir = DEFAULT_DATA_DIR,
  source = DEFAULT_SEGMENT_SOURCE,
  concurrency = 2,
  log = () => {},
}) {
  const segmentsDir = path.join(dataDir, 'segments4');
  const manifestPath = path.join(dataDir, MANIFEST_FILE);
  const manifest = (await readManifest(manifestPath)) ?? createManifest({ source });

  await mapLimit([...new Set(tiles)].sort(), concurrency, async (name) => {
    const destination = path.join(segmentsDir, `${name}.rd5`);
    log(`Downloading ${name}`);
    const digest = await fetchTile(tileUrl(name, source), destination);

    upsertSegmentTile(manifest, {
      name,
      file: `${name}.rd5`,
      url: `${name}.rd5`,
      ...digest,
    });

    log(`${name}: ${(digest.sizeBytes / 1024 / 1024).toFixed(1)} MB`);
  });

  await writeManifest(manifestPath, manifest);
  log(`Manifest: ${manifestPath}`);

  return { manifestPath, manifest };
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const configPath = option('--config', DEFAULT_CONFIG);
  const dataDir = option('--data-dir', DEFAULT_DATA_DIR);
  const source = option('--source', process.env.BROUTER_SEGMENT_SOURCE ?? DEFAULT_SEGMENT_SOURCE);
  const explicitTiles = option('--tiles');

  (async () => {
    const tiles = explicitTiles
      ? explicitTiles.split(',').map((tile) => tile.trim()).filter(Boolean)
      : (await readMirrorConfig(configPath)).tiles;

    if (tiles.length === 0) {
      throw new Error(
        `No tiles configured. Add tiles to ${configPath} or pass --tiles.`,
      );
    }

    await mirrorSegments({
      tiles,
      dataDir,
      source,
      concurrency: Number(option('--concurrency', '2')),
      log: (message) => console.log(message),
    });
  })().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export { fetchTile };
