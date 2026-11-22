#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildPlacesIndex } from '../routing-data/places.mjs';
import {
  createManifest,
  fileDigest,
  MANIFEST_FILE,
  readManifest,
  upsertPlaceTile,
  writeManifest,
} from './manifest.mjs';
import { parseTileName, placesAssetName } from './tiles.mjs';
import { readMirrorConfig } from './mirror.mjs';

const DEFAULT_CONFIG = path.join('tools', 'brouter-data', 'mirror.json');
const DEFAULT_DATA_DIR = path.join('tools', 'brouter-data', 'data');
const DEFAULT_OSMIUM_IMAGE = 'stefda/osmium-tool';

function run(command, args, { log = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    log(`$ ${command} ${args.join(' ')}`);
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} exited with code ${code}${
            stderr.trim() ? `: ${stderr.trim().split('\n').slice(-3).join(' ')}` : ''
          }`,
        ),
      );
    });
  });
}

async function extractOsmTile({
  sourcePbf,
  workDir,
  tile,
  local,
  docker,
  osmium,
  osmiumImage,
  log,
}) {
  const output = path.join(workDir, 'tile.osm.pbf');
  const bbox = [tile.west, tile.south, tile.east, tile.north].join(',');

  if (local) {
    await run(
      osmium,
      ['extract', '-b', bbox, sourcePbf, '-o', output, '--overwrite'],
      { log },
    );
  } else {
    const sourceDirectory = path.dirname(path.resolve(sourcePbf));
    await run(
      docker,
      [
        'run',
        '--rm',
        '-v',
        `${sourceDirectory}:/source:ro`,
        '-v',
        `${workDir}:/work`,
        osmiumImage,
        'extract',
        '-b',
        bbox,
        `/source/${path.basename(sourcePbf)}`,
        '-o',
        '/work/tile.osm.pbf',
        '--overwrite',
      ],
      { log },
    );
  }

  return output;
}

export async function buildPlaceTiles({
  sourcePbf,
  tiles,
  dataDir = DEFAULT_DATA_DIR,
  local = false,
  docker = 'docker',
  osmium = 'osmium',
  osmiumImage = DEFAULT_OSMIUM_IMAGE,
  allowEmpty = false,
  log = () => {},
}) {
  const placesDir = path.join(dataDir, 'places');
  const workRoot = path.join(dataDir, '.work', 'places');
  const manifestPath = path.join(dataDir, MANIFEST_FILE);
  const manifest = (await readManifest(manifestPath)) ?? createManifest();

  await mkdir(placesDir, { recursive: true });

  for (const name of [...new Set(tiles)].sort()) {
    const tile = parseTileName(name);
    const workDir = path.join(workRoot, name);
    const outputPath = path.join(placesDir, placesAssetName(name));

    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });

    log(`Building places index for ${name}`);

    try {
      await extractOsmTile({
        sourcePbf,
        workDir,
        tile,
        local,
        docker,
        osmium,
        osmiumImage,
        log,
      });

      const { count } = await buildPlacesIndex({
        workDir,
        osmFile: 'tile.osm.pbf',
        outputPath,
        local,
        docker,
        osmium,
        osmiumImage,
        log,
      });

      const digest = await fileDigest(outputPath);
      upsertPlaceTile(manifest, {
        name,
        file: placesAssetName(name),
        url: placesAssetName(name),
        entries: count,
        ...digest,
      });

      log(`${name}: ${count} places, ${(digest.sizeBytes / 1024).toFixed(0)} KB`);
    } catch (error) {
      if (allowEmpty) {
        log(`${name}: skipped (${error instanceof Error ? error.message : String(error)})`);
        await rm(outputPath, { force: true });
        continue;
      }
      throw error;
    }
  }

  await writeManifest(manifestPath, manifest);
  log(`Manifest: ${manifestPath}`);

  return { manifestPath, manifest };
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sourcePbf = option('--osm');
  const configPath = option('--config', DEFAULT_CONFIG);
  const dataDir = option('--data-dir', DEFAULT_DATA_DIR);
  const explicitTiles = option('--tiles');

  if (!sourcePbf) {
    console.error(
      'Usage: places-tile.mjs --osm <extract.osm.pbf> [--tiles E75_N25] [--config mirror.json] [--local]',
    );
    process.exit(2);
  }

  (async () => {
    const tiles = explicitTiles
      ? explicitTiles.split(',').map((tile) => tile.trim()).filter(Boolean)
      : (await readMirrorConfig(configPath)).tiles;

    if (tiles.length === 0) {
      throw new Error(`No tiles configured. Add tiles to ${configPath} or pass --tiles.`);
    }

    await buildPlaceTiles({
      sourcePbf,
      tiles,
      dataDir,
      local: process.argv.includes('--local'),
      allowEmpty: !process.argv.includes('--fail-on-empty'),
      log: (message) => console.log(message),
    });
  })().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
