import { ROUTE_REQUEST_TIMEOUT_MS } from '../config';
import type {
  Coordinate,
  RouteGeometry,
  RouteManeuver,
  RouteResult,
  RouteSummary,
  TravelMode,
} from '../types/navigation';

export type RoutingErrorCode =
  | 'configuration'
  | 'invalid-input'
  | 'timeout'
  | 'network'
  | 'unavailable'
  | 'invalid-response'
  | 'no-route';

export class RoutingError extends Error {
  readonly code: RoutingErrorCode;

  constructor(code: RoutingErrorCode, message: string) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
  }
}

/**
 * Routing is deliberately behind an interface. The online Valhalla engine is
 * used today; an embedded Valhalla engine can be added later without changing
 * any UI or navigation-tracking code.
 */
export interface RoutingEngine {
  calculateRoute(
    origin: Coordinate,
    destination: Coordinate,
    travelMode: TravelMode,
  ): Promise<RouteResult>;
}

function isValidCoordinate(coordinate: Coordinate): boolean {
  return (
    Number.isFinite(coordinate.latitude) &&
    Number.isFinite(coordinate.longitude) &&
    coordinate.latitude >= -90 &&
    coordinate.latitude <= 90 &&
    coordinate.longitude >= -180 &&
    coordinate.longitude <= 180
  );
}

function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const coordinates: [number, number][] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      if (index >= encoded.length) {
        throw new RoutingError(
          'invalid-response',
          'The route geometry is truncated.',
        );
      }
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    latitude += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;

    do {
      if (index >= encoded.length) {
        throw new RoutingError(
          'invalid-response',
          'The route geometry is truncated.',
        );
      }
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    longitude += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    coordinates.push([longitude / factor, latitude / factor]);
  }

  if (coordinates.length < 2) {
    throw new RoutingError(
      'invalid-response',
      'The route contains too few points.',
    );
  }

  return coordinates;
}

function coordinateAt(
  coordinates: [number, number][],
  index: number | null,
): Coordinate {
  const point =
    coordinates[Math.max(0, Math.min(index ?? 0, coordinates.length - 1))];
  return { longitude: point[0], latitude: point[1] };
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RoutingError(
      'invalid-response',
      `Valhalla returned an invalid ${field}.`,
    );
  }
  return value;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionalShapeIndex(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function locationLabel(value: unknown, fallback: Coordinate): string {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts = [
      record.name,
      record.street,
      record.city,
      record.state,
      record.country,
    ].filter(
      (part): part is string =>
        typeof part === 'string' && part.trim().length > 0,
    );

    if (parts.length > 0) {
      return parts.join(', ');
    }
  }

  return `${fallback.latitude.toFixed(5)}, ${fallback.longitude.toFixed(5)}`;
}

export function parseRouteResponse(
  payload: unknown,
  origin: Coordinate,
  destination: Coordinate,
): RouteResult {
  if (!payload || typeof payload !== 'object') {
    throw new RoutingError(
      'invalid-response',
      'Valhalla returned an empty response.',
    );
  }

  const root = payload as {
    trip?: unknown;
    error?: unknown;
    error_code?: unknown;
    status_message?: unknown;
  };

  if (!root.trip) {
    const detail =
      typeof root.error === 'string'
        ? root.error
        : typeof root.status_message === 'string'
          ? root.status_message
          : 'Valhalla did not return a route.';
    const noRoute = /no path|no route|could not find/i.test(detail);
    throw new RoutingError(noRoute ? 'no-route' : 'invalid-response', detail);
  }

  if (typeof root.trip !== 'object') {
    throw new RoutingError('invalid-response', 'Valhalla returned an invalid trip.');
  }

  const tripRecord = root.trip as {
    status?: unknown;
    status_message?: unknown;
    summary?: { length?: unknown; time?: unknown };
    legs?: unknown;
    locations?: unknown;
    shape?: unknown;
  };

  if (typeof tripRecord.status === 'number' && tripRecord.status !== 0) {
    const detail =
      typeof tripRecord.status_message === 'string'
        ? tripRecord.status_message
        : 'Valhalla could not calculate a route.';
    throw new RoutingError(
      /no path|no route|could not find/i.test(detail) ? 'no-route' : 'invalid-response',
      detail,
    );
  }

  const leg = Array.isArray(tripRecord.legs) ? tripRecord.legs[0] : null;
  if (!leg || typeof leg !== 'object') {
    throw new RoutingError('no-route', 'Valhalla returned no route legs.');
  }

  const legRecord = leg as {
    shape?: unknown;
    maneuvers?: unknown;
    summary?: { length?: unknown; time?: unknown };
  };
  const encodedShape = legRecord.shape ?? tripRecord.shape;
  if (typeof encodedShape !== 'string') {
    throw new RoutingError(
      'invalid-response',
      'Valhalla returned no route geometry.',
    );
  }

  const coordinates = decodePolyline(encodedShape, 6);

  const maneuvers: RouteManeuver[] = [];
  if (Array.isArray(legRecord.maneuvers)) {
    legRecord.maneuvers.forEach((value, index) => {
      if (!value || typeof value !== 'object') {
        return;
      }

      const maneuver = value as {
        instruction?: unknown;
        verbal_pre_transition_instruction?: unknown;
        verbal_transition_alert_instruction?: unknown;
        type?: unknown;
        length?: unknown;
        time?: unknown;
        begin_shape_index?: unknown;
        end_shape_index?: unknown;
        street_names?: unknown;
      };

      if (typeof maneuver.instruction !== 'string') {
        return;
      }

      const verbalInstruction =
        typeof maneuver.verbal_pre_transition_instruction === 'string'
          ? maneuver.verbal_pre_transition_instruction
          : typeof maneuver.verbal_transition_alert_instruction === 'string'
            ? maneuver.verbal_transition_alert_instruction
            : maneuver.instruction;
      const beginShapeIndex = optionalShapeIndex(maneuver.begin_shape_index);

      maneuvers.push({
        id: index,
        instruction: maneuver.instruction,
        verbalInstruction,
        type: optionalNumber(maneuver.type) ?? 0,
        distanceMeters: (optionalNumber(maneuver.length) ?? 0) * 1000,
        durationSeconds: optionalNumber(maneuver.time) ?? 0,
        beginShapeIndex,
        endShapeIndex: optionalShapeIndex(maneuver.end_shape_index),
        coordinate: coordinateAt(coordinates, beginShapeIndex),
        streetNames: stringArray(maneuver.street_names),
      });
    });
  }

  const summary = legRecord.summary ?? tripRecord.summary;
  if (!summary) {
    throw new RoutingError(
      'invalid-response',
      'Valhalla returned no route summary.',
    );
  }

  const locations = Array.isArray(tripRecord.locations)
    ? tripRecord.locations
    : [];

  const geometry: RouteGeometry = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates },
  };

  return {
    geometry,
    distanceMeters: asNumber(summary.length, 'route distance') * 1000,
    durationSeconds: asNumber(summary.time, 'route duration'),
    maneuvers,
    summary: {
      from: locationLabel(locations[0], origin),
      to: locationLabel(locations[locations.length - 1], destination),
    } satisfies RouteSummary,
  };
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: unknown;
      status_message?: unknown;
    };
    if (typeof payload.error === 'string') {
      return payload.error;
    }
    if (typeof payload.status_message === 'string') {
      return payload.status_message;
    }
  } catch {
    // The response did not contain JSON; fall back to the HTTP status.
  }

  return '';
}

