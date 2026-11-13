import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  OfflineBounds,
  OfflineRegion,
  OfflineRegionStatus,
} from '../types/offlineMap';

const DATABASE_NAME = 'offline_maps.db';

type OfflineRegionRow = {
  id: string;
  pack_id: string | null;
  region_name: string;
  bounds: string;
  min_zoom: number;
  max_zoom: number;
  style_url: string;
  status: string;
  progress: number;
  completed_resource_count: number;
  required_resource_count: number;
  size_bytes: number;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMN_BY_KEY: Record<keyof OfflineRegion, string> = {
  id: 'id',
  packId: 'pack_id',
  name: 'region_name',
  bounds: 'bounds',
  minZoom: 'min_zoom',
  maxZoom: 'max_zoom',
  styleUrl: 'style_url',
  status: 'status',
  progress: 'progress',
  completedResourceCount: 'completed_resource_count',
  requiredResourceCount: 'required_resource_count',
  sizeBytes: 'size_bytes',
  error: 'error',
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
    'SELECT * FROM offline_regions ORDER BY created_at DESC',
  );

  return rows.map(mapRow);
}

export async function getRegion(id: string): Promise<OfflineRegion | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<OfflineRegionRow>(
    'SELECT * FROM offline_regions WHERE id = ?',
    id,
  );

  return row ? mapRow(row) : null;
}

export async function insertRegion(region: OfflineRegion): Promise<void> {
  const database = await getDatabase();

  await database.runAsync(
    `INSERT INTO offline_regions (
      id, pack_id, region_name, bounds, min_zoom, max_zoom, style_url, status,
      progress, completed_resource_count, required_resource_count, size_bytes,
      error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      region.id,
      region.packId,
      region.name,
      JSON.stringify(region.bounds),
      region.minZoom,
      region.maxZoom,
      region.styleUrl,
      region.status,
      region.progress,
      region.completedResourceCount,
      region.requiredResourceCount,
      region.sizeBytes,
      region.error,
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
    values.push(key === 'bounds' ? JSON.stringify(value) : (value as string | number | null));
  }

  if (assignments.length === 0) {
    return;
  }

  const database = await getDatabase();
  values.push(id);
  await database.runAsync(
    `UPDATE offline_regions SET ${assignments.join(', ')} WHERE id = ?`,
    values,
  );
}

export async function deleteRegion(id: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM offline_regions WHERE id = ?', id);
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
    CREATE TABLE IF NOT EXISTS offline_regions (
      id TEXT PRIMARY KEY NOT NULL,
      pack_id TEXT,
      region_name TEXT NOT NULL,
      bounds TEXT NOT NULL,
      min_zoom INTEGER NOT NULL,
      max_zoom INTEGER NOT NULL,
      style_url TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,
      completed_resource_count INTEGER NOT NULL DEFAULT 0,
      required_resource_count INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_offline_regions_pack_id
      ON offline_regions (pack_id);
  `);

  return database;
}

function mapRow(row: OfflineRegionRow): OfflineRegion {
  return {
    id: row.id,
    packId: row.pack_id,
    name: row.region_name,
    bounds: JSON.parse(row.bounds) as OfflineBounds,
    minZoom: row.min_zoom,
    maxZoom: row.max_zoom,
    styleUrl: row.style_url,
    status: row.status as OfflineRegionStatus,
    progress: row.progress,
    completedResourceCount: row.completed_resource_count,
    requiredResourceCount: row.required_resource_count,
    sizeBytes: row.size_bytes,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
