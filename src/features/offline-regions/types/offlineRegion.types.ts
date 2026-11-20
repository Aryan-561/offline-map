import type { OfflineBounds } from '@/features/offline-maps/types/offlineMap';

export type OfflineRegionCoordinate = {
  latitude: number;
  longitude: number;
};

/**
 * Geographic bounding box stored in the database and shown in the UI.
 * MapLibre expects the tuple form, which is converted at the boundary via
 * `toLngLatBounds`.
 */
export type OfflineRegionBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type DatasetStatus =
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed';

export type RoutingPackageFormat = 'directory' | 'zip';

export type OfflineRegion = {
  id: string;
  name: string;

  center: OfflineRegionCoordinate;
  radiusKm: number;
  /** Requested region bounds. */
  bounds: OfflineRegionBounds;

  /** ID of the record managed by the existing offline-maps service. */
  mapRegionId: string | null;
  /** Native MapLibre pack ID. */
  mapPackId: string | null;
  mapStatus: DatasetStatus;
  mapProgress: number;
  mapDownloadedBytes: number;
  mapTotalBytes: number | null;
  mapSizeBytes: number;
  mapError: string | null;

  routingStatus: DatasetStatus;
  routingProgress: number;
  routingDownloadedBytes: number;
  routingTotalBytes: number | null;
  routingSizeBytes: number;
  routingError: string | null;

  /** Bounds actually covered by the routing package (requested bounds + buffer). */
  routingCoverageBounds: OfflineRegionBounds | null;
  routingDataVersion: string | null;
  routingEngineVersion: string | null;
  routingPackageFormat: RoutingPackageFormat | null;
  routingChecksumVerified: boolean;
  /** Absolute file URI of the verified routing directory. */
  routingInstalledPath: string | null;
  routingManifestPath: string | null;
  routingManifestUrl: string | null;

  /** True only when both datasets are completed and routing was verified. */
  isNavigationReady: boolean;

  createdAt: string;
  updatedAt: string;
};

export type CreateOfflineRegionRequest = {
  /** Optional caller-supplied ID so map and routing downloads share it. */
  id?: string;
  name: string;
  center: OfflineRegionCoordinate;
  radiusKm: number;
  bounds?: OfflineRegionBounds;
  minZoom?: number;
  maxZoom?: number;
};

export type OfflineRegionVerification = {
  ok: boolean;
  mapOk: boolean;
  routingOk: boolean;
  message: string;
  region: OfflineRegion;
};

export type CombinedProgress = {
  /** 0-100. */
  progress: number;
  downloadedBytes: number;
  totalBytes: number | null;
  method: 'bytes' | 'percentage';
};

export type OfflineRegionStorageInfo = {
  availableBytes: number | null;
  totalBytes: number | null;
  downloadedBytes: number;
};

export type OfflineRegionsErrorCode =
  | 'unsupported'
  | 'offline'
  | 'invalid_bounds'
  | 'invalid_radius'
  | 'invalid_zoom'
  | 'duplicate'
  | 'storage'
  | 'permission'
  | 'style_resources'
  | 'map_download_failed'
  | 'routing_configuration'
  | 'routing_manifest'
  | 'routing_download_failed'
  | 'routing_extraction'
  | 'checksum_mismatch'
  | 'engine_unsupported'
  | 'native_valhalla_unavailable'
  | 'cancelled'
  | 'interrupted'
  | 'not_found'
  | 'unknown';

export class OfflineRegionsError extends Error {
  readonly code: OfflineRegionsErrorCode;

  constructor(
    code: OfflineRegionsErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'OfflineRegionsError';
    this.code = code;
    if (options && 'cause' in options) {
      this.cause = options.cause;
    }
  }
}

export function toOfflineRegionsError(error: unknown): OfflineRegionsError {
  if (error instanceof OfflineRegionsError) {
    return error;
  }

  if (error instanceof Error) {
    return new OfflineRegionsError('unknown', error.message || 'Something went wrong.', {
      cause: error,
    });
  }

  return new OfflineRegionsError('unknown', 'Something went wrong.', { cause: error });
}

/**
 * Conversion helpers live next to the types so every service uses the same
 * tuple ordering ([west, south, east, north]) that MapLibre expects.
 */
export function toLngLatBounds(bounds: OfflineRegionBounds): OfflineBounds {
  return [bounds.west, bounds.south, bounds.east, bounds.north];
}

export function fromLngLatBounds(bounds: OfflineBounds): OfflineRegionBounds {
  return {
    west: bounds[0],
    south: bounds[1],
    east: bounds[2],
    north: bounds[3],
  };
}
