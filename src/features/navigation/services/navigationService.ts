import { DEFAULT_NAVIGATION_TUNING } from '../config';
import type {
  Coordinate,
  NavigationProgress,
  NavigationTuning,
  RouteResult,
} from '../types/navigation';
import {
  buildCumulativeDistances,
  maneuverAlongRoute,
  maneuverEndAlongRoute,
  projectOntoRoute,
  totalRouteDistance,
} from '../utils/routeUtils';

type ManeuverPosition = {
  along: number;
  end: number | null;
  maneuver: RouteResult['maneuvers'][number];
};

function currentStreetName(
  maneuvers: ManeuverPosition[],
  distanceAlongRouteMeters: number,
): string | null {
  for (const entry of maneuvers) {
    if (
      entry.end !== null &&
      entry.along <= distanceAlongRouteMeters &&
      distanceAlongRouteMeters <= entry.end
    ) {
      const name = entry.maneuver.streetNames[0];
      if (name) {
        return name;
      }
    }
  }

  let fallback: string | null = null;
  for (const entry of maneuvers) {
    if (entry.along > distanceAlongRouteMeters) {
      break;
    }
    fallback = entry.maneuver.streetNames[0] ?? fallback;
  }

  return fallback;
}

/**
 * Calculates every value the UI needs from a raw GPS fix. This function is
 * intentionally pure so it can be unit-tested and reused by a future offline
 * navigation engine.
 */
export function computeNavigationProgress(
  coordinate: Coordinate,
  route: RouteResult,
  tuning: NavigationTuning = DEFAULT_NAVIGATION_TUNING,
): NavigationProgress | null {
  const points = route.geometry.geometry.coordinates;
  if (points.length < 2) {
    return null;
  }

  const cumulativeDistances = buildCumulativeDistances(points);
  const projection = projectOntoRoute(coordinate, points, cumulativeDistances);
  if (!projection) {
    return null;
  }

  const maneuvers: ManeuverPosition[] = [];
  for (const maneuver of route.maneuvers) {
    const along = maneuverAlongRoute(maneuver, points, cumulativeDistances);
    if (along === null) {
      continue;
    }
    maneuvers.push({
      maneuver,
      along,
      end: maneuverEndAlongRoute(maneuver, cumulativeDistances),
    });
  }
  maneuvers.sort((first, second) => first.along - second.along);

  const currentAlong = projection.distanceAlongRouteMeters;
  const next = maneuvers.find(
    (entry) => entry.along >= currentAlong - tuning.maneuverAheadToleranceMeters,
  );

  const totalDistance = totalRouteDistance(cumulativeDistances);
  const remainingDistance = Math.max(0, totalDistance - currentAlong);
  const remainingRatio =
    route.distanceMeters > 0 ? remainingDistance / route.distanceMeters : 0;

  return {
    distanceToRouteMeters: projection.distanceToRouteMeters,
    distanceAlongRouteMeters: currentAlong,
    distanceToNextManeuverMeters: next
      ? Math.max(0, next.along - currentAlong)
      : null,
    remainingDistanceMeters: remainingDistance,
    remainingDurationSeconds: route.durationSeconds * Math.min(1, remainingRatio),
    nextManeuver: next?.maneuver ?? null,
    currentStreetName: currentStreetName(maneuvers, currentAlong),
    isOffRoute:
      projection.distanceToRouteMeters > tuning.offRouteThresholdMeters,
  };
}
