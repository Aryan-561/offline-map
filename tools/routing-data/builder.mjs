#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { buildPlacesIndex } from './places.mjs';
import {
  DEFAULT_ENGINE_VERSION,
  boundsContain,
  expandBounds,
  formatBbox,
  parseBounds,
  validateBounds,
} from './lib.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR_NAME = 'sources';
const DEFAULT_SOURCE_URL =
  'https://download.openstreetmap.fr/extracts/asia/india-latest.osm.pbf';
const DEFAULT_SOURCE_BOUNDS = {
  west: 68,
  south: 6,
  east: 98,
  north: 36,
};

export function parseConfiguredSources(env = process.env) {
  const raw = env.ROUTING_OSM_SOURCES?.trim();

  if (raw) {
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('ROUTING_OSM_SOURCES must be valid JSON.');
    }

    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.sources)
        ? parsed.sources
        : null;

    if (!entries) {
      throw new Error('ROUTING_OSM_SOURCES must be an array or { sources: [] }.');
    }

    if (entries.length === 0) {
      throw new Error('ROUTING_OSM_SOURCES must contain at least one source.');
    }

    return entries.map((entry, index) => normalizeSource(entry, index));
  }

  const extract = env.ROUTING_OSM_EXTRACT?.trim();

  if (extract) {
    return [{ path: path.resolve(extract) }];
  }

  const url = env.ROUTING_OSM_SOURCE_URL?.trim();

  if (url) {
    return [{ url }];
  }

  return [{ url: DEFAULT_SOURCE_URL, bounds: { ...DEFAULT_SOURCE_BOUNDS } }];
}

function normalizeSource(entry, index) {
  if (typeof entry === 'string' && entry.trim()) {
    return { url: entry.trim() };
  }

  if (!entry || typeof entry !== 'object') {
    throw new Error(`OSM source ${index} must be a URL string or an object.`);
  }

  const url = typeof entry.url === 'string' ? entry.url.trim() : '';
  const filePath = typeof entry.path === 'string' ? entry.path.trim() : '';

  if (Boolean(url) === Boolean(filePath)) {
    throw new Error(
      `OSM source ${index} must have exactly one of "url" or "path".`,
    );
  }

  const source = url ? { url } : { path: path.resolve(filePath) };

  if (entry.bounds !== undefined) {
    source.bounds = Array.isArray(entry.bounds)
      ? validateBounds(
          {
            west: Number(entry.bounds[0]),
            south: Number(entry.bounds[1]),
            east: Number(entry.bounds[2]),
            north: Number(entry.bounds[3]),
          },
          `OSM source ${index} bounds`,
        )
      : parseBounds(entry.bounds, `OSM source ${index} bounds`);
  }

  if (typeof entry.name === 'string' && entry.name.trim()) {
    source.name = entry.name.trim();
  }

  return source;
}

export function selectOsmSource(sources, bounds) {
  const bounded = sources.filter((source) => source.bounds);

  if (bounded.length > 0) {
    const matches = bounded
      .filter((source) => boundsContain(source.bounds, bounds))
      .sort(
        (left, right) =>
          boundsArea(left.bounds) - boundsArea(right.bounds),
      );

    if (matches.length > 0) {
      return matches[0];
    }

    if (bounded.length === sources.length) {
      throw new Error(
        'No configured OSM extract covers this region. Add a source that contains the requested bounds.',
      );
    }
  }

  const unbounded = sources.find((source) => !source.bounds);

  if (unbounded) {
    return unbounded;
  }

  throw new Error('No usable OSM extract is configured.');
}

function boundsArea(bounds) {
  return (bounds.east - bounds.west) * (bounds.north - bounds.south);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function downloadSource(url, target, log) {
  log(`Downloading OSM extract: ${url}`);

  const response = await fetch(url, {
    headers: { 'User-Agent': 'offline-map-routing-builder/1.0' },
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `Could not download the OSM extract (HTTP ${response.status}).`,
    );
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  const temporary = `${target}.part`;
  let received = 0;
  let lastLog = Date.now();

  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;

      if (Date.now() - lastLog >= 5_000) {
        const megabytes = (received / 1_048_576).toFixed(1);
        const suffix = total > 0 ? ` / ${(total / 1_048_576).toFixed(1)}` : '';
        log(`Downloaded ${megabytes}${suffix} MB`);
        lastLog = Date.now();
      }

      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body),
    counter,
    createWriteStream(temporary),
  );

  const info = await stat(temporary);

  if (info.size === 0) {
    await rm(temporary, { force: true });
    throw new Error('Downloaded OSM extract is empty.');
  }

  await rename(temporary, target);

  return {
    lastModified: response.headers.get('last-modified'),
    downloadedAt: new Date().toISOString(),
  };
}

export async function resolveSourceFile(source, dataDir, log) {
  if (source.path) {
    const filePath = path.resolve(source.path);

    let info;

    try {
      info = await stat(filePath);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new Error(`Configured OSM extract does not exist: ${filePath}`);
      }
      throw error;
    }

    if (!info.isFile() || info.size === 0) {
      throw new Error(`Configured OSM extract is not a usable file: ${filePath}`);
    }

    return {
      filePath,
      label: source.name ?? filePath,
      dataVersion: `osm-${info.mtime.toISOString().slice(0, 10)}`,
    };
  }

  const sourceDir = path.resolve(dataDir, '..', SOURCE_DIR_NAME);
  await mkdir(sourceDir, { recursive: true });

  const cacheKey = createHash('sha256')
    .update(source.url)
    .digest('hex')
    .slice(0, 16);
  const filePath = path.join(sourceDir, `${cacheKey}.osm.pbf`);
  const metadataPath = `${filePath}.json`;

  let metadata = null;

  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  } catch {
    metadata = null;
  }

  let info = null;

  try {
    info = await stat(filePath);
  } catch {
    info = null;
  }

  if (!info || info.size === 0) {
    const download = await downloadSource(source.url, filePath, log);
    metadata = { url: source.url, ...download };
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    info = await stat(filePath);
  }

  const versionDate =
    metadata?.lastModified?.slice(0, 10) ??
    metadata?.downloadedAt?.slice(0, 10) ??
    info.mtime.toISOString().slice(0, 10);

  return {
    filePath,
    label: source.name ?? source.url,
    dataVersion: `osm-${versionDate}`,
  };
}

