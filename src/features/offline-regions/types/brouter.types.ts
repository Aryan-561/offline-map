import type { OfflineRegionBounds } from './offlineRegion.types';

export type BrouterManifestTile = {
  name: string;
  file: string;
  /** Relative to the manifest URL when present. */
  url?: string;
  sizeBytes: number;
  /** Lowercase hex SHA-256 digest. */
  sha256: string;
};

export type BrouterManifest = {
  schemaVersion: 1;
  generatedAt: string;
  source: string;
  segments: {
    source: string;
    tiles: BrouterManifestTile[];
  };
  places: {
    tiles: BrouterManifestTile[];
  };
  profiles?: {
    version: string | null;
    files: unknown[];
  };
};

/**
 * Per-region record written after all shared BRouter tiles are installed.
 * It is the source of truth for reference counting and offline search.
 */
export type BrouterRegionPackage = {
  schemaVersion: 1;
  backend: 'brouter';
  regionId: string;
  engineVersion: string;
  dataVersion: string;
  bounds: OfflineRegionBounds;
  coverageBounds: OfflineRegionBounds;
  segmentTiles: string[];
  placeTiles: string[];
  segmentFiles: BrouterManifestTile[];
  placeFiles: BrouterManifestTile[];
  installedAt: string;
  sizeBytes: number;
};

export type BrouterRegionInspection =
  | {
      ok: true;
      package: BrouterRegionPackage;
      installedPath: string;
      manifestPath: string;
      sizeBytes: number;
    }
  | {
      ok: false;
      reason: string;
    };

export type BrouterInstallOutcome =
  | {
      status: 'completed';
      package: BrouterRegionPackage;
      installedPath: string;
      manifestPath: string;
      sizeBytes: number;
    }
  | {
      status: 'paused';
      downloadedBytes: number;
      totalBytes: number;
    };

export type BrouterDownloadCallbacks = {
  onProgress?: (progress: {
    downloadedBytes: number;
    totalBytes: number;
    progress: number;
    currentFile: string | null;
  }) => void;
};
