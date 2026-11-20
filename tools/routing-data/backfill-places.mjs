#!/usr/bin/env node
/**
 * Adds the offline place-name index (`places.sqlite`) to already-built routing
 * packages without rebuilding the Valhalla tiles.
 *
 * Packages built before the places index existed (or whose index build was
 * skipped) cannot answer offline place search. This script clips the configured
 * OSM extract to each package's coverage bounds, builds the FTS5 index, writes
 * it into the package, and updates `manifest.json` so the app downloads it.
 *
 * Usage:
 *   node --env-file-if-exists=tools/routing-data/.env \
 *     tools/routing-data/backfill-places.mjs [options]
 *
 * Options:
 *   --region-id <id>   Only backfill this region (repeatable).
 *   --force            Rebuild places.sqlite even when one is already listed.
 *   --local            Use osmium from PATH instead of the Docker image.
 *   --dry-run          Build and validate but do not modify packages.
 *   --keep-work        Keep the clipped OSM extract for inspection.
 *   --data-dir <dir>   Routing region directory (default tools/routing-data/data/regions).
 */
import { spawn } from 'node:child_process';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  parseConfiguredSources,
  resolveSourceFile,
  selectOsmSource,
} from './builder.mjs';
import { formatBbox, sha256File } from './lib.mjs';
import { buildPlacesIndex } from './places.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.join(SCRIPT_DIR, 'data', 'regions');
const DEFAULT_OSMIUM_IMAGE = 'stefda/osmium-tool';
const REGION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const PLACES_FILE = 'places.sqlite';

async function placesIndexEntries(filePath) {
  const { DatabaseSync } = await import('node:sqlite');
  let database = null;

  try {
    database = new DatabaseSync(filePath);
    const row = database
      .prepare('SELECT COUNT(*) AS count FROM places')
      .get();
    return Number(row?.count ?? 0);
  } catch {
    return 0;
  } finally {
    database?.close();
  }
}

async function readManifest(packageDir) {
  const text = await readFile(path.join(packageDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(text);

  if (!manifest || typeof manifest !== 'object') {
    throw new Error('manifest.json is not an object.');
  }

  return manifest;
}

function listedPlacesFile(manifest) {
  if (!Array.isArray(manifest.files)) {
    return null;
  }

  return manifest.files.find((file) => file?.path === PLACES_FILE) ?? null;
}

export function coverageBounds(manifest) {
  const bounds = manifest.coverageBounds ?? manifest.bounds;

  if (
    !bounds ||
    !['west', 'south', 'east', 'north'].every(
      (key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]),
    )
  ) {
    throw new Error('Manifest has invalid coverage bounds.');
  }

  return bounds;
}

/**
 * Adds or replaces the places.sqlite entry in a directory package manifest.
 * Recomputes `downloadSizeBytes` from the remaining file list.
 */
export async function updateManifestWithPlaces({
  manifest,
  packageDir,
  placesCount,
}) {
  if (manifest.packageFormat !== 'directory') {
    throw new Error(
      'Only directory packages can be backfilled. Rebuild ZIP packages from source.',
    );
  }

  const placesPath = path.join(packageDir, PLACES_FILE);
  const info = await stat(placesPath);

  if (!info.isFile() || info.size <= 0) {
    throw new Error(`${PLACES_FILE} is empty.`);
  }

  const files = (Array.isArray(manifest.files) ? manifest.files : []).filter(
    (file) => file?.path !== PLACES_FILE,
  );

  files.push({
    path: PLACES_FILE,
    url: PLACES_FILE,
    sizeBytes: info.size,
    sha256: await sha256File(placesPath),
  });
  files.sort((left, right) => left.path.localeCompare(right.path));

  const downloadSizeBytes = files.reduce(
    (total, file) => total + file.sizeBytes,
    0,
  );

  const updated = {
    ...manifest,
    files,
    downloadSizeBytes,
    metadata: {
      ...(manifest.metadata ?? {}),
      placesIndex: {
        file: PLACES_FILE,
        entries: placesCount,
      },
    },
  };

  await writeFile(
    path.join(packageDir, 'manifest.json'),
    `${JSON.stringify(updated, null, 2)}\n`,
    'utf8',
  );

  return updated;
}

function run(command, args, { log = () => {} } = {}) {
  log(`$ ${command} ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8_000) {
        stderr = stderr.slice(-8_000);
      }
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
            stderr.trim()
              ? `: ${stderr.trim().split('\n').slice(-5).join(' ')}`
              : ''
          }`,
        ),
      );
    });
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function clipSource({
  sourcePath,
  workDir,
  bounds,
  docker,
  osmiumImage,
  local,
  log,
}) {
  const target = path.join(workDir, 'region.osm.pbf');
  const bbox = formatBbox(bounds);

  if (local) {
    await run(
      'osmium',
      ['extract', '--overwrite', '-b', bbox, '-o', target, sourcePath],
      { log },
    );
    return target;
  }

  const sourceDir = path.dirname(sourcePath);
  const sourceName = path.basename(sourcePath);

  await run(
    docker,
    [
      'run',
      '--rm',
      '-v',
      `${sourceDir}:/source:ro`,
      '-v',
      `${workDir}:/work`,
      osmiumImage,
      'bash',
      '-lc',
      `osmium extract --overwrite -b ${shellQuote(bbox)} -o /work/region.osm.pbf ${shellQuote(`/source/${sourceName}`)}`,
    ],
    { log },
  );

  return target;
}

