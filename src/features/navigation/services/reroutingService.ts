import type { NavigationTuning } from '../types/navigation';

export type RerouteDecision = {
  isOffRoute: boolean;
  offRouteSamples: number;
  shouldReroute: boolean;
};

/**
 * Keeps the off-route state between GPS fixes and guarantees that only one
 * reroute request can be in flight at a time. A short deviation (for example a
 * GPS spike) cannot trigger a reroute until it survives both a sample count and
 * a time window.
 */
export class ReroutingService {
  private offRouteSamples = 0;
  private offRouteSince: number | null = null;
  private lastRerouteAt = 0;
  private inFlight = false;

  constructor(private readonly tuning: NavigationTuning) {}

  observe(distanceToRouteMeters: number, now = Date.now()): RerouteDecision {
    const isOffRoute =
      distanceToRouteMeters > this.tuning.offRouteThresholdMeters;

    if (!isOffRoute) {
      this.resetOffRoute();
      return { isOffRoute, offRouteSamples: 0, shouldReroute: false };
    }

    this.offRouteSamples += 1;
    if (this.offRouteSince === null) {
      this.offRouteSince = now;
    }

    const confirmedSamples =
      this.offRouteSamples >= this.tuning.offRouteConfirmationSamples;
    const confirmedTime =
      now - this.offRouteSince >= this.tuning.offRouteConfirmationMs;
    const cooldownElapsed =
      now - this.lastRerouteAt >= this.tuning.rerouteCooldownMs;

    return {
      isOffRoute,
      offRouteSamples: this.offRouteSamples,
      shouldReroute:
        !this.inFlight &&
        confirmedSamples &&
        confirmedTime &&
        cooldownElapsed,
    };
  }

  begin(now = Date.now()): boolean {
    if (this.inFlight) {
      return false;
    }

    this.inFlight = true;
    this.lastRerouteAt = now;
    this.resetOffRoute();
    return true;
  }

  finish(): void {
    this.inFlight = false;
  }

  reset(): void {
    this.resetOffRoute();
    this.lastRerouteAt = 0;
  }

  get isRerouting(): boolean {
    return this.inFlight;
  }

  private resetOffRoute(): void {
    this.offRouteSamples = 0;
    this.offRouteSince = null;
  }
}
