import type {
  OfflineRegion,
  OfflineRegionCoordinate,
} from '../types/offlineRegion.types';

export type RegionReadinessFields = Pick<
  OfflineRegion,
  | 'mapStatus'
  | 'routingStatus'
  | 'routingChecksumVerified'
  | 'routingInstalledPath'
>;

export type RegionCoverageFields = Pick<
  OfflineRegion,
  'bounds' | 'routingCoverageBounds'
>;

export function isRegionDataReady(region: RegionReadinessFields): boolean {
  return (
    region.mapStatus === 'completed' &&
    region.routingStatus === 'completed' &&
    region.routingChecksumVerified &&
    region.routingInstalledPath !== null
  );
}

export function isRegionNavigationReady(
  region: RegionReadinessFields,
  localEngineAvailable: boolean,
): boolean {
  return localEngineAvailable && isRegionDataReady(region);
}

export function regionContainsCoordinate(
  region: RegionCoverageFields,
  coordinate: OfflineRegionCoordinate,
): boolean {
  const bounds = region.routingCoverageBounds ?? region.bounds;

  return (
    coordinate.latitude >= bounds.south &&
    coordinate.latitude <= bounds.north &&
    coordinate.longitude >= bounds.west &&
    coordinate.longitude <= bounds.east
  );
}
