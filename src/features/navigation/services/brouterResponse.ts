import type {
  Coordinate,
  RouteGeometry,
  RouteManeuver,
  RoutePoint,
  RouteResult,
} from '../types/navigation';
import { RoutingError } from './routingService';

type BrouterFeature = {
  properties?: Record<string, unknown>;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
};

type BrouterVoiceHint = [number, number, number, number, number];

export function parseBrouterResponse(
  raw: string,
  origin: Coordinate,
  destination: Coordinate,
): RouteResult {
  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    throw new RoutingError(
      'invalid-response',
      'The BRouter engine returned an unreadable response.',
    );
  }

  const root = payload as { features?: unknown };

  if (!Array.isArray(root.features)) {
    throw new RoutingError(
      'invalid-response',
      'The BRouter engine returned no route features.',
    );
  }

  const feature = root.features.find((item): item is BrouterFeature => {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const geometry = (item as BrouterFeature).geometry;
    return geometry?.type === 'LineString' && Array.isArray(geometry.coordinates);
  });

  if (!feature?.geometry?.coordinates) {
    throw new RoutingError(
      'no-route',
      'BRouter did not find a route between these points.',
    );
  }

  const points = (feature.geometry.coordinates as unknown[])
    .map((point): RoutePoint | null => {
      if (!Array.isArray(point) || point.length < 2) {
        return null;
      }

      const longitude = Number(point[0]);
      const latitude = Number(point[1]);

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

      return [longitude, latitude];
    })
    .filter((point): point is RoutePoint => point !== null);

  if (points.length < 2) {
    throw new RoutingError(
      'invalid-response',
      'The BRouter route contains too few points.',
    );
  }

  const properties = feature.properties ?? {};
  const distanceMeters = numericProperty(properties['track-length']) ?? 0;
  const durationSeconds = numericProperty(properties['total-time']) ?? 0;
  const voiceHints = Array.isArray(properties.voicehints)
    ? properties.voicehints
        .map((hint) => parseVoiceHint(hint))
        .filter((hint): hint is BrouterVoiceHint => hint !== null)
        .sort((left, right) => left[0] - right[0])
    : [];

  const maneuvers = buildManeuvers(
    voiceHints,
    points,
    distanceMeters,
    durationSeconds,
  );

  return {
    geometry: {
      type: 'Feature',
      properties: { creator: 'BRouter' },
      geometry: {
        type: 'LineString',
        coordinates: points,
      },
    } satisfies RouteGeometry,
    distanceMeters,
    durationSeconds,
    maneuvers,
    summary: {
      from: formatCoordinate(origin),
      to: formatCoordinate(destination),
    },
  };
}

function parseVoiceHint(value: unknown): BrouterVoiceHint | null {
  if (!Array.isArray(value) || value.length < 5) {
    return null;
  }

  const numbers = value.slice(0, 5).map(Number);

  if (!numbers.every(Number.isFinite)) {
    return null;
  }

  return [numbers[0], numbers[1], numbers[2], numbers[3], numbers[4]];
}

function buildManeuvers(
  hints: BrouterVoiceHint[],
  points: RoutePoint[],
  distanceMeters: number,
  durationSeconds: number,
): RouteManeuver[] {
  const lastIndex = points.length - 1;

  if (hints.length === 0) {
    return [
      {
        id: 0,
        instruction: 'Continue on the route',
        verbalInstruction: 'Continue on the route',
        type: 8,
        distanceMeters,
        durationSeconds,
        beginShapeIndex: 0,
        endShapeIndex: lastIndex,
        coordinate: toCoordinate(points[0]),
        streetNames: [],
      },
    ];
  }

  return hints.map((hint, index) => {
    const beginShapeIndex = Math.max(
      0,
      Math.min(lastIndex, Math.round(hint[0])),
    );
    const next = hints[index + 1];
    const endShapeIndex = next
      ? Math.max(
          beginShapeIndex,
          Math.min(lastIndex, Math.round(next[0])),
        )
      : lastIndex;
    const command = hint[1];
    const exitNumber = Math.round(hint[2]);
    const instruction = instructionForCommand(command, exitNumber);
    const hintDistance = hint[3];
    const estimatedDuration =
      distanceMeters > 0 && durationSeconds > 0
        ? (hintDistance / distanceMeters) * durationSeconds
        : 0;

    return {
      id: index,
      instruction,
      verbalInstruction: instruction,
      type: maneuverTypeForCommand(command),
      distanceMeters: hintDistance,
      durationSeconds: estimatedDuration,
      beginShapeIndex,
      endShapeIndex,
      coordinate: toCoordinate(points[beginShapeIndex]),
      streetNames: [],
    };
  });
}

function instructionForCommand(command: number, exitNumber: number): string {
  switch (command) {
    case 1:
      return 'Continue straight';
    case 2:
      return 'Turn left';
    case 3:
      return 'Turn slightly left';
    case 4:
      return 'Turn sharply left';
    case 5:
      return 'Turn right';
    case 6:
      return 'Turn slightly right';
    case 7:
      return 'Turn sharply right';
    case 8:
      return 'Keep left';
    case 9:
      return 'Keep right';
    case 10:
    case 11:
    case 15:
      return 'Make a U-turn';
    case 13:
      return exitNumber > 0
        ? `At the roundabout, take exit ${exitNumber}`
        : 'Enter the roundabout';
    case 14:
      return exitNumber > 0
        ? `At the roundabout, take exit ${exitNumber} to the left`
        : 'Enter the roundabout to the left';
    case 16:
      return 'Continue in a straight line';
    case 17:
      return 'Exit left';
    case 18:
      return 'Exit right';
    default:
      return 'Continue on the route';
  }
}

function maneuverTypeForCommand(command: number): number {
  switch (command) {
    case 2:
    case 3:
    case 4:
      return 15;
    case 5:
    case 6:
    case 7:
      return 10;
    case 8:
    case 9:
      return 22;
    case 10:
    case 11:
    case 15:
      return 12;
    case 13:
    case 14:
      return 26;
    case 16:
      return 8;
    case 17:
    case 18:
      return 21;
    default:
      return 8;
  }
}

function numericProperty(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toCoordinate(point: RoutePoint): Coordinate {
  return { longitude: point[0], latitude: point[1] };
}

function formatCoordinate(coordinate: Coordinate): string {
  return `${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}`;
}

