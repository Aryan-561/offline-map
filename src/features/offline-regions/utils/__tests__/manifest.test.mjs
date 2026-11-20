import { describe, expect, test } from 'bun:test';

import {
  assertValhallaEngineCompatible,
  fileUrlList,
  manifestDownloadBytes,
  validateRoutingManifest,
} from '../../services/routingPackageService.ts';

const SHA = 'a'.repeat(64);

const request = {
  regionId: 'region_test',
  regionName: 'Test region',
  center: { latitude: 37.77, longitude: -122.42 },
  radiusKm: 10,
  bounds: { west: -122.54, south: 37.68, east: -122.3, north: 37.87 },
  bufferKm: 2,
  packageFormat: 'directory',
  valhallaEngineVersion: '3.9.1',
};

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    packageFormat: 'directory',
    regionId: 'region_test',
    regionName: 'Test region',
    bounds: request.bounds,
    coverageBounds: { west: -122.56, south: 37.66, east: -122.28, north: 37.89 },
    radiusKm: 10,
    bufferKm: 2,
    valhallaDataVersion: 'osm-2026-11-01',
    valhallaEngineVersion: '3.9.1',
    createdAt: '2026-11-14T12:00:00.000Z',
    downloadSizeBytes: 5,
    files: [
      {
        path: 'valhalla-tiles/2/000/123.gph',
        url: 'valhalla-tiles/2/000/123.gph',
        sizeBytes: 5,
        sha256: SHA,
      },
    ],
    ...overrides,
  };
}

describe('validateRoutingManifest', () => {
  test('accepts a generated directory manifest and resolves relative URLs', () => {
    const parsed = validateRoutingManifest(
      manifest(),
      request,
      'https://example.com/packages/region_test/manifest.json',
    );

    expect(parsed.files?.[0].url).toBe(
      'https://example.com/packages/region_test/valhalla-tiles/2/000/123.gph',
    );
    expect(fileUrlList(parsed)).toHaveLength(1);
    expect(manifestDownloadBytes(parsed)).toBe(5);
  });

  test('rejects coverage that does not contain the request', () => {
    expect(() =>
      validateRoutingManifest(
        manifest({
          coverageBounds: { west: -122.5, south: 37.7, east: -122.4, north: 37.8 },
        }),
        request,
      ),
    ).toThrow(/coverage/i);
  });

  test('rejects a mismatched radius and region', () => {
    expect(() => validateRoutingManifest(manifest({ radiusKm: 5 }), request)).toThrow(
      /radius/i,
    );
    expect(() =>
      validateRoutingManifest(manifest({ regionId: 'region_other' }), request),
    ).toThrow(/belongs/i);
  });

  test('rejects unsafe or duplicate file paths', () => {
    expect(() =>
      validateRoutingManifest(
        manifest({
          files: [
            {
              path: '../escape.gph',
              url: 'https://example.com/escape.gph',
              sizeBytes: 5,
              sha256: SHA,
            },
          ],
        }),
        request,
      ),
    ).toThrow();

    expect(() =>
      validateRoutingManifest(
        manifest({
          files: [
            {
              path: 'a.gph',
              url: 'https://example.com/a.gph',
              sizeBytes: 2,
              sha256: SHA,
            },
            {
              path: 'a.gph',
              url: 'https://example.com/a2.gph',
              sizeBytes: 3,
              sha256: SHA,
            },
          ],
        }),
        request,
      ),
    ).toThrow(/duplicate/i);
  });

  test('rejects inconsistent download sizes and invalid checksums', () => {
    expect(() =>
      validateRoutingManifest(
        manifest({ downloadSizeBytes: 7 }),
        request,
        'https://example.com/packages/region_test/manifest.json',
      ),
    ).toThrow(/does not match/i);

    expect(() =>
      validateRoutingManifest(
        manifest({
          files: [
            {
              path: 'a.gph',
              url: 'https://example.com/a.gph',
              sizeBytes: 5,
              sha256: 'not-a-hash',
            },
          ],
        }),
        request,
      ),
    ).toThrow(/checksum/i);
  });

  test('validates engine compatibility against the installed engine', () => {
    expect(() =>
      assertValhallaEngineCompatible(
        validateRoutingManifest(
          manifest({
            valhallaEngineVersion: '3.9.1',
            valhallaEngineCompatibility: '>=3.9.1 <3.10.0',
          }),
          request,
          'https://example.com/packages/region_test/manifest.json',
        ),
      ),
    ).not.toThrow();

    expect(() =>
      assertValhallaEngineCompatible(
        validateRoutingManifest(
          manifest({
            valhallaEngineVersion: '3.5.1',
            valhallaEngineCompatibility: '>=3.5.0 <3.6.0',
          }),
          request,
          'https://example.com/packages/region_test/manifest.json',
        ),
      ),
    ).toThrow(/requires/i);

    expect(() =>
      assertValhallaEngineCompatible(
        validateRoutingManifest(
          manifest({ valhallaEngineVersion: '3.5.1' }),
          request,
          'https://example.com/packages/region_test/manifest.json',
        ),
      ),
    ).toThrow(/built for Valhalla/i);

    expect(() =>
      assertValhallaEngineCompatible(
        validateRoutingManifest(
          manifest({ valhallaEngineVersion: '3.9.1' }),
          request,
          'https://example.com/packages/region_test/manifest.json',
        ),
      ),
    ).not.toThrow();
  });
});
