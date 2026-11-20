import type { NavigationTuning } from './types/navigation';

/**
 * Navigation tuning values. They are deliberately centralised so that the
 * deviation threshold and rerouting behaviour can be adjusted without touching
 * routing or UI code.
 */
export const DEFAULT_NAVIGATION_TUNING: NavigationTuning = {
  offRouteThresholdMeters: 50,
  offRouteConfirmationSamples: 3,
  offRouteConfirmationMs: 5_000,
  rerouteCooldownMs: 15_000,
  maneuverAheadToleranceMeters: 20,
};

export const ROUTE_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Location update cadence used while navigating. Background location is
 * intentionally not requested; this only applies while the app is foregrounded.
 */
export const NAVIGATION_LOCATION_OPTIONS = {
  distanceIntervalMeters: 5,
  timeIntervalMs: 2_000,
};

const DEFAULT_PLACE_SEARCH_URL = 'https://photon.komoot.io/api';

/**
 * Place-name search uses Photon (OpenStreetMap-based) by default because its
 * public endpoint does not require an API key. Point this at a self-hosted
 * Photon or Nominatim instance for production use. Set
 * EXPO_PUBLIC_PLACE_SEARCH_EMAIL so Nominatim requests identify the app as
 * required by its usage policy.
 */
export const PLACE_SEARCH_BASE_URL =
  process.env.EXPO_PUBLIC_PLACE_SEARCH_URL?.trim().replace(/\/+$/, '') ??
  DEFAULT_PLACE_SEARCH_URL;

export const PLACE_SEARCH_PROVIDER: 'photon' | 'nominatim' =
  process.env.EXPO_PUBLIC_PLACE_SEARCH_PROVIDER?.trim().toLowerCase() ===
    'nominatim' || /nominatim/i.test(PLACE_SEARCH_BASE_URL)
    ? 'nominatim'
    : 'photon';

export const PLACE_SEARCH_EMAIL =
  process.env.EXPO_PUBLIC_PLACE_SEARCH_EMAIL?.trim() || '';

export const PLACE_SEARCH_TIMEOUT_MS = 10_000;

/** How far around the current position results are preferred/bounded. */
export const PLACE_SEARCH_NEAR_RADIUS_METERS = 50_000;

export function mergeNavigationTuning(
  overrides?: Partial<NavigationTuning>,
): NavigationTuning {
  return {
    offRouteThresholdMeters:
      overrides?.offRouteThresholdMeters ??
      DEFAULT_NAVIGATION_TUNING.offRouteThresholdMeters,
    offRouteConfirmationSamples:
      overrides?.offRouteConfirmationSamples ??
      DEFAULT_NAVIGATION_TUNING.offRouteConfirmationSamples,
    offRouteConfirmationMs:
      overrides?.offRouteConfirmationMs ??
      DEFAULT_NAVIGATION_TUNING.offRouteConfirmationMs,
    rerouteCooldownMs:
      overrides?.rerouteCooldownMs ??
      DEFAULT_NAVIGATION_TUNING.rerouteCooldownMs,
    maneuverAheadToleranceMeters:
      overrides?.maneuverAheadToleranceMeters ??
      DEFAULT_NAVIGATION_TUNING.maneuverAheadToleranceMeters,
  };
}
