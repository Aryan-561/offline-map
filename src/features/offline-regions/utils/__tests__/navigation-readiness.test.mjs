import { describe, expect, test } from 'bun:test';

import {
  isRegionDataReady,
  isRegionNavigationReady,
  regionContainsCoordinate,
} from '../../utils/navigationReadiness.ts';

const installed = {
  mapStatus: 'completed',
  routingStatus: 'completed',
  routingChecksumVerified: true,
  routingInstalledPath: 'file:///offline-regions/region_test/routing',
};

describe('navigation readiness', () => {
  test('requires both datasets, checksum verification, and an installed path', () => {
    expect(isRegionDataReady(installed)).toBe(true);
    expect(isRegionDataReady({ ...installed, mapStatus: 'downloading' })).toBe(false);
    expect(isRegionDataReady({ ...installed, routingStatus: 'failed' })).toBe(false);
    expect(
      isRegionDataReady({ ...installed, routingChecksumVerified: false }),
    ).toBe(false);
    expect(
      isRegionDataReady({ ...installed, routingInstalledPath: null }),
    ).toBe(false);
  });

  test('does not claim navigation readiness without a local engine', () => {
    expect(isRegionNavigationReady(installed, false)).toBe(false);
    expect(isRegionNavigationReady(installed, true)).toBe(true);
    expect(
      isRegionNavigationReady({ ...installed, routingStatus: 'paused' }, true),
    ).toBe(false);
  });
});

describe('region coverage', () => {
  const region = {
    bounds: { west: 1.46, south: 42.46, east: 1.59, north: 42.56 },
    routingCoverageBounds: {
      west: 1.43,
      south: 42.44,
      east: 1.61,
      north: 42.58,
    },
  };

  test('prefers buffered routing coverage over requested bounds', () => {
    expect(
      regionContainsCoordinate(region, { latitude: 42.445, longitude: 1.44 }),
    ).toBe(true);
    expect(
      regionContainsCoordinate(
        { ...region, routingCoverageBounds: null },
        { latitude: 42.445, longitude: 1.44 },
      ),
    ).toBe(false);
  });

  test('rejects locations outside the routing coverage', () => {
    expect(
      regionContainsCoordinate(region, { latitude: 28.61872, longitude: 77.01341 }),
    ).toBe(false);
  });
});
