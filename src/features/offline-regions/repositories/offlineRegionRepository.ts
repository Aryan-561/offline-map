import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  DatasetStatus,
  OfflineRegion,
  OfflineRegionBounds,
  OfflineRegionCoordinate,
  RoutingPackageFormat,
} from '../types/offlineRegion.types';

const DATABASE_NAME = 'offline_maps.db';

type OfflineRegionRow = {
  id: string;
  region_name: string;
  center: string;
  radius_km: number;
  bounds: string;
  map_region_id: string | null;
  map_pack_id: string | null;
  map_status: string;
  map_progress: number;
  map_downloaded_bytes: number;
  map_total_bytes: number | null;
  map_size_bytes: number;
  map_error: string | null;
  routing_status: string;
  routing_progress: number;
  routing_downloaded_bytes: number;
  routing_total_bytes: number | null;
  routing_size_bytes: number;
  routing_error: string | null;
  routing_coverage_bounds: string | null;
  routing_data_version: string | null;
  routing_engine_version: string | null;
  routing_package_format: string | null;
  routing_checksum_verified: number;
  routing_installed_path: string | null;
  routing_manifest_path: string | null;
  routing_manifest_url: string | null;
  is_navigation_ready: number;
  created_at: string;
  updated_at: string;
};

const COLUMN_BY_KEY: Record<keyof OfflineRegion, string> = {
  id: 'id',
  name: 'region_name',
  center: 'center',
  radiusKm: 'radius_km',
  bounds: 'bounds',
  mapRegionId: 'map_region_id',
  mapPackId: 'map_pack_id',
  mapStatus: 'map_status',
  mapProgress: 'map_progress',
  mapDownloadedBytes: 'map_downloaded_bytes',
  mapTotalBytes: 'map_total_bytes',
  mapSizeBytes: 'map_size_bytes',
  mapError: 'map_error',
  routingStatus: 'routing_status',
  routingProgress: 'routing_progress',
  routingDownloadedBytes: 'routing_downloaded_bytes',
  routingTotalBytes: 'routing_total_bytes',
  routingSizeBytes: 'routing_size_bytes',
  routingError: 'routing_error',
  routingCoverageBounds: 'routing_coverage_bounds',
  routingDataVersion: 'routing_data_version',
  routingEngineVersion: 'routing_engine_version',
  routingPackageFormat: 'routing_package_format',
  routingChecksumVerified: 'routing_checksum_verified',
  routingInstalledPath: 'routing_installed_path',
  routingManifestPath: 'routing_manifest_path',
  routingManifestUrl: 'routing_manifest_url',
  isNavigationReady: 'is_navigation_ready',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

let databasePromise: Promise<SQLiteDatabase> | null = null;

export async function initializeDatabase(): Promise<void> {
  await getDatabase();
}

export async function listRegions(): Promise<OfflineRegion[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<OfflineRegionRow>(
    'SELECT * FROM combined_offline_regions ORDER BY created_at DESC',
  );

  return rows.map(mapRow);
}

export type InstalledRoutingIndex = {
  id: string;
  name: string;
  bounds: OfflineRegionBounds;
  installedPath: string;
};

export async function listInstalledRoutingIndexes(): Promise<
  InstalledRoutingIndex[]
> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<{
    id: string;
    region_name: string;
    bounds: string;
    routing_installed_path: string;
  }>(
    `SELECT id, region_name, bounds, routing_installed_path
       FROM combined_offline_regions
      WHERE routing_status = 'completed'
        AND routing_installed_path IS NOT NULL
      ORDER BY created_at DESC`,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.region_name,
    bounds: JSON.parse(row.bounds) as OfflineRegionBounds,
    installedPath: row.routing_installed_path,
  }));
}

export async function getRegion(id: string): Promise<OfflineRegion | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<OfflineRegionRow>(
    'SELECT * FROM combined_offline_regions WHERE id = ?',
    id,
  );

  return row ? mapRow(row) : null;
}

