#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_ENGINE_VERSION,
  boundsContain,
  buildFileEntries,
  expandBounds,
  parseBounds,
} from './lib.mjs';

function usage() {
  console.error(`Usage:
  generate-manifest.mjs \\
    --region-id <id> \\
    --package-dir <directory containing valhalla-tiles/ and metadata/> \\
    --bounds west,south,east,north \\
    --radius-km <number> \\
    --data-version <OSM/data build identifier> \\
    [--name <display name>] \\
    [--buffer-km 2] \\
    [--engine-version 3.9.1] \\
    [--engine-compatibility ">=3.9.1 <3.10.0"] \\
    [--output <package-dir>/manifest.json]`);
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function requiredArgument(name) {
  const value = argument(name);

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required argument ${name}.`);
  }

  return value.trim();
}

function assertRegionId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(
      'region-id must be 1-128 characters of letters, digits, dot, underscore or dash.',
    );
  }
}

try {
  const regionId = requiredArgument('--region-id');
  assertRegionId(regionId);

  const packageDir = path.resolve(requiredArgument('--package-dir'));
  const bounds = parseBounds(requiredArgument('--bounds'), '--bounds');
  const radiusKm = Number(requiredArgument('--radius-km'));
  const bufferKm = Number(argument('--buffer-km', '2'));
  const dataVersion = requiredArgument('--data-version');
  const engineVersion = argument('--engine-version', DEFAULT_ENGINE_VERSION);
  const engineCompatibility = argument('--engine-compatibility');
  const regionName = argument('--name', regionId);
  const source = argument('--source');
  const output = path.resolve(
    argument('--output', path.join(packageDir, 'manifest.json')),
  );

  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 500) {
    throw new Error('--radius-km must be greater than 0 and at most 500.');
  }

  if (!Number.isFinite(bufferKm) || bufferKm < 0 || bufferKm > 100) {
    throw new Error('--buffer-km must be between 0 and 100.');
  }

  if (typeof engineVersion !== 'string' || engineVersion.trim().length === 0) {
    throw new Error('--engine-version must not be empty.');
  }

  const coverageBounds = expandBounds(bounds, bufferKm);

  if (!boundsContain(coverageBounds, bounds)) {
    throw new Error('Computed coverage bounds do not contain the requested bounds.');
  }

  const files = await buildFileEntries(packageDir);

  if (files.length === 0) {
    throw new Error(`No package files found under ${packageDir}.`);
  }

  const downloadSizeBytes = files.reduce((total, file) => total + file.sizeBytes, 0);
  const manifest = {
    schemaVersion: 1,
    packageFormat: 'directory',
    regionId,
    regionName,
    bounds,
    coverageBounds,
    radiusKm,
    bufferKm,
    valhallaDataVersion: dataVersion,
    valhallaEngineVersion: engineVersion,
    ...(engineCompatibility
      ? { valhallaEngineCompatibility: engineCompatibility }
      : {}),
    createdAt: new Date().toISOString(),
    downloadSizeBytes,
    files,
    metadata: {
      generatedBy: 'tools/routing-data/generate-manifest.mjs',
      fileCount: files.length,
      ...(source ? { source } : {}),
    },
  };

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(
    `Wrote ${output}\n${files.length} files, ${downloadSizeBytes} bytes, coverage ${coverageBounds.west},${coverageBounds.south},${coverageBounds.east},${coverageBounds.north}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exit(1);
}
