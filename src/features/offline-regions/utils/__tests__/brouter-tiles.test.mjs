import { describe, expect, test } from 'bun:test';

import {
  brouterPlacesDatabaseName,
  parseTileName,
  tileNameForCoordinate,
  tilesForBounds,
} from '../brouterTiles.ts';

describe('tileNameForCoordinate', () => {
  test('names the south-west 5 degree corner', () => {
    expect(tileNameForCoordinate(28.6139, 77.209)).toBe('E75_N25');
    expect(tileNameForCoordinate(48.8566, 2.3522)).toBe('E0_N45');
    expect(tileNameForCoordinate(40.7128, -74.006)).toBe('W75_N40');
  });

  test('handles world edges', () => {
    expect(tileNameForCoordinate(90, 180)).toBe('E175_N85');
    expect(tileNameForCoordinate(-90, -180)).toBe('W180_S90');
  });
});

describe('tilesForBounds', () => {
  test('covers every tile touched by the bounds', () => {
    expect(
      tilesForBounds({
        west: 76.8,
        south: 28.3,
        east: 77.4,
        north: 28.9,
      }),
    ).toEqual(['E75_N25']);

    expect(
      tilesForBounds({
        west: 75.1,
        south: 25.1,
        east: 80.1,
        north: 30.1,
      }),
    ).toEqual(['E75_N25', 'E75_N30', 'E80_N25', 'E80_N30']);
  });

  test('rejects antimeridian bounds', () => {
    expect(() =>
      tilesForBounds({
        west: 170,
        south: -10,
        east: -170,
        north: 10,
      }),
    ).toThrow();
  });
});

describe('parseTileName', () => {
  test('returns tile bounds', () => {
    expect(parseTileName('W75_S10')).toEqual({
      name: 'W75_S10',
      west: -75,
      south: -10,
      east: -70,
      north: -5,
    });
  });

  test('builds place database names', () => {
    expect(brouterPlacesDatabaseName('E75_N25')).toBe('places-E75_N25.sqlite');
  });
});
