/**
 * Thin adapter around the existing offline-maps download service.
 *
 * The MapLibre pack implementation (native pack creation, style validation,
 * progress events, pause/resume, restart recovery and SQLite persistence) is
 * intentionally reused rather than duplicated.
 */
import * as offlineMaps from '@/features/offline-maps/services/downloadService';
import type {
  CreateOfflineRegionInput,
  OfflineRegion as MapOfflineRegion,
  OfflineRegionStatus,
  OfflineVerificationResult,
  StorageInfo,
} from '@/features/offline-maps/types/offlineMap';

import type { DatasetStatus } from '../types/offlineRegion.types';

export type MapDownloadRegion = MapOfflineRegion;

export const initializeMapDownloads = offlineMaps.initialize;
export const subscribeToMapDownloads = offlineMaps.subscribe;
export const listMapRegions = offlineMaps.getRegions;
export const getMapRegion = offlineMaps.getRegion;
export const isMapDownloadSupported = offlineMaps.isSupported;
export const getMapStorageInfo = offlineMaps.getStorageInfo;
export const refreshMapDownloads = offlineMaps.refresh;

export function startMapDownload(
  input: CreateOfflineRegionInput,
): Promise<MapOfflineRegion> {
  return offlineMaps.startDownload(input);
}

export function pauseMapDownload(id: string): Promise<MapOfflineRegion> {
  return offlineMaps.pauseRegion(id);
}

export function resumeMapDownload(id: string): Promise<MapOfflineRegion> {
  return offlineMaps.resumeRegion(id);
}

export function retryMapDownload(id: string): Promise<MapOfflineRegion> {
  return offlineMaps.retryRegion(id);
}

export function removeMapDownload(id: string): Promise<void> {
  return offlineMaps.removeRegion(id);
}

export function verifyMapDownload(id: string): Promise<OfflineVerificationResult> {
  return offlineMaps.verifyRegion(id);
}

export type { StorageInfo };

export function toDatasetStatus(status: OfflineRegionStatus): DatasetStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'downloading':
      return 'downloading';
    case 'paused':
      return 'paused';
    case 'pending':
      return 'pending';
    case 'failed':
    case 'missing':
    default:
      return 'failed';
  }
}

/**
 * MapLibre reports completed bytes and resource counts, not a required byte
 * total. Derive a total from the ratio when enough progress exists.
 */
export function estimateMapTotalBytes(region: MapOfflineRegion): number | null {
  if (
    region.requiredResourceCount > 0 &&
    region.completedResourceCount > 0 &&
    region.sizeBytes > 0
  ) {
    return Math.round(
      region.sizeBytes * (region.requiredResourceCount / region.completedResourceCount),
    );
  }

  if (region.progress > 0 && region.sizeBytes > 0) {
    return Math.round(region.sizeBytes / (region.progress / 100));
  }

  return null;
}

export function mapDownloadedBytes(region: MapOfflineRegion): number {
  return Math.max(0, region.sizeBytes);
}
