import {
  PLACE_SEARCH_BASE_URL,
  PLACE_SEARCH_EMAIL,
  PLACE_SEARCH_NEAR_RADIUS_METERS,
  PLACE_SEARCH_PROVIDER,
  PLACE_SEARCH_TIMEOUT_MS,
} from '../config';
import { distanceBetween } from '../utils/distanceUtils';
import type { Coordinate, PlaceResult } from '../types/navigation';

export type DestinationSearchOptions = {
  limit?: number;
  /** Bias and sort results around this coordinate ("near me" search). */
  near?: Coordinate | null;
  /** Radius used to build the Nominatim viewbox around `near`. */
  nearRadiusMeters?: number;
};

/**
 * Destination search is pluggable so an offline OSM/SQLite FTS5 provider can
 * replace the default coordinate parser without touching the search UI.
 */
export interface DestinationSearchProvider {
  search(
    query: string,
    options?: DestinationSearchOptions,
  ): Promise<PlaceResult[]>;
}

const PLACE_SEARCH_USER_AGENT = PLACE_SEARCH_EMAIL
  ? `offline-map/1.0 (${PLACE_SEARCH_EMAIL})`
  : 'offline-map/1.0';

const COORDINATE_PATTERN =
  /^(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/;

/**
 * Parses queries such as "40.7128, -74.0060" or "40.7128 -74.0060".
 * Coordinates are interpreted as latitude then longitude.
 */
export function parseCoordinateQuery(query: string): Coordinate | null {
  const match = query.trim().match(COORDINATE_PATTERN);
  if (!match) {
    return null;
  }

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

/**
 * Offline-safe provider. It supports coordinate entry and works without a
 * network connection.
 */
export class CoordinateSearchProvider implements DestinationSearchProvider {
  async search(
    query: string,
    options: DestinationSearchOptions = {},
  ): Promise<PlaceResult[]> {
    const coordinate = parseCoordinateQuery(query);
    if (!coordinate) {
      return [];
    }

    return [
      {
        id: `coordinate:${coordinate.latitude.toFixed(6)}:${coordinate.longitude.toFixed(6)}`,
        label: `${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}`,
        coordinate,
      },
    ].slice(0, options.limit ?? 5);
  }
}

type NominatimRecord = {
  place_id?: unknown;
  display_name?: unknown;
  name?: unknown;
  lat?: unknown;
  lon?: unknown;
  category?: unknown;
  type?: unknown;
};

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function viewboxAround(center: Coordinate, radiusMeters: number): string {
  const latitudeDelta = radiusMeters / 111_320;
  const longitudeScale = Math.max(
    Math.abs(Math.cos((center.latitude * Math.PI) / 180)),
    0.01,
  );
  const longitudeDelta = radiusMeters / (111_320 * longitudeScale);
  const west = center.longitude - longitudeDelta;
  const east = center.longitude + longitudeDelta;
  const south = center.latitude - latitudeDelta;
  const north = center.latitude + latitudeDelta;

  return [west, north, east, south].join(',');
}

function toPlaceResult(
  record: NominatimRecord,
  near: Coordinate | null,
): PlaceResult | null {
  const latitude = Number(record.lat);
  const longitude = Number(record.lon);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  const displayName = asTrimmedString(record.display_name);
  const name = asTrimmedString(record.name) ?? displayName?.split(',')[0]?.trim();
  if (!name) {
    return null;
  }

  const kind =
    asTrimmedString(record.type) ?? asTrimmedString(record.category) ?? null;
  const description =
    displayName && displayName !== name ? displayName : kind ?? undefined;
  const coordinate = { latitude, longitude };
  const placeId =
    typeof record.place_id === 'number' || typeof record.place_id === 'string'
      ? String(record.place_id)
      : `${latitude.toFixed(6)}:${longitude.toFixed(6)}`;

  return {
    id: `nominatim:${placeId}`,
    label: name,
    description,
    coordinate,
    distanceMeters: near ? distanceBetween(near, coordinate) : undefined,
  };
}

/**
 * Nominatim-backed place-name search. Results are biased towards `near` with a
 * viewbox and sorted by distance so "coffee near me" style queries behave the
 * way users expect. OpenStreetMap attribution is shown by the search UI.
 */
export class NominatimPlaceSearchProvider implements DestinationSearchProvider {
  constructor(private readonly baseUrl: string = PLACE_SEARCH_BASE_URL) {}

  async search(
    query: string,
    options: DestinationSearchOptions = {},
  ): Promise<PlaceResult[]> {
    if (!this.baseUrl) {
      return [];
    }

    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    const near = options.near ?? null;
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      limit: String(limit),
      'accept-language': 'en',
    });

    if (near) {
      params.set(
        'viewbox',
        viewboxAround(near, options.nearRadiusMeters ?? PLACE_SEARCH_NEAR_RADIUS_METERS),
      );
      // Prefer the viewbox but still allow matches just outside it.
      params.set('bounded', '0');
    }

    if (PLACE_SEARCH_EMAIL) {
      params.set('email', PLACE_SEARCH_EMAIL);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PLACE_SEARCH_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/search?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': PLACE_SEARCH_USER_AGENT,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Place search returned HTTP ${response.status}.`);
      }

      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error('Place search returned an invalid response.');
      }

      return payload
        .map((record) =>
          record && typeof record === 'object'
            ? toPlaceResult(record as NominatimRecord, near)
            : null,
        )
        .filter((result): result is PlaceResult => result !== null)
        .sort((left, right) => {
          if (left.distanceMeters == null || right.distanceMeters == null) {
            return 0;
          }
          return left.distanceMeters - right.distanceMeters;
        })
        .slice(0, limit);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Place search timed out. Check your connection.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

type PhotonFeature = {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: unknown };
};

