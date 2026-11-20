import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { mergeNavigationTuning } from '../config';
import { ReroutingService } from '../services/reroutingService';
import {
  ManeuverAnnouncer,
  type VoiceGuidance,
} from '../services/voiceGuidance';
import type {
  Coordinate,
  NavigationTuning,
  TravelMode,
} from '../types/navigation';
import { useCurrentLocation } from './useCurrentLocation';
import { useNavigationTracking } from './useNavigationTracking';
import { useRouteCalculation } from './useRouteCalculation';

export type UseNavigationOptions = Partial<NavigationTuning> & {
  voiceGuidance?: VoiceGuidance;
};

function routeKey(destination: Coordinate, mode: TravelMode): string {
  return `${destination.latitude.toFixed(6)},${destination.longitude.toFixed(6)}:${mode}`;
}

export function useNavigation(options?: UseNavigationOptions) {
  const tuning = useMemo(
    () => mergeNavigationTuning(options),
    // The screen uses the default tuning. Passing a fresh object per render is
    // fine; the merged values are what matter.
    [options],
  );
  const rerouting = useMemo(() => new ReroutingService(tuning), [tuning]);
  const announcer = useMemo(
    () => new ManeuverAnnouncer(options?.voiceGuidance),
    [options?.voiceGuidance],
  );

  const [destination, setDestination] = useState<Coordinate | null>(null);
  const [mode, setMode] = useState<TravelMode>('auto');
  const [isNavigating, setIsNavigating] = useState(false);
  const [isRerouting, setIsRerouting] = useState(false);

  const { coordinate, error: locationError } = useCurrentLocation(true);
  const {
    route,
    calculate,
    clear,
    clearError,
    isCalculating,
    error: routeError,
  } = useRouteCalculation();
  const progress = useNavigationTracking(
    coordinate,
    route,
    isNavigating,
    tuning,
  );

  const autoRouteKey = useRef<string | null>(null);
  const appState = useRef(AppState.currentState);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      appState.current = state;
    });
    return () => subscription.remove();
  }, []);

  useEffect(
    () => () => {
      rerouting.reset();
      announcer.reset();
    },
    [announcer, rerouting],
  );

  // Auto-calculate once per destination + mode pair. Location updates do not
  // repeat the request because the key only changes when the user changes the
  // destination or travel mode.
  useEffect(() => {
    if (!destination || !coordinate) {
      return;
    }

    const key = routeKey(destination, mode);
    if (autoRouteKey.current === key) {
      return;
    }

    autoRouteKey.current = key;
    void calculate(coordinate, destination, mode);
  }, [calculate, coordinate, destination, mode]);

  const selectDestination = useCallback(
    (value: Coordinate) => {
      setIsNavigating(false);
      setIsRerouting(false);
      rerouting.reset();
      autoRouteKey.current = null;
      setDestination(value);
      clearError();
      clear();
    },
    [clear, clearError, rerouting],
  );

  const changeMode = useCallback((nextMode: TravelMode) => {
    setMode(nextMode);
  }, []);

  const startNavigation = useCallback(() => {
    if (!route) {
      return;
    }

    rerouting.reset();
    setIsRerouting(false);
    setIsNavigating(true);
  }, [rerouting, route]);

  const stopNavigation = useCallback(() => {
    setIsNavigating(false);
    setIsRerouting(false);
    rerouting.reset();
  }, [rerouting]);

  const clearDestination = useCallback(() => {
    setIsNavigating(false);
    setIsRerouting(false);
    autoRouteKey.current = null;
    rerouting.reset();
    setDestination(null);
    clear();
  }, [clear, rerouting]);

  const retryRoute = useCallback(() => {
    if (!destination || !coordinate) {
      return;
    }

    autoRouteKey.current = routeKey(destination, mode);
    clearError();
    void calculate(coordinate, destination, mode);
  }, [calculate, clearError, coordinate, destination, mode]);

  const runReroute = useCallback(async () => {
    if (!coordinate || !destination || !rerouting.begin()) {
      return;
    }

    setIsRerouting(true);
    await calculate(coordinate, destination, mode, {
      preserveRouteOnError: true,
    });

    rerouting.finish();
    if (mounted.current) {
      setIsRerouting(false);
    }
  }, [calculate, coordinate, destination, mode, rerouting]);

  // Off-route detection and rerouting. The service requires several sustained
  // off-route fixes and enforces a cooldown, so a single bad GPS sample cannot
  // start a reroute.
  useEffect(() => {
    if (
      !isNavigating ||
      isRerouting ||
      !progress ||
      !coordinate ||
      !destination
    ) {
      return;
    }

    if (appState.current !== 'active') {
      return;
    }

    const decision = rerouting.observe(progress.distanceToRouteMeters);
    if (!decision.shouldReroute) {
      return;
    }

    // Schedule as an external async event. The rerouting service also guards
    // against duplicate requests, so a re-render cannot start two reroutes.
    const timer = setTimeout(() => {
      void runReroute();
    }, 0);

    return () => clearTimeout(timer);
  }, [
    coordinate,
    destination,
    isNavigating,
    isRerouting,
    progress,
    rerouting,
    runReroute,
  ]);

  // Voice guidance is prepared through an abstraction. The default provider is
  // a no-op, and the announcer prevents duplicate instructions per band.
  useEffect(() => {
    if (!isNavigating) {
      announcer.reset();
      return;
    }

    if (!progress?.nextManeuver) {
      return;
    }

    void announcer.announce(
      progress.nextManeuver,
      progress.distanceToNextManeuverMeters ?? 0,
    );
  }, [announcer, isNavigating, progress]);

  return {
    destination,
    coordinate,
    mode,
    route,
    progress,
    isNavigating,
    isRerouting,
    isCalculating,
    locationError,
    routeError,
    selectDestination,
    changeMode,
    startNavigation,
    stopNavigation,
    clearDestination,
    retryRoute,
    clearRouteError: clearError,
  };
}
