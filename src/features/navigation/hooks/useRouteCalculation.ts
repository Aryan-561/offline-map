import { useCallback, useRef, useState } from 'react';

import {
  calculateRoute,
  RoutingError,
} from '../services/routingService';
import type {
  Coordinate,
  RouteResult,
  TravelMode,
} from '../types/navigation';

type CalculateOptions = {
  /** Keep the previous route if a reroute fails mid-navigation. */
  preserveRouteOnError?: boolean;
};

export function useRouteCalculation() {
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const calculate = useCallback(
    async (
      origin: Coordinate,
      destination: Coordinate,
      mode: TravelMode,
      options: CalculateOptions = {},
    ) => {
      const id = requestId.current + 1;
      requestId.current = id;
      setIsCalculating(true);
      setError(null);

      try {
        const result = await calculateRoute(origin, destination, mode);
        if (requestId.current !== id) {
          return null;
        }
        setRoute(result);
        return result;
      } catch (value) {
        if (requestId.current !== id) {
          return null;
        }
        if (!options.preserveRouteOnError) {
          setRoute(null);
        }
        setError(
          value instanceof RoutingError
            ? value.message
            : 'Unable to calculate the route.',
        );
        return null;
      } finally {
        if (requestId.current === id) {
          setIsCalculating(false);
        }
      }
    },
    [],
  );

  const clear = useCallback(() => {
    requestId.current += 1;
    setRoute(null);
    setError(null);
    setIsCalculating(false);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    route,
    calculate,
    clear,
    clearError,
    isCalculating,
    error,
  };
}
