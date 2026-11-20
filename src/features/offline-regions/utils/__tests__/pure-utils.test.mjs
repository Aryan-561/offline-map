import { describe, expect, test } from 'bun:test';

import {
  boundsContain,
  boundsEqual,
  boundsForRadius,
  distanceKm,
  estimateMapTileCount,
  expandBoundsByKm,
  radiusKmForBounds,
  zoomForRadius,
} from '../calculateBounds.ts';
import { isSha256, normalizePackagePath } from '../packagePath.ts';
import {
  clamp,
  combineDownloadProgress,
  datasetPercent,
} from '../progress.ts';
import { expandBounds as expandServerBounds } from '../../../../../tools/routing-data/lib.mjs';

describe('combineDownloadProgress', () => {
  test('uses real bytes when both totals are known', () => {
    const combined = combineDownloadProgress(
      { status: 'downloading', progress: 50, downloadedBytes: 50, totalBytes: 100 },
      { status: 'downloading', progress: 25, downloadedBytes: 25, totalBytes: 100 },
    );

    expect(combined.method).toBe('bytes');
    expect(combined.progress).toBeCloseTo(37.5, 5);
    expect(combined.downloadedBytes).toBe(75);
    expect(combined.totalBytes).toBe(200);
  });

  test('never reports more bytes than the total', () => {
    const combined = combineDownloadProgress(
      { status: 'completed', progress: 100, downloadedBytes: 500, totalBytes: 100 },
      { status: 'completed', progress: 100, downloadedBytes: 500, totalBytes: 100 },
    );

    expect(combined.downloadedBytes).toBe(200);
    expect(combined.progress).toBe(100);
  });

  test('falls back to percentage weighting without totals', () => {
    const combined = combineDownloadProgress(
      { status: 'downloading', progress: 100, downloadedBytes: 10, totalBytes: null },
      { status: 'downloading', progress: 0, downloadedBytes: 0, totalBytes: null },
    );

    expect(combined.method).toBe('percentage');
    expect(combined.progress).toBe(50);
    expect(combined.totalBytes).toBeNull();
  });
});

describe('progress helpers', () => {
  test('datasetPercent clamps and uses fallback', () => {
    expect(datasetPercent(50, 100)).toBe(50);
    expect(datasetPercent(150, 100)).toBe(100);
    expect(datasetPercent(10, null, 42)).toBe(42);
    expect(datasetPercent(10, 0, 42)).toBe(42);
  });

  test('clamp handles non-finite values', () => {
    expect(clamp(Number.NaN)).toBe(0);
    expect(clamp(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clamp(-1)).toBe(0);
    expect(clamp(101)).toBe(100);
  });
});

describe('package paths', () => {
  test('accepts safe relative paths', () => {
    expect(normalizePackagePath('valhalla-tiles/2/000/123.gph')).toEqual([
      'valhalla-tiles',
      '2',
      '000',
      '123.gph',
    ]);
  });

  test.each([
    '../secret',
    'a/../../secret',
    '/etc/passwd',
    'C:/windows',
    'a\\b',
    'a//b',
    './a',
    'a/%2e%2e/b',
    'a/%2F/b',
    'a\0b',
  ])('rejects unsafe path %p', (candidate) => {
    expect(() => normalizePackagePath(candidate)).toThrow();
  });

  test('validates SHA-256 format', () => {
    expect(isSha256('a'.repeat(64))).toBe(true);
    expect(isSha256('A'.repeat(64))).toBe(false);
    expect(isSha256('a'.repeat(63))).toBe(false);
    expect(isSha256(null)).toBe(false);
  });
});

describe('bounds helpers', () => {
  const bounds = { west: -122.54, south: 37.68, east: -122.3, north: 37.87 };

  test('boundsForRadius returns a containing box around the center', () => {
    const result = boundsForRadius({ latitude: 37.77, longitude: -122.42 }, 10);

    expect(result.west).toBeLessThan(-122.42);
    expect(result.east).toBeGreaterThan(-122.42);
    expect(result.south).toBeLessThan(37.77);
    expect(result.north).toBeGreaterThan(37.77);
    expect(result.west).toBeGreaterThanOrEqual(-180);
    expect(result.north).toBeLessThanOrEqual(85.05112878);
  });

  test('radiusKmForBounds contains every corner', () => {
    const radius = radiusKmForBounds(bounds);
    const center = { latitude: 37.775, longitude: -122.42 };

    expect(radius).toBeGreaterThanOrEqual(
      Math.ceil(
        Math.max(
          distanceKm(center, { latitude: bounds.south, longitude: bounds.west }),
          distanceKm(center, { latitude: bounds.south, longitude: bounds.east }),
          distanceKm(center, { latitude: bounds.north, longitude: bounds.west }),
          distanceKm(center, { latitude: bounds.north, longitude: bounds.east }),
        ),
      ),
    );
  });

  test('expandBoundsByKm grows and contains the original bounds', () => {
    const expanded = expandBoundsByKm(bounds, 2);

    expect(expanded.west).toBeLessThan(bounds.west);
    expect(expanded.south).toBeLessThan(bounds.south);
    expect(expanded.east).toBeGreaterThan(bounds.east);
    expect(expanded.north).toBeGreaterThan(bounds.north);
    expect(boundsContain(expanded, bounds)).toBe(true);
    expect(boundsEqual(expandBoundsByKm(bounds, 0), bounds)).toBe(true);
  });

  test('boundsContain rejects a partial overlap', () => {
    expect(
      boundsContain(bounds, {
        west: -123,
        south: 37.68,
        east: -122.3,
        north: 37.87,
      }),
    ).toBe(false);
  });

  test('distanceKm is approximately one degree of longitude at the equator', () => {
    expect(
      distanceKm(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 1 },
      ),
    ).toBeCloseTo(111.2, 0);
  });

  test('server coverage expansion matches the app exactly', () => {
    const appCoverage = expandBoundsByKm(bounds, 2);
    const serverCoverage = expandServerBounds(bounds, 2);

    expect(serverCoverage.west).toBeCloseTo(appCoverage.west, 10);
    expect(serverCoverage.south).toBeCloseTo(appCoverage.south, 10);
    expect(serverCoverage.east).toBeCloseTo(appCoverage.east, 10);
    expect(serverCoverage.north).toBeCloseTo(appCoverage.north, 10);
  });

  test('tile count and preview zoom are positive and monotonic', () => {
    const small = estimateMapTileCount(bounds, 10, 12);
    const large = estimateMapTileCount(bounds, 10, 14);

    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
    expect(zoomForRadius(1)).toBeGreaterThan(zoomForRadius(100));
  });
});
