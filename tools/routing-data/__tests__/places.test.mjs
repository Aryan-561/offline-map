import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildPlacesIndexFromGeoJson } from '../places.mjs';

const directories = [];

async function workspace() {
  const directory = await mkdtemp(path.join(tmpdir(), 'places-index-'));
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

function feature(properties, geometry) {
  return JSON.stringify({ type: 'Feature', properties, geometry });
}

describe('buildPlacesIndexFromGeoJson', () => {
  test('indexes named features and skips unusable entries', async () => {
    const directory = await workspace();
    const input = path.join(directory, 'places.geojson');
    const output = path.join(directory, 'places.sqlite');

    await writeFile(
      input,
      [
        feature(
          {
            name: 'India Gate',
            tourism: 'attraction',
            'addr:city': 'New Delhi',
          },
          { type: 'Point', coordinates: [77.2295, 28.6129] },
        ),
        feature(
          { name: 'Connaught Place', place: 'suburb' },
          {
            type: 'Polygon',
            coordinates: [
              [
                [77.2, 28.6],
                [77.22, 28.6],
                [77.22, 28.62],
                [77.2, 28.62],
                [77.2, 28.6],
              ],
            ],
          },
        ),
        feature({ amenity: 'bench' }, { type: 'Point', coordinates: [77, 28] }),
        feature({ name: 'No Geometry' }, null),
        'not json',
      ]
        .map((line) => `\u001e${line}`)
        .join('\n'),
      'utf8',
    );

    const { count } = await buildPlacesIndexFromGeoJson(input, output);
    expect(count).toBe(2);

    const { DatabaseSync } = await import('node:sqlite');
    const database = new DatabaseSync(output);

    try {
      const rows = database
        .prepare(
          'SELECT name, kind, latitude, longitude, display_name FROM places ORDER BY name',
        )
        .all();

      expect(rows).toHaveLength(2);
      expect(rows[0].name).toBe('Connaught Place');
      expect(rows[0].kind).toBe('suburb');
      expect(rows[0].latitude).toBeCloseTo(28.61, 5);
      expect(rows[0].longitude).toBeCloseTo(77.21, 5);
      expect(rows[1].name).toBe('India Gate');
      expect(rows[1].kind).toBe('attraction');
      expect(rows[1].display_name).toBe('New Delhi');

      const matches = database
        .prepare('SELECT name FROM places WHERE places MATCH ?')
        .all('"connaught"* AND "place"*');

      expect(matches.map((row) => row.name)).toEqual(['Connaught Place']);
    } finally {
      database.close();
    }
  });
});