export async function insertRegion(region: OfflineRegion): Promise<void> {
  const database = await getDatabase();

  await database.runAsync(
    `INSERT INTO combined_offline_regions (
      id, region_name, center, radius_km, bounds,
      map_region_id, map_pack_id, map_status, map_progress,
      map_downloaded_bytes, map_total_bytes, map_size_bytes, map_error,
      routing_status, routing_progress, routing_downloaded_bytes,
      routing_total_bytes, routing_size_bytes, routing_error,
      routing_coverage_bounds, routing_data_version, routing_engine_version,
      routing_package_format, routing_checksum_verified, routing_installed_path,
      routing_manifest_path, routing_manifest_url, is_navigation_ready,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      region.id,
      region.name,
      JSON.stringify(region.center),
      region.radiusKm,
      JSON.stringify(region.bounds),
      region.mapRegionId,
      region.mapPackId,
      region.mapStatus,
      region.mapProgress,
      region.mapDownloadedBytes,
      region.mapTotalBytes,
      region.mapSizeBytes,
      region.mapError,
      region.routingStatus,
      region.routingProgress,
      region.routingDownloadedBytes,
      region.routingTotalBytes,
      region.routingSizeBytes,
      region.routingError,
      region.routingCoverageBounds ? JSON.stringify(region.routingCoverageBounds) : null,
      region.routingDataVersion,
      region.routingEngineVersion,
      region.routingPackageFormat,
      region.routingChecksumVerified ? 1 : 0,
      region.routingInstalledPath,
      region.routingManifestPath,
      region.routingManifestUrl,
      region.isNavigationReady ? 1 : 0,
      region.createdAt,
      region.updatedAt,
    ],
  );
}

export async function updateRegion(region: OfflineRegion): Promise<void> {
  const { id, ...patch } = region;
  await patchRegion(id, patch);
}

export async function patchRegion(
  id: string,
  patch: Partial<Omit<OfflineRegion, 'id'>>,
): Promise<void> {
  const assignments: string[] = [];
  const values: (string | number | null)[] = [];

  for (const key of Object.keys(patch) as (keyof Omit<OfflineRegion, 'id'>)[]) {
    const value = patch[key];

    if (value === undefined) {
      continue;
    }

    assignments.push(`${COLUMN_BY_KEY[key]} = ?`);
    values.push(serializeValue(key, value));
  }

  if (assignments.length === 0) {
    return;
  }

  const database = await getDatabase();
  values.push(id);
  await database.runAsync(
    `UPDATE combined_offline_regions SET ${assignments.join(', ')} WHERE id = ?`,
    values,
  );
}

export async function deleteRegion(id: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM combined_offline_regions WHERE id = ?', id);
}

async function getDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabase();
  }

  return databasePromise;
}

async function openDatabase(): Promise<SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);

  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS combined_offline_regions (
      id TEXT PRIMARY KEY NOT NULL,
      region_name TEXT NOT NULL,
      center TEXT NOT NULL,
      radius_km REAL NOT NULL,
      bounds TEXT NOT NULL,
      map_region_id TEXT,
      map_pack_id TEXT,
      map_status TEXT NOT NULL,
      map_progress REAL NOT NULL DEFAULT 0,
      map_downloaded_bytes INTEGER NOT NULL DEFAULT 0,
      map_total_bytes INTEGER,
      map_size_bytes INTEGER NOT NULL DEFAULT 0,
      map_error TEXT,
      routing_status TEXT NOT NULL,
      routing_progress REAL NOT NULL DEFAULT 0,
      routing_downloaded_bytes INTEGER NOT NULL DEFAULT 0,
      routing_total_bytes INTEGER,
      routing_size_bytes INTEGER NOT NULL DEFAULT 0,
      routing_error TEXT,
      routing_coverage_bounds TEXT,
      routing_data_version TEXT,
      routing_engine_version TEXT,
      routing_package_format TEXT,
      routing_checksum_verified INTEGER NOT NULL DEFAULT 0,
      routing_installed_path TEXT,
      routing_manifest_path TEXT,
      routing_manifest_url TEXT,
      is_navigation_ready INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_combined_offline_regions_map_region
      ON combined_offline_regions (map_region_id);
  `);

  return database;
}

function serializeValue(
  key: keyof Omit<OfflineRegion, 'id'>,
  value: unknown,
): string | number | null {
  switch (key) {
    case 'center':
    case 'bounds':
    case 'routingCoverageBounds':
      return value === null || value === undefined ? null : JSON.stringify(value);
    case 'isNavigationReady':
    case 'routingChecksumVerified':
      return value ? 1 : 0;
    default:
      return value as string | number | null;
  }
}

function mapRow(row: OfflineRegionRow): OfflineRegion {
  return {
    id: row.id,
    name: row.region_name,
    center: JSON.parse(row.center) as OfflineRegionCoordinate,
    radiusKm: row.radius_km,
    bounds: JSON.parse(row.bounds) as OfflineRegionBounds,
    mapRegionId: row.map_region_id,
    mapPackId: row.map_pack_id,
    mapStatus: row.map_status as DatasetStatus,
    mapProgress: row.map_progress,
    mapDownloadedBytes: row.map_downloaded_bytes,
    mapTotalBytes: row.map_total_bytes,
    mapSizeBytes: row.map_size_bytes,
    mapError: row.map_error,
    routingStatus: row.routing_status as DatasetStatus,
    routingProgress: row.routing_progress,
    routingDownloadedBytes: row.routing_downloaded_bytes,
    routingTotalBytes: row.routing_total_bytes,
    routingSizeBytes: row.routing_size_bytes,
    routingError: row.routing_error,
    routingCoverageBounds: row.routing_coverage_bounds
      ? (JSON.parse(row.routing_coverage_bounds) as OfflineRegionBounds)
      : null,
    routingDataVersion: row.routing_data_version,
    routingEngineVersion: row.routing_engine_version,
    routingPackageFormat: row.routing_package_format as RoutingPackageFormat | null,
    routingChecksumVerified: row.routing_checksum_verified === 1,
    routingInstalledPath: row.routing_installed_path,
    routingManifestPath: row.routing_manifest_path,
    routingManifestUrl: row.routing_manifest_url,
    isNavigationReady: row.is_navigation_ready === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
