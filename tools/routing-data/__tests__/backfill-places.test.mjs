import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  coverageBounds,
  PLACES_FILE,
  updateManifestWithPlaces,
} from '../backfill-places.mjs';

const directories = [];

async function workspace() {
  const directory = await mkdtemp(path.join(tmpdir(), 'places-backfill-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function baseManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    packageFormat: 'directory',
    regionId: 'region_test',
    regionName: 'Test',
    bounds: { west: 1, south: 2, east: 3, north: 4 },
    coverageBounds: { west: 0.9, south: 1.9, east: 3.1, north: 4.1 },
    downloadSizeBytes: 10,
    files: [
      {
        path: 'valhalla-tiles/0/000/000.gph',
        url: 'valhalla-tiles/0/000/000.gph',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
      },
    ],
    ...overrides,
  };
}

describe('updateManifestWithPlaces', () => {
  test('adds the places index and recomputes the download size', async () => {
    const directory = await workspace();
    const manifest = baseManifest();
    await writeFile(path.join(directory, PLACES_FILE), 'sqlite-data', 'utf8');

    const updated = await updateManifestWithPlaces({
      manifest,
      packageDir: directory,
      placesCount: 42,
    });

    expect(updated.files).toHaveLength(2);
    const places = updated.files.find((file) => file.path === PLACES_FILE);
    expect(places).toBeTruthy();
    expect(places.sizeBytes).toBe(11);
    expect(places.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(updated.downloadSizeBytes).toBe(21);
    expect(updated.metadata.placesIndex).toEqual({
      file: PLACES_FILE,
      entries: 42,
    });

    const onDisk = JSON.parse(
      await readFile(path.join(directory, 'manifest.json'), 'utf8'),
    );
    expect(onDisk).toEqual(updated);
  });

  test('replaces an existing places entry instead of duplicating it', async () => {
    const directory = await workspace();
    const manifest = baseManifest({
      files: [
        ...baseManifest().files,
        {
          path: PLACES_FILE,
          url: PLACES_FILE,
          sizeBytes: 1,
          sha256: 'b'.repeat(64),
        },
      ],
    });
    await writeFile(path.join(directory, PLACES_FILE), 'rebuilt', 'utf8');

    const updated = await updateManifestWithPlaces({
      manifest,
      packageDir: directory,
      placesCount: 7,
    });

    expect(updated.files.filter((file) => file.path === PLACES_FILE)).toHaveLength(1);
    expect(updated.files.find((file) => file.path === PLACES_FILE).sizeBytes).toBe(7);
  });

  test('rejects an empty places index', async () => {
    const directory = await workspace();
    await writeFile(path.join(directory, PLACES_FILE), '');

    await expect(
      updateManifestWithPlaces({
        manifest: baseManifest(),
        packageDir: directory,
        placesCount: 0,
      }),
    ).rejects.toThrow(/empty/i);
  });

  test('rejects ZIP packages', async () => {
    const directory = await workspace();
    await writeFile(path.join(directory, PLACES_FILE), 'sqlite-data');

    await expect(
      updateManifestWithPlaces({
        manifest: baseManifest({ packageFormat: 'zip' }),
        packageDir: directory,
        placesCount: 1,
      }),
    ).rejects.toThrow(/ZIP/i);
  });
});

describe('coverageBounds', () => {
  test('prefers coverageBounds over bounds', () => {
    expect(coverageBounds(baseManifest())).toEqual({
      west: 0.9,
      south: 1.9,
      east: 3.1,
      north: 4.1,
    });
  });

  test('rejects invalid bounds', () => {
    expect(() =>
      coverageBounds(
        baseManifest({
          coverageBounds: { west: 'x', south: 1.9, east: 3.1, north: 4.1 },
        }),
      ),
    ).toThrow(/invalid coverage bounds/i);
  });
});
