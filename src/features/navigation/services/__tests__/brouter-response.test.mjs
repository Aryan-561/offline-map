import { describe, expect, test } from 'bun:test';

import { parseBrouterResponse } from '../brouterResponse.ts';

const origin = { latitude: 28.61, longitude: 77.2 };
const destination = { latitude: 28.62, longitude: 77.21 };

function response(properties, coordinates) {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties,
        geometry: {
          type: 'LineString',
          coordinates,
        },
      },
    ],
  });
}

describe('parseBrouterResponse', () => {
  test('parses geometry, totals and voice hints', () => {
    const route = parseBrouterResponse(
      response(
        {
          'track-length': '1234',
          'total-time': '567',
          voicehints: [
            [0, 1, 0, 100, 0],
            [2, 13, 2, 200, 90],
            [4, 5, 0, 934, -90],
          ],
        },
        [
          [77.2, 28.61],
          [77.205, 28.615],
          [77.21, 28.62],
          [77.215, 28.625],
          [77.22, 28.63],
        ],
      ),
      origin,
      destination,
    );

    expect(route.distanceMeters).toBe(1234);
    expect(route.durationSeconds).toBe(567);
    expect(route.geometry.geometry.coordinates).toHaveLength(5);
    expect(route.maneuvers).toHaveLength(3);
    expect(route.maneuvers[1].instruction).toContain('exit 2');
    expect(route.maneuvers[1].beginShapeIndex).toBe(2);
    expect(route.maneuvers[2].type).toBe(10);
  });

  test('adds a default manoeuvre when BRouter returns no hints', () => {
    const route = parseBrouterResponse(
      response(
        { 'track-length': '10', 'total-time': '5' },
        [
          [77.2, 28.61],
          [77.21, 28.62],
        ],
      ),
      origin,
      destination,
    );

    expect(route.maneuvers).toHaveLength(1);
    expect(route.maneuvers[0].beginShapeIndex).toBe(0);
    expect(route.maneuvers[0].endShapeIndex).toBe(1);
  });

  test('rejects malformed routes', () => {
    expect(() => parseBrouterResponse('not json', origin, destination)).toThrow();
    expect(() =>
      parseBrouterResponse(response({}, [[77.2, 28.61]]), origin, destination),
    ).toThrow();
  });
});
