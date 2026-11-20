import type { RouteManeuver } from '../types/navigation';

export interface VoiceGuidance {
  speak(maneuver: RouteManeuver, distanceMeters: number): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Default implementation used until an Expo Speech adapter is registered.
 * Keeping this as a no-op means navigation works without a native speech
 * dependency and without pretending voice guidance is active.
 */
export class NoopVoiceGuidance implements VoiceGuidance {
  async speak(): Promise<void> {}

  async stop(): Promise<void> {}
}

export const voiceGuidance: VoiceGuidance = new NoopVoiceGuidance();

type AnnouncementBand = 'far' | 'near' | 'imminent';

function bandForDistance(distanceMeters: number): AnnouncementBand | null {
  if (distanceMeters <= 80) {
    return 'imminent';
  }
  if (distanceMeters <= 300) {
    return 'near';
  }
  if (distanceMeters <= 800) {
    return 'far';
  }
  return null;
}

/**
 * Deduplicates spoken instructions. Each manoeuvre is announced at most once
 * per distance band, so a stationary GPS fix cannot repeat the same sentence.
 */
export class ManeuverAnnouncer {
  private readonly announced = new Map<number, Set<AnnouncementBand>>();

  constructor(private readonly guidance: VoiceGuidance = voiceGuidance) {}

  async announce(
    maneuver: RouteManeuver,
    distanceMeters: number,
  ): Promise<void> {
    const band = bandForDistance(distanceMeters);
    if (!band) {
      return;
    }

    const bands = this.announced.get(maneuver.id) ?? new Set<AnnouncementBand>();
    if (bands.has(band)) {
      return;
    }

    bands.add(band);
    this.announced.set(maneuver.id, bands);

    // A route rarely has more than a few dozen manoeuvres. Prune ids that are
    // far behind the current instruction to keep the set bounded after reroutes.
    if (this.announced.size > 64) {
      const oldest = this.announced.keys().next().value;
      if (oldest !== undefined) {
        this.announced.delete(oldest);
      }
    }

    await this.guidance.speak(maneuver, distanceMeters);
  }

  reset(): void {
    this.announced.clear();
    void this.guidance.stop();
  }
}
