import type { InstalledRoutingIndex } from '../../offline-regions/repositories/offlineRegionRepository';
import type { OfflineRegionBounds } from '../../offline-regions/types/offlineRegion.types';
import type { Coordinate, PlaceResult } from '../types/navigation';
import { distanceBetween } from '../utils/distanceUtils';
import type {
  DestinationSearchOptions,
  DestinationSearchProvider,
} from './searchService';

const PLACES_DATABASE_NAME = 'places.sqlite';
const MAX_CANDIDATES_PER_REGION = 200;

type OfflinePlaceRow = {
  name: string;
  display_name: string | null;
  kind: string | null;
  latitude: number;
  longitude: number;
  osm_type: string | null;
  osm_id: string | null;
};

export function buildFtsQuery(query: string): string | null {
  const tokens = query
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => token.length > 0);

  if (!tokens || tokens.length === 0) {
    return null;
  }

  return tokens
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(' AND ');
}

function boundsContainCoordinate(
  bounds: OfflineRegionBounds,
  coordinate: Coordinate,
): boolean {
  return (
    coordinate.latitude >= bounds.south &&
    coordinate.latitude <= bounds.north &&
    coordinate.longitude >= bounds.west &&
    coordinate.longitude <= bounds.east
  );
}

async function installedIndexesWithPlaces(
  near: Coordinate | null,
): Promise<InstalledRoutingIndex[]> {
  const [{ listInstalledRoutingIndexes }, { File }] = await Promise.all([
    import('../../offline-regions/repositories/offlineRegionRepository'),
    import('expo-file-system'),
  ]);

  let indexes: InstalledRoutingIndex[];

  try {
    indexes = await listInstalledRoutingIndexes();
  } catch {
    return [];
  }

  return indexes.filter((index) => {
    if (near && !boundsContainCoordinate(index.bounds, near)) {
      return false;
    }

    try {
      return new File(index.installedPath, PLACES_DATABASE_NAME).exists;
    } catch {
      return false;
    }
  });
}

async function queryIndex(
  index: InstalledRoutingIndex,
  ftsQuery: string,
  near: Coordinate | null,
): Promise<PlaceResult[]> {
  const { openDatabaseAsync } = await import('expo-sqlite');
  const directory = index.installedPath.replace(/\/+$/, '');
  const database = await openDatabaseAsync(
    PLACES_DATABASE_NAME,
    { useNewConnection: true },
    directory,
  );

  try {
    const rows = await database.getAllAsync<OfflinePlaceRow>(
      `SELECT name, display_name, kind, latitude, longitude, osm_type, osm_id
         FROM places
        WHERE places MATCH ?
        ORDER BY rank
        LIMIT ?`,
      [ftsQuery, MAX_CANDIDATES_PER_REGION],
    );

    const results: PlaceResult[] = [];

    for (const row of rows) {
      const latitude = Number(row.latitude);
      const longitude = Number(row.longitude);

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        continue;
      }

      const coordinate = { latitude, longitude };
      const description =
        (row.display_name && row.display_name.trim()) ||
        (row.kind && row.kind.trim()) ||
        undefined;

      results.push({
        id: `offline:${index.id}:${
          row.osm_type && row.osm_id
            ? `${row.osm_type}${row.osm_id}`
            : `${latitude.toFixed(5)}:${longitude.toFixed(5)}`
        }`,
        label: row.name,
        description,
        coordinate,
        distanceMeters: near ? distanceBetween(near, coordinate) : undefined,
      });
    }

    return results;
  } finally {
    await database.closeAsync();
  }
}

export async function searchOfflinePlaces(
  query: string,
  options: DestinationSearchOptions = {},
): Promise<PlaceResult[]> {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) {
    return [];
  }

  const near = options.near ?? null;
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
  const indexes = await installedIndexesWithPlaces(near);

  if (indexes.length === 0) {
    return [];
  }

  const results: PlaceResult[] = [];

  for (const index of indexes) {
    try {
      results.push(...(await queryIndex(index, ftsQuery, near)));
    } catch {
      continue;
    }
  }

  const seen = new Set<string>();
  const deduped = results.filter((result) => {
    const key = `${result.label}|${result.coordinate.latitude.toFixed(5)}|${result.coordinate.longitude.toFixed(5)}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  if (near) {
    deduped.sort(
      (left, right) =>
        (left.distanceMeters ?? Number.POSITIVE_INFINITY) -
        (right.distanceMeters ?? Number.POSITIVE_INFINITY),
    );
  }

  return deduped.slice(0, limit);
}

export class OfflineOsmSearchProvider implements DestinationSearchProvider {
  async search(
    query: string,
    options: DestinationSearchOptions = {},
  ): Promise<PlaceResult[]> {
    return searchOfflinePlaces(query, options);
  }
}
