import { useCallback, useEffect, useState } from 'react';

import { NAVIGATION_LOCATION_OPTIONS } from '../config';
import {
  getCurrentLocation,
  requestForegroundLocation,
  watchLocation,
} from '../services/locationService';
import type { Coordinate } from '../types/navigation';

export function useCurrentLocation(active: boolean) {
  const [coordinate, setCoordinate] = useState<Coordinate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      await requestForegroundLocation();
      setCoordinate(await getCurrentLocation());
      setError(null);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Unable to determine your location.');
    }
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }

    let cancelled = false;
    let subscription: { remove: () => void } | undefined;

    void (async () => {
      try {
        await requestForegroundLocation();
        if (cancelled) return;
        setCoordinate(await getCurrentLocation());
        subscription = await watchLocation(
          (next) => {
            if (!cancelled) setCoordinate(next);
          },
          (value) => {
            if (!cancelled) setError(value.message);
          },
          {
            distanceIntervalMeters:
              NAVIGATION_LOCATION_OPTIONS.distanceIntervalMeters,
            timeIntervalMs: NAVIGATION_LOCATION_OPTIONS.timeIntervalMs,
          },
        );
        setError(null);
      } catch (value) {
        if (!cancelled) {
          setError(value instanceof Error ? value.message : 'Unable to determine your location.');
        }
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [active]);

  return { coordinate, error, refresh };
}
