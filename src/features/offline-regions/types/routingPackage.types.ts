import type {
  OfflineRegionBounds,
  OfflineRegionCoordinate,
  RoutingPackageFormat,
} from './offlineRegion.types';

/**
 * Contract between the mobile app and the routing-data backend.
 *
 * The backend owns OSM PBF extraction and `valhalla_build_tiles`. The app never
 * generates routing tiles itself.
 */
export type RoutingPackageRequest = {
  regionId: string;
  regionName: string;
  center: OfflineRegionCoordinate;
  radiusKm: number;
  /** Requested map region bounds. */
  bounds: OfflineRegionBounds;
  /** Extra coverage around `bounds` so routes can leave/enter the region. */
  bufferKm: number;
  packageFormat: RoutingPackageFormat;
  /** Exact Valhalla engine version the tiles must be compatible with. */
  valhallaEngineVersion: string;
};

export type RoutingPackageFile = {
  /** POSIX-style path relative to the package root. */
  path: string;
  /** Absolute URL or path relative to the manifest URL. */
  url: string;
  sizeBytes: number;
  /** Lowercase hex SHA-256 digest. */
  sha256: string;
};

export type RoutingPackageManifest = {
  schemaVersion: 1;
  packageFormat: RoutingPackageFormat;
  regionId: string;
  regionName: string;

  /** Region originally requested by the app. */
  bounds: OfflineRegionBounds;
  /** Actual coverage after the configured buffer. Must contain `bounds`. */
  coverageBounds: OfflineRegionBounds;
  radiusKm: number;
  bufferKm: number;

  valhallaDataVersion: string;
  valhallaEngineVersion: string;
  /** Optional semver range such as ">=3.9.1 <3.10.0". */
  valhallaEngineCompatibility?: string;

  createdAt: string;
  /** Total number of bytes the app will download. */
  downloadSizeBytes: number;

  /** Present for `directory` packages. */
  files?: RoutingPackageFile[];
  /** Present for `zip` packages. Every extracted file is still checksum-verified. */
  archive?: {
    url: string;
    sizeBytes: number;
    sha256: string;
    /** Files expected after extraction. */
    files: RoutingPackageFile[];
  };

  metadata?: {
    /** Valhalla tile hierarchy levels, copied from the build output. */
    tileLevels?: number;
    /** Valhalla tile size in degrees (usually 1, 0.25 or 0.05). */
    tileSizeDegrees?: number;
    /** Human-readable source, e.g. "geofabrik:india-latest". */
    source?: string;
    notes?: string;
  };
};

export type RoutingPackageEstimate = {
  estimatedSizeBytes: number | null;
  coverageBounds: OfflineRegionBounds | null;
  valhallaDataVersion: string | null;
  valhallaEngineVersion: string | null;
  /** True when the service will build the package during the download. */
  buildOnDemand: boolean;
};

export type RoutingManifestResolution =
  | { status: 'ready'; manifest: RoutingPackageManifest; manifestUrl: string }
  | {
      status: 'building';
      regionId: string;
      estimatedSizeBytes: number | null;
      retryAfterSeconds: number | null;
    };
