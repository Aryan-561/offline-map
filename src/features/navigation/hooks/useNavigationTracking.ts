import { useMemo } from 'react';

import { DEFAULT_NAVIGATION_TUNING } from '../config';
import { computeNavigationProgress } from '../services/navigationService';
import type {
  Coordinate,
  NavigationProgress,
  NavigationTuning,
  RouteResult,
} from '../types/navigation';

export function useNavigationTracking(
  coordinate: Coordinate | null,
  route: RouteResult | null,
  active: boolean,
  tuning: NavigationTuning = DEFAULT_NAVIGATION_TUNING,
): NavigationProgress | null {
  return useMemo(() => {
    if (!coordinate || !route || !active) {
      return null;
    }

    return computeNavigationProgress(coordinate, route, tuning);
  }, [active, coordinate, route, tuning]);
}
