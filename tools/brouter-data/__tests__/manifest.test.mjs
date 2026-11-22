import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createManifest,
  readManifest,
  upsertPlaceTile,
  upsertSegmentTile,
  validateManifest,
  writeManifest,
} from '../manifest.mjs';

const digest = 'a'.repeat(64);

function segment(name) {
  return { name, file: `${name}.rd5`, sizeBytes: 1234, sha256: digest };
}

describe('BRouter manifest', () => {
  test('deduplicates and sorts tiles', () => {
    const manifest = createManifest();
    upsertSegmentTile(manifest, segment('E75_N25'));
    upsertSegmentTile(manifest, segment('E70_N25'));
    upsertSegmentTile(manifest, { ...segment('E75_N25'), sizeBytes: 999 });

    expect(manifest.segments.tiles.map((tile) => tile.name)).toEqual([
      'E70_N25',
      'E75_N25',
    ]);
    expect(manifest.segments.tiles[1].sizeBytes).toBe(999);
  });

  test('keeps segment and place tiles separate', () => {
    const manifest = createManifest();
    upsertSegmentTile(manifest, segment('E75_N25'));
    upsertPlaceTile(manifest, {
      name: 'E75_N25',
      file: 'places-E75_N25.sqlite',
      sizeBytes: 42,
      sha256: digest,
      entries: 12,
    });

    expect(manifest.segments.tiles).toHaveLength(1);
    expect(manifest.places.tiles).toHaveLength(1);
  });

  test('rejects invalid checksums and names', () => {
    const manifest = createManifest();
    upsertSegmentTile(manifest, { ...segment('E75_N25'), sha256: 'nope' });
    expect(() => validateManifest(manifest)).toThrow(/invalid sha-256/iu);

    const named = createManifest();
    upsertSegmentTile(named, segment('not-a-tile'));
    expect(() => validateManifest(named)).toThrow(/invalid tile entry name/iu);
  });

  test('round-trips through disk', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'brouter-manifest-'));
    const file = path.join(directory, 'brouter-manifest.json');

    try {
      const manifest = createManifest();
      upsertSegmentTile(manifest, segment('E75_N25'));
      await writeManifest(file, manifest);

      const stored = await readManifest(file);
      expect(stored?.segments.tiles[0].name).toBe('E75_N25');
      expect(JSON.parse(await readFile(file, 'utf8')).schemaVersion).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('returns null for a missing manifest', async () => {
    expect(await readManifest('/tmp/does-not-exist-brouter.json')).toBeNull();
  });
});