export async function backfillRegion({
  regionId,
  packageDir,
  dataDir,
  sources,
  docker = 'docker',
  osmiumImage = DEFAULT_OSMIUM_IMAGE,
  local = false,
  force = false,
  dryRun = false,
  keepWork = false,
  log = console.log,
}) {
  const manifest = await readManifest(packageDir);

  if (manifest.regionId !== regionId) {
    throw new Error(
      `manifest.json belongs to "${manifest.regionId}", not "${regionId}".`,
    );
  }

  if (manifest.packageFormat !== 'directory') {
    log(
      `Skipping ${regionId}: only directory packages can be backfilled. Rebuild ZIP packages from source.`,
    );
    return { status: 'skipped' };
  }

  const bounds = coverageBounds(manifest);
  const placesPath = path.join(packageDir, PLACES_FILE);
  const listed = listedPlacesFile(manifest);
  const existing = await stat(placesPath).catch(() => null);
  const existingCount =
    listed && existing?.isFile() && existing.size > 0
      ? await placesIndexEntries(placesPath)
      : 0;

  if (!force && existingCount > 0) {
    log(
      `${regionId}: places.sqlite already has ${existingCount} entries, skipping. Use --force to rebuild.`,
    );
    return { status: 'skipped' };
  }

  const source = selectOsmSource(sources, bounds);
  const resolved = await resolveSourceFile(source, dataDir, log);
  const workDir = path.join(path.dirname(dataDir), '.work', 'backfill-places', regionId);

  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  try {
    const osmFile = await clipSource({
      sourcePath: resolved.filePath,
      workDir,
      bounds,
      docker,
      osmiumImage,
      local,
      log,
    });

    const temporaryOutput = path.join(workDir, PLACES_FILE);
    const { count } = await buildPlacesIndex({
      workDir,
      osmFile: path.basename(osmFile),
      outputPath: temporaryOutput,
      docker,
      osmiumImage,
      local,
      log,
    });

    if (dryRun) {
      log(`${regionId}: would add places.sqlite with ${count} entries (dry run).`);
      return { status: 'dry-run', count };
    }

    await rename(temporaryOutput, placesPath);
    const updated = await updateManifestWithPlaces({
      manifest,
      packageDir,
      placesCount: count,
    });

    log(
      `${regionId}: added places.sqlite (${count} entries), package now ${updated.downloadSizeBytes} bytes.`,
    );

    return { status: 'backfilled', count, manifest: updated };
  } finally {
    if (!keepWork) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function optionValues(name) {
  const values = [];

  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }

  return values;
}

function option(name, fallback) {
  return optionValues(name).at(-1) ?? fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

async function usableDockerFallback(docker) {
  const socket = '/var/run/docker.sock';

  try {
    await stat(socket);
  } catch {
    return false;
  }

  const previous = process.env.DOCKER_HOST;
  process.env.DOCKER_HOST = `unix://${socket}`;

  try {
    await run(docker, ['version', '--format', '{{.Server.Version}}'], {
      log: () => {},
    });
    console.warn(
      `Using Docker at ${process.env.DOCKER_HOST} (DOCKER_HOST was ${
        previous ?? 'unset'
      }).`,
    );
    return true;
  } catch {
    if (previous === undefined) {
      delete process.env.DOCKER_HOST;
    } else {
      process.env.DOCKER_HOST = previous;
    }
    return false;
  }
}

async function main() {
  const dataDir = path.resolve(
    option('--data-dir', process.env.ROUTING_DATA_DIR ?? DEFAULT_DATA_DIR),
  );
  const requestedIds = optionValues('--region-id');
  const force = flag('--force');
  const local = flag('--local');
  const dryRun = flag('--dry-run');
  const keepWork = flag('--keep-work');
  const docker = process.env.ROUTING_DOCKER_BIN?.trim() || 'docker';
  const osmiumImage =
    process.env.ROUTING_OSMIUM_IMAGE?.trim() || DEFAULT_OSMIUM_IMAGE;
  const log = (message) => console.log(message);

  let entries;

  try {
    entries = await readdir(dataDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.error(`Routing data directory not found: ${dataDir}`);
      process.exit(1);
    }
    throw error;
  }

  const available = entries
    .filter((entry) => entry.isDirectory() && REGION_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  for (const id of requestedIds) {
    if (!available.includes(id)) {
      console.error(`Unknown region "${id}". Available: ${available.join(', ') || '(none)'}`);
      process.exit(1);
    }
  }

  const regionIds = requestedIds.length > 0 ? [...new Set(requestedIds)] : available;

  if (regionIds.length === 0) {
    console.error(`No region packages found under ${dataDir}.`);
    process.exit(1);
  }

  if (!local) {
    try {
      await run(docker, ['version', '--format', '{{.Server.Version}}'], {
        log: () => {},
      });
    } catch (error) {
      const fallback = await usableDockerFallback(docker);

      if (!fallback) {
        console.error(
          `Docker is required to build places.sqlite (${
            error instanceof Error ? error.message : String(error)
          }).`,
        );
        console.error('Start Docker, or pass --local to use osmium from PATH.');
        process.exit(1);
      }
    }
  }

  const sources = parseConfiguredSources();
  const results = [];

  for (const regionId of regionIds) {
    try {
      results.push({
        regionId,
        ...(await backfillRegion({
          regionId,
          packageDir: path.join(dataDir, regionId),
          dataDir,
          sources,
          docker,
          osmiumImage,
          local,
          force,
          dryRun,
          keepWork,
          log,
        })),
      });
    } catch (error) {
      results.push({ regionId, status: 'failed' });
      console.error(
        `${regionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const backfilled = results.filter((result) => result.status === 'backfilled');
  const skipped = results.filter((result) => result.status === 'skipped');
  const failed = results.filter((result) => result.status === 'failed');

  console.log(
    `\nBackfill summary: ${backfilled.length} updated, ${skipped.length} skipped, ${failed.length} failed.`,
  );

  if (failed.length > 0) {
    console.log(
      'Re-download or rebuild the failed packages, or run again with --force after fixing the OSM source.',
    );
    process.exit(1);
  }

  if (backfilled.length > 0 && !dryRun) {
    console.log(
      'Restart the routing-data server and re-download the affected regions in the app so the new manifest and places.sqlite reach the device.',
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
