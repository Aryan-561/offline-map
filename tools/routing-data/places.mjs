#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const KIND_TAGS = [
  'amenity',
  'shop',
  'tourism',
  'leisure',
  'place',
  'highway',
  'railway',
  'public_transport',
  'natural',
  'building',
];

const DEFAULT_OSMIUM_IMAGE = 'stefda/osmium-tool';

function flattenCoordinates(value, output) {
  if (!Array.isArray(value)) {
    return;
  }

  if (
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  ) {
    output.push(value);
    return;
  }

  for (const item of value) {
    flattenCoordinates(item, output);
  }
}

function representativePoint(geometry) {
  if (!geometry || typeof geometry !== 'object') {
    return null;
  }

  if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries ?? []) {
      const point = representativePoint(child);

      if (point) {
        return point;
      }
    }

    return null;
  }

  const points = [];
  flattenCoordinates(geometry.coordinates, points);

  const unique = [];

  for (const point of points) {
    const previous = unique[unique.length - 1];

    if (
      !previous ||
      previous[0] !== point[0] ||
      previous[1] !== point[1]
    ) {
      unique.push(point);
    }
  }

  if (
    unique.length > 1 &&
    unique[0][0] === unique[unique.length - 1][0] &&
    unique[0][1] === unique[unique.length - 1][1]
  ) {
    unique.pop();
  }

  if (unique.length === 0) {
    return null;
  }

  let longitude = 0;
  let latitude = 0;

  for (const [lon, lat] of unique) {
    longitude += lon;
    latitude += lat;
  }

  return [longitude / unique.length, latitude / unique.length];
}

function firstTag(properties, keys) {
  for (const key of keys) {
    const value = properties[key];

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function displayName(properties) {
  const street = [properties['addr:housenumber'], properties['addr:street']]
    .filter((part) => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();

  const parts = [
    street,
    properties['addr:suburb'],
    properties['addr:city'],
    properties['addr:district'],
    properties['addr:state'],
    properties['addr:country'],
  ]
    .filter((part) => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim());

  return [...new Set(parts)].join(', ');
}

function placeRow(feature) {
  const properties = feature?.properties;

  if (!properties || typeof properties !== 'object') {
    return null;
  }

  const name = typeof properties.name === 'string' ? properties.name.trim() : '';

  if (name.length === 0) {
    return null;
  }

  const point = representativePoint(feature.geometry);

  if (!point) {
    return null;
  }

  const [longitude, latitude] = point;
  const kind = firstTag(properties, KIND_TAGS);
  const osmType =
    typeof properties['@type'] === 'string' ? properties['@type'] : null;
  const osmId =
    typeof properties['@id'] === 'number' || typeof properties['@id'] === 'string'
      ? String(properties['@id'])
      : null;

  return {
    name,
    displayName: displayName(properties),
    kind,
    latitude,
    longitude,
    osmType,
    osmId,
  };
}

export async function buildPlacesIndexFromGeoJson(
  geoJsonPath,
  outputPath,
  { log = () => {} } = {},
) {
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(outputPath);

  try {
    database.exec(`
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      PRAGMA temp_store = MEMORY;
      DROP TABLE IF EXISTS places;
      CREATE VIRTUAL TABLE places USING fts5(
        name,
        display_name,
        kind UNINDEXED,
        latitude UNINDEXED,
        longitude UNINDEXED,
        osm_type UNINDEXED,
        osm_id UNINDEXED,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `);

    const insert = database.prepare(`
      INSERT INTO places (
        name, display_name, kind, latitude, longitude, osm_type, osm_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const seen = new Set();
    const stream = createReadStream(geoJsonPath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let count = 0;

    database.exec('BEGIN');

    try {
      for await (const line of lines) {
        // GeoJSON Sequence output prefixes every record with U+001E (RS). JS
        // trim() does not remove it, so strip it before parsing or every line
        // is silently skipped.
        const trimmed = line.replace(/^\u001e/u, '').trim();

        if (trimmed.length === 0) {
          continue;
        }

        let feature;

        try {
          feature = JSON.parse(trimmed);
        } catch {
          continue;
        }

        const row = placeRow(feature);

        if (!row) {
          continue;
        }

        const key = `${row.name}|${row.latitude.toFixed(5)}|${row.longitude.toFixed(5)}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        insert.run(
          row.name,
          row.displayName,
          row.kind,
          row.latitude,
          row.longitude,
          row.osmType,
          row.osmId,
        );
        count += 1;
      }

      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    } finally {
      lines.close();
      stream.close();
    }

    if (count === 0) {
      throw new Error(
        `No named places were found in ${geoJsonPath}. Refusing to write an empty places index.`,
      );
    }

    database.exec(`
      INSERT INTO places (places) VALUES ('optimize');
      PRAGMA optimize;
    `);

    log(`Places index: ${count} entries -> ${outputPath}`);

    return { count };
  } finally {
    database.close();
  }
}

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
      } else {
        reject(
          new Error(
            `${command} exited with code ${code}${
              stderr.trim() ? `: ${stderr.trim().split('\n').slice(-3).join(' ')}` : ''
            }`,
          ),
        );
      }
    });
  });
}

export async function buildPlacesIndex({
  workDir,
  osmFile = 'region.osm.pbf',
  outputPath,
  docker = 'docker',
  osmiumImage = DEFAULT_OSMIUM_IMAGE,
  local = false,
  osmium = 'osmium',
  log = () => {},
}) {
  const osmPbfPath = path.join(workDir, osmFile);

  try {
    await stat(osmPbfPath);
  } catch {
    throw new Error(`OSM extract not found: ${osmPbfPath}`);
  }

  const namedPbfPath = path.join(workDir, 'places.osm.pbf');
  const geoJsonPath = path.join(workDir, 'places.geojson');

  if (local) {
    await run(
      osmium,
      ['tags-filter', osmPbfPath, 'n/name', 'w/name', '-o', namedPbfPath, '--overwrite'],
      { log },
    );
    await run(
      osmium,
      ['export', namedPbfPath, '-f', 'geojsonseq', '-o', geoJsonPath, '--overwrite'],
      { log },
    );
  } else {
    await run(
      docker,
      [
        'run',
        '--rm',
        '-v',
        `${workDir}:/work`,
        osmiumImage,
        'bash',
        '-lc',
        `osmium tags-filter /work/${osmFile} n/name w/name -o /work/places.osm.pbf --overwrite && ` +
          'osmium export /work/places.osm.pbf -f geojsonseq -o /work/places.geojson --overwrite',
      ],
      { log },
    );
  }

  return buildPlacesIndexFromGeoJson(geoJsonPath, outputPath, { log });
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const workDir = option('--work-dir');
  const outputPath = option('--output');

  if (!workDir || !outputPath) {
    console.error(
      'Usage: places.mjs --work-dir <dir> --output <places.sqlite> [--osm-file region.osm.pbf] [--local]',
    );
    process.exit(2);
  }

  buildPlacesIndex({
    workDir: path.resolve(workDir),
    osmFile: option('--osm-file', 'region.osm.pbf'),
    outputPath: path.resolve(outputPath),
    local: process.argv.includes('--local'),
    log: (message) => console.log(message),
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