function asIdString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return asTrimmedString(value);
}

function firstProperty(
  properties: Record<string, unknown> | undefined,
  keys: string[],
): string | null {
  if (!properties) {
    return null;
  }

  for (const key of keys) {
    const value = asTrimmedString(properties[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function toPhotonPlaceResult(
  feature: PhotonFeature,
  near: Coordinate | null,
): PlaceResult | null {
  const coordinates = Array.isArray(feature.geometry?.coordinates)
    ? feature.geometry?.coordinates
    : null;
  const longitude = Number(coordinates?.[0]);
  const latitude = Number(coordinates?.[1]);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  const properties = feature.properties;
  const name = firstProperty(properties, [
    'name',
    'street',
    'city',
    'county',
    'state',
    'country',
  ]);

  if (!name) {
    return null;
  }

  const addressParts = [
    'housenumber',
    'street',
    'district',
    'city',
    'county',
    'state',
    'country',
  ]
    .map((key) => asTrimmedString(properties?.[key]))
    .filter((value): value is string => value !== null);

  const description =
    [...new Set(addressParts)].filter((part) => part !== name).join(', ') ||
    undefined;

  const osmType = asTrimmedString(properties?.osm_type);
  const osmId = asIdString(properties?.osm_id);
  const coordinate = { latitude, longitude };

  return {
    id:
      osmType && osmId
        ? `photon:${osmType}${osmId}`
        : `photon:${latitude.toFixed(6)}:${longitude.toFixed(6)}`,
    label: name,
    description,
    coordinate,
    distanceMeters: near ? distanceBetween(near, coordinate) : undefined,
  };
}

/**
 * Photon-backed (OpenStreetMap) place-name search. Its public endpoint does
 * not need an API key and supports lat/lon result biasing, which makes it a
 * good default for "near me" searches.
 */
export class PhotonPlaceSearchProvider implements DestinationSearchProvider {
  constructor(private readonly baseUrl: string = PLACE_SEARCH_BASE_URL) {}

  async search(
    query: string,
    options: DestinationSearchOptions = {},
  ): Promise<PlaceResult[]> {
    if (!this.baseUrl) {
      return [];
    }

    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    const near = options.near ?? null;
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      lang: 'en',
    });

    if (near) {
      params.set('lat', String(near.latitude));
      params.set('lon', String(near.longitude));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PLACE_SEARCH_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': PLACE_SEARCH_USER_AGENT,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Place search returned HTTP ${response.status}.`);
      }

      const payload: unknown = await response.json();
      const features =
        payload &&
        typeof payload === 'object' &&
        Array.isArray((payload as { features?: unknown }).features)
          ? ((payload as { features: unknown[] }).features as PhotonFeature[])
          : null;

      if (!features) {
        throw new Error('Place search returned an invalid response.');
      }

      return features
        .map((feature) => toPhotonPlaceResult(feature, near))
        .filter((result): result is PlaceResult => result !== null)
        .sort(byDistance)
        .slice(0, limit);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Place search timed out. Check your connection.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function byDistance(left: PlaceResult, right: PlaceResult): number {
  if (left.distanceMeters == null || right.distanceMeters == null) {
    return 0;
  }
  return left.distanceMeters - right.distanceMeters;
}

/**
 * Tries each provider in order and returns the first non-empty result set.
 * Coordinate entry therefore works offline even when the online geocoder is
 * unreachable.
 */
export class CompositeSearchProvider implements DestinationSearchProvider {
  constructor(private readonly providers: DestinationSearchProvider[]) {}

  async search(
    query: string,
    options: DestinationSearchOptions = {},
  ): Promise<PlaceResult[]> {
    let lastError: unknown = null;

    for (const candidate of this.providers) {
      try {
        const results = await candidate.search(query, options);
        if (results.length > 0) {
          return results;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    return [];
  }
}

class LazyOfflinePlaceSearchProvider implements DestinationSearchProvider {
  async search(
    query: string,
    options: DestinationSearchOptions = {},
  ): Promise<PlaceResult[]> {
    const { searchOfflinePlaces } = await import('./offlinePlaceSearch');
    return searchOfflinePlaces(query, options);
  }
}

const onlineProvider =
  PLACE_SEARCH_PROVIDER === 'nominatim'
    ? new NominatimPlaceSearchProvider()
    : new PhotonPlaceSearchProvider();

let provider: DestinationSearchProvider = new CompositeSearchProvider([
  new CoordinateSearchProvider(),
  new LazyOfflinePlaceSearchProvider(),
  onlineProvider,
]);

/**
 * Called once an offline geocoder is available, for example during app startup:
 * setDestinationSearchProvider(new OfflineOsmSearchProvider(database)).
 */
export function setDestinationSearchProvider(
  next: DestinationSearchProvider,
): void {
  provider = next;
}

export function getDestinationSearchProvider(): DestinationSearchProvider {
  return provider;
}

export async function searchDestinations(
  query: string,
  options: DestinationSearchOptions = {},
): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const results = await provider.search(trimmed, options);
  const near = options.near ?? null;

  return results.slice(0, options.limit ?? 5).map((result) => ({
    ...result,
    distanceMeters:
      result.distanceMeters ??
      (near ? distanceBetween(near, result.coordinate) : undefined),
  }));
}
