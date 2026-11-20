import type {
  Coordinate,
  RouteManeuver,
  RoutePoint,
} from '../types/navigation';
import { distanceBetween, toLocalMeters } from './distanceUtils';

export type RouteProjection = {
  distanceAlongRouteMeters: number;
  distanceToRouteMeters: number;
  segmentIndex: number;
  segmentProgress: number;
  snappedCoordinate: Coordinate;
};

export type RouteBounds = [west: number, south: number, east: number, north: number];

export function routePointToCoordinate(point: RoutePoint): Coordinate {
  return { longitude: point[0], latitude: point[1] };
}

/**
 * Distance from the start of the route to every vertex. The last value is the
 * geometric length of the route.
 */
export function buildCumulativeDistances(points: RoutePoint[]): number[] {
  if (points.length === 0) {
    return [];
  }

  const cumulative = new Array<number>(points.length).fill(0);

  for (let index = 1; index < points.length; index += 1) {
    cumulative[index] =
      cumulative[index - 1] +
      distanceBetween(
        routePointToCoordinate(points[index - 1]),
        routePointToCoordinate(points[index]),
      );
  }

  return cumulative;
}

/**
 * Projects a GPS fix onto the nearest segment of the route. Distances are
 * measured in metres and the returned distance along the route includes the
 * partial length of the matched segment.
 */
export function projectOntoRoute(
  coordinate: Coordinate,
  points: RoutePoint[],
  cumulativeDistances: number[] = buildCumulativeDistances(points),
): RouteProjection | null {
  if (points.length < 2) {
    return null;
  }

  const origin = toLocalMeters(
    [coordinate.longitude, coordinate.latitude],
    coordinate.latitude,
  );

  let best: RouteProjection | null = null;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = toLocalMeters(points[index], coordinate.latitude);
    const end = toLocalMeters(points[index + 1], coordinate.latitude);
    const segmentX = end[0] - start[0];
    const segmentY = end[1] - start[1];
    const lengthSquared = segmentX ** 2 + segmentY ** 2;
    const progress =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((origin[0] - start[0]) * segmentX + (origin[1] - start[1]) * segmentY) /
                lengthSquared,
            ),
          );

    const snappedCoordinate: Coordinate = {
      longitude:
        points[index][0] + (points[index + 1][0] - points[index][0]) * progress,
      latitude:
        points[index][1] + (points[index + 1][1] - points[index][1]) * progress,
    };
    const distanceToRouteMeters = distanceBetween(coordinate, snappedCoordinate);

    if (!best || distanceToRouteMeters < best.distanceToRouteMeters) {
      const segmentLength = Math.max(
        0,
        cumulativeDistances[index + 1] - cumulativeDistances[index],
      );

      best = {
        distanceAlongRouteMeters:
          cumulativeDistances[index] + segmentLength * progress,
        distanceToRouteMeters,
        segmentIndex: index,
        segmentProgress: progress,
        snappedCoordinate,
      };
    }
  }

  return best;
}

function shapeIndexDistance(
  index: number | null,
  cumulativeDistances: number[],
): number | null {
  if (index === null || cumulativeDistances.length === 0) {
    return null;
  }

  const clamped = Math.max(
    0,
    Math.min(cumulativeDistances.length - 1, Math.round(index)),
  );
  return cumulativeDistances[clamped];
}

/** Distance from the start of the route to the manoeuvre point. */
export function maneuverAlongRoute(
  maneuver: RouteManeuver,
  points: RoutePoint[],
  cumulativeDistances: number[],
): number | null {
  const fromShape = shapeIndexDistance(maneuver.beginShapeIndex, cumulativeDistances);
  if (fromShape !== null) {
    return fromShape;
  }

  const projection = projectOntoRoute(
    maneuver.coordinate,
    points,
    cumulativeDistances,
  );
  return projection?.distanceAlongRouteMeters ?? null;
}

/** End of the manoeuvre expressed as a distance from the route start. */
export function maneuverEndAlongRoute(
  maneuver: RouteManeuver,
  cumulativeDistances: number[],
): number | null {
  return shapeIndexDistance(maneuver.endShapeIndex, cumulativeDistances);
}

export function routeBounds(points: RoutePoint[]): RouteBounds | null {
  if (points.length < 2) {
    return null;
  }

  let west = points[0][0];
  let east = points[0][0];
  let south = points[0][1];
  let north = points[0][1];

  for (const [longitude, latitude] of points) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }

  return [west, south, east, north];
}

export function totalRouteDistance(cumulativeDistances: number[]): number {
  return cumulativeDistances[cumulativeDistances.length - 1] ?? 0;
}