async function run(command, args, { log, quiet = false } = {}) {
  log?.(`$ ${command} ${args.join(' ')}`);

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: quiet ? ['ignore', 'ignore', 'pipe'] : 'inherit',
    });
    let stderr = '';

    if (quiet) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
        if (stderr.length > 8_000) {
          stderr = stderr.slice(-8_000);
        }
      });
    }

    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
        ),
      );
    });
  });
}

async function hasFiles(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(root, entry.name);

      if (entry.isFile()) {
        return true;
      }

      if (entry.isDirectory() && (await hasFiles(entryPath))) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

export async function buildRoutingPackage(parsed, options) {
  const {
    dataDir,
    engineVersion = DEFAULT_ENGINE_VERSION,
    log = console.log,
    sources = parseConfiguredSources(),
  } = options;

  const bounds = validateBounds(parsed.bounds);
  const bufferKm = Number(parsed.bufferKm ?? 2);
  const coverage = expandBounds(bounds, bufferKm);
  const source = selectOsmSource(sources, bounds);
  const resolved = await resolveSourceFile(source, dataDir, log);
  const workDir = path.join(dataDir, '.work', parsed.regionId);
  const stagingDir = path.join(dataDir, '.staging', parsed.regionId);
  const finalDir = path.join(dataDir, parsed.regionId);
  const keepWork = process.env.ROUTING_KEEP_BUILD_WORK === '1';
  const docker = process.env.ROUTING_DOCKER_BIN?.trim() || 'docker';
  const osmiumImage =
    process.env.ROUTING_OSMIUM_IMAGE?.trim() || 'stefda/osmium-tool';
  const valhallaImage =
    process.env.ROUTING_VALHALLA_IMAGE?.trim() ||
    `ghcr.io/valhalla/valhalla:${engineVersion}`;
  const userArgs =
    typeof process.getuid === 'function' && typeof process.getgid === 'function'
      ? ['--user', `${process.getuid()}:${process.getgid()}`]
      : [];

  await rm(workDir, { recursive: true, force: true });
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  try {
    await run(docker, ['version', '--format', '{{.Server.Version}}'], {
      log,
      quiet: true,
    });

    const sourceDir = path.dirname(resolved.filePath);
    const sourceName = path.basename(resolved.filePath);
    const bbox = formatBbox(coverage);

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

    await run(
      docker,
      [
        'run',
        '--rm',
        ...userArgs,
        '-v',
        `${workDir}:/work`,
        '-w',
        '/work',
        valhallaImage,
        'bash',
        '-lc',
        'valhalla_build_config --mjolnir-tile-dir valhalla-tiles > valhalla.json',
      ],
      { log },
    );

    const configPath = path.join(workDir, 'valhalla.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));

    if (!config.mjolnir) {
      throw new Error('Valhalla generated a config without mjolnir settings.');
    }

    config.mjolnir.tile_dir = 'valhalla-tiles';
    config.mjolnir.tile_extract = null;
    config.mjolnir.traffic_extract = null;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    await run(
      docker,
      [
        'run',
        '--rm',
        ...userArgs,
        '-v',
        `${workDir}:/work`,
        '-w',
        '/work',
        valhallaImage,
        'valhalla_build_tiles',
        '-c',
        'valhalla.json',
        'region.osm.pbf',
      ],
      { log },
    );

    const tilesDir = path.join(workDir, 'valhalla-tiles');

    if (!(await hasFiles(tilesDir))) {
      throw new Error('Valhalla produced no routing tiles for this region.');
    }

    await mkdir(path.join(stagingDir, 'metadata'), { recursive: true });
    await cp(tilesDir, path.join(stagingDir, 'valhalla-tiles'), {
      recursive: true,
    });
    await cp(configPath, path.join(stagingDir, 'metadata', 'valhalla.json'));

    try {
      await buildPlacesIndex({
        workDir,
        outputPath: path.join(stagingDir, 'places.sqlite'),
        docker,
        osmiumImage,
        log,
      });
    } catch (error) {
      log(
        `Places index skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const regionName =
      String(parsed.request?.regionName ?? '').trim() || parsed.regionId;

    await run(
      process.execPath,
      [
        path.join(SCRIPT_DIR, 'generate-manifest.mjs'),
        '--region-id',
        parsed.regionId,
        '--name',
        regionName,
        '--package-dir',
        stagingDir,
        '--bounds',
        [bounds.west, bounds.south, bounds.east, bounds.north].join(','),
        '--radius-km',
        String(parsed.radiusKm),
        '--buffer-km',
        String(bufferKm),
        '--data-version',
        resolved.dataVersion,
        '--engine-version',
        engineVersion,
        '--source',
        resolved.label,
      ],
      { log },
    );

    await rm(finalDir, { recursive: true, force: true });
    await mkdir(path.dirname(finalDir), { recursive: true });
    await rename(stagingDir, finalDir);

    return JSON.parse(
      await readFile(path.join(finalDir, 'manifest.json'), 'utf8'),
    );
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    if (!keepWork) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
