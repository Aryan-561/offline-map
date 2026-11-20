import { describe, expect, test } from 'bun:test';

import {
  parseConfiguredSources,
  selectOsmSource,
} from '../builder.mjs';

const delhi = {
  west: 76.8,
  south: 28.4,
  east: 77.4,
  north: 28.9,
};
const india = {
  west: 68,
  south: 6,
  east: 98,
  north: 36,
};

describe('OSM source configuration', () => {
  test('defaults to the India extract', () => {
    const sources = parseConfiguredSources({});

    expect(sources).toHaveLength(1);
    expect(sources[0].url).toContain('india-latest.osm.pbf');
  });

  test('accepts a local extract path', () => {
    const sources = parseConfiguredSources({
      ROUTING_OSM_EXTRACT: './data/india.osm.pbf',
    });

    expect(sources).toHaveLength(1);
    expect(sources[0].path).toBeTruthy();
    expect(sources[0].url).toBeUndefined();
  });

  test('accepts bounded sources and picks the smallest match', () => {
    const sources = parseConfiguredSources({
      ROUTING_OSM_SOURCES: JSON.stringify([
        { url: 'https://example.com/india.osm.pbf', bounds: [68, 6, 98, 36] },
        { url: 'https://example.com/delhi.osm.pbf', bounds: [76.8, 28.4, 77.4, 28.9] },
      ]),
    });

    const selected = selectOsmSource(sources, {
      west: 76.9,
      south: 28.5,
      east: 77.0,
      north: 28.6,
    });

    expect(selected.url).toContain('delhi');
  });

  test('rejects bounded sources when none cover the region', () => {
    const sources = parseConfiguredSources({
      ROUTING_OSM_SOURCES: JSON.stringify([
        { url: 'https://example.com/delhi.osm.pbf', bounds: [76.8, 28.4, 77.4, 28.9] },
      ]),
    });

    expect(() =>
      selectOsmSource(sources, {
        west: 72.8,
        south: 18.9,
        east: 72.9,
        north: 19.0,
      }),
    ).toThrow(/covers this region/);
  });

  test('uses an unbounded source as a fallback', () => {
    const sources = [
      { url: 'https://example.com/local.osm.pbf' },
      { url: 'https://example.com/india.osm.pbf', bounds: india },
    ];

    const selected = selectOsmSource(sources, {
      west: -122.5,
      south: 37.7,
      east: -122.3,
      north: 37.8,
    });

    expect(selected.url).toContain('local');
  });

  test('rejects sources with both url and path', () => {
    expect(() =>
      parseConfiguredSources({
        ROUTING_OSM_SOURCES: JSON.stringify([
          { url: 'https://example.com/a.osm.pbf', path: '/tmp/a.osm.pbf' },
        ]),
      }),
    ).toThrow(/exactly one/);
  });

  test('delhi bounds are contained by the India source', () => {
    expect(
      india.west <= delhi.west &&
        india.south <= delhi.south &&
        india.east >= delhi.east &&
        india.north >= delhi.north,
    ).toBe(true);
  });
});
