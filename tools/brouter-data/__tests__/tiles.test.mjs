import { describe, expect, test } from 'bun:test';

import {
  parseTileName,
  placesAssetName,
  tileNameForCoordinate,
  tilesForBounds,
} from '../tiles.mjs';

describe('tileNameForCoordinate', () => {
  test('uses the south-west 5 degree corner', () => {
    expect(tileNameForCoordinate(28.61, 77.2)).toBe('E75_N25');
    expect(tileNameForCoordinate(0, 0)).toBe('E0_N0');
    expect(tileNameForCoordinate(-1.2, -76.5)).toBe('W80_S5');
  });

  test('handles exact tile boundaries', () => {
    expect(tileNameForCoordinate(25, 75)).toBe('E75_N25');
    expect(tileNameForCoordinate(-5, -5)).toBe('W5_S5');
  });

  test('clamps the extreme edges to real tiles', () => {
    expect(tileNameForCoordinate(90, 180)).toBe('E175_N85');
    expect(tileNameForCoordinate(-90, -180)).toBe('W180_S90');
  });
});

describe('tilesForBounds', () => {
  test('returns every overlapping tile once', () => {
    expect(tilesForBounds({ west: 75.1, south: 25.1, east: 79.9, north: 29.9 })).toEqual([
      'E75_N25',
    ]);
    expect(tilesForBounds({ west: 74.9, south: 26, east: 75.1, north: 27 })).toEqual([
      'E70_N25',
      'E75_N25',
    ]);
  });

  test('includes tiles at exact edges', () => {
    expect(tilesForBounds({ west: 75, south: 25, east: 80, north: 30 })).toEqual([
      'E75_N25',
      'E75_N30',
      'E80_N25',
      'E80_N30',
    ]);
  });

  test('rejects antimeridian regions', () => {
    expect(() =>
      tilesForBounds({ west: 170, south: 0, east: -170, north: 5 }),
    ).toThrow(/west must be less than east/iu);
  });
});

describe('parseTileName', () => {
  test('maps names to bounds', () => {
    expect(parseTileName('E75_N25')).toMatchObject({
      west: 75,
      south: 25,
      east: 80,
      north: 30,
    });
    expect(parseTileName('W180_S90')).toMatchObject({
      west: -180,
      south: -90,
      east: -175,
      north: -85,
    });
  });

  test('rejects malformed names', () => {
    expect(() => parseTileName('E75N25')).toThrow(/invalid brouter tile/iu);
  });
});

test('places asset names are flat release assets', () => {
  expect(placesAssetName('E75_N25')).toBe('places-E75_N25.sqlite');
});
