import { describe, expect, test } from 'bun:test';

import {
  CompositeSearchProvider,
  CoordinateSearchProvider,
  PhotonPlaceSearchProvider,
  parseCoordinateQuery,
} from '../searchService.ts';

const near = { latitude: 28.6139, longitude: 77.209 };

describe('parseCoordinateQuery', () => {
  test('parses latitude and longitude pairs', () => {
    expect(parseCoordinateQuery('28.6139, 77.209')).toEqual(near);
    expect(parseCoordinateQuery('28.6139 77.209')).toEqual(near);
  });

  test('rejects out-of-range and malformed queries', () => {
    expect(parseCoordinateQuery('91, 0')).toBeNull();
    expect(parseCoordinateQuery('0, 181')).toBeNull();
    expect(parseCoordinateQuery('metro station')).toBeNull();
  });
});

describe('CompositeSearchProvider', () => {
  test('falls through to the online provider for place names', async () => {
    const online = {
      search: async () => [
        {
          id: 'photon:1',
          label: 'Metro Station',
          coordinate: near,
        },
      ],
    };
    const provider = new CompositeSearchProvider([
      new CoordinateSearchProvider(),
      online,
    ]);

    const results = await provider.search('metro');

    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('Metro Station');
  });

  test('coordinate queries do not hit the network', async () => {
    let calls = 0;
    const online = {
      search: async () => {
        calls += 1;
        return [];
      },
    };
    const provider = new CompositeSearchProvider([
      new CoordinateSearchProvider(),
      online,
    ]);

    const results = await provider.search('28.6139, 77.209');

    expect(results).toHaveLength(1);
    expect(calls).toBe(0);
  });

  test('surfaces the last provider failure', async () => {
    const provider = new CompositeSearchProvider([
      new CoordinateSearchProvider(),
      {
        search: async () => {
          throw new Error('offline');
        },
      },
    ]);

    await expect(provider.search('metro')).rejects.toThrow('offline');
  });
});

describe('PhotonPlaceSearchProvider', () => {
  test('parses features and sorts them by distance', async () => {
    const originalFetch = globalThis.fetch;
    let requestHeaders = null;
    globalThis.fetch = async (_url, init) => {
      requestHeaders = init?.headers;
      return new Response(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {
                name: 'Far cafe',
                city: 'Delhi',
                osm_type: 'N',
                osm_id: 2,
              },
              geometry: { type: 'Point', coordinates: [77.309, 28.6139] },
            },
            {
              type: 'Feature',
              properties: {
                name: 'Near cafe',
                street: 'Main Road',
                city: 'Delhi',
                osm_type: 'N',
                osm_id: 1,
              },
              geometry: { type: 'Point', coordinates: [77.219, 28.6139] },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    try {
      const provider = new PhotonPlaceSearchProvider('https://example.test/api');
      const results = await provider.search('cafe', { near, limit: 5 });

      expect(results.map((result) => result.label)).toEqual([
        'Near cafe',
        'Far cafe',
      ]);
      expect(results[0].id).toBe('photon:N1');
      expect(results[0].description).toContain('Delhi');
      expect(results[0].distanceMeters).toBeLessThan(
        results[1].distanceMeters,
      );
      expect(requestHeaders?.['User-Agent']).toBe('offline-map/1.0');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('throws when the service returns an error status', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('denied', { status: 403 });

    try {
      const provider = new PhotonPlaceSearchProvider('https://example.test/api');
      await expect(provider.search('cafe')).rejects.toThrow('HTTP 403');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('buildFtsQuery', () => {
  test('builds an AND prefix query from words', async () => {
    const { buildFtsQuery } = await import('../offlinePlaceSearch.ts');

    expect(buildFtsQuery('India Gate')).toBe('"India"* AND "Gate"*');
    expect(buildFtsQuery('  cafe  ')).toBe('"cafe"*');
    expect(buildFtsQuery('  café  ')).toBe('"café"*');
  });

  test('strips punctuation and rejects empty input', async () => {
    const { buildFtsQuery } = await import('../offlinePlaceSearch.ts');

    expect(buildFtsQuery('cafe, delhi!')).toBe('"cafe"* AND "delhi"*');
    expect(buildFtsQuery('St. Mark\'s')).toBe('"St"* AND "Mark"* AND "s"*');
    expect(buildFtsQuery('   ')).toBeNull();
    expect(buildFtsQuery('---')).toBeNull();
  });
});