export class OnlineValhallaRoutingEngine implements RoutingEngine {
  async calculateRoute(
    origin: Coordinate,
    destination: Coordinate,
    travelMode: TravelMode,
  ): Promise<RouteResult> {
    if (!isValidCoordinate(origin) || !isValidCoordinate(destination)) {
      throw new RoutingError(
        'invalid-input',
        'Choose valid origin and destination coordinates.',
      );
    }

    const baseUrl = process.env.EXPO_PUBLIC_VALHALLA_URL?.trim().replace(
      /\/+$/,
      '',
    );
    if (!baseUrl) {
      throw new RoutingError(
        'configuration',
        'Routing is not configured. Set EXPO_PUBLIC_VALHALLA_URL in the app environment.',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      ROUTE_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`${baseUrl}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations: [
            { lat: origin.latitude, lon: origin.longitude },
            { lat: destination.latitude, lon: destination.longitude },
          ],
          costing: travelMode,
          units: 'kilometers',
          directions_options: { units: 'kilometers', language: 'en-US' },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await readErrorDetail(response);
        const noRoute = /no path|no route|could not find/i.test(detail);
        throw new RoutingError(
          noRoute
            ? 'no-route'
            : response.status >= 500
              ? 'unavailable'
              : 'network',
          detail || `Routing server returned HTTP ${response.status}.`,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new RoutingError(
          'invalid-response',
          'The routing server returned an unreadable response.',
        );
      }

      return parseRouteResponse(payload, origin, destination);
    } catch (error) {
      if (error instanceof RoutingError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RoutingError(
          'timeout',
          'The routing request timed out. Check the connection and try again.',
        );
      }
      throw new RoutingError(
        'network',
        'Unable to reach the routing server. Check your connection and try again.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Placeholder for an embedded Valhalla engine. MapLibre offline packs only
 * contain map-rendering resources, so this engine needs its own routing graph
 * (for example a bundled valhalla-mobile build and local tiles).
 *
 * It intentionally fails instead of silently falling back to the network so
 * offline navigation is never reported as working when it is not.
 */
export class OfflineRoutingEngine implements RoutingEngine {
  constructor(private readonly message = 'Offline routing data is not ready.') {}

  async calculateRoute(): Promise<RouteResult> {
    throw new RoutingError(
      'unavailable',
      this.message,
    );
  }
}

export const onlineValhallaRoutingEngine = new OnlineValhallaRoutingEngine();

let activeRoutingEngine: RoutingEngine = onlineValhallaRoutingEngine;

/**
 * Selects the engine used by `calculateRoute`. Pass `null` to restore the
 * online engine. The offline adapter only activates after its native bridge and
 * verified local tiles are available.
 */
export function setActiveRoutingEngine(engine: RoutingEngine | null): void {
  activeRoutingEngine = engine ?? onlineValhallaRoutingEngine;
}

export function getActiveRoutingEngine(): RoutingEngine {
  return activeRoutingEngine;
}

export function isOnlineRoutingActive(): boolean {
  return activeRoutingEngine === onlineValhallaRoutingEngine;
}

export function calculateRoute(
  origin: Coordinate,
  destination: Coordinate,
  travelMode: TravelMode,
): Promise<RouteResult> {
  return activeRoutingEngine.calculateRoute(origin, destination, travelMode);
}
