import BrouterEngine from '@modules/brouter-engine';

import {
  getBrouterSegmentsDirectory,
  inspectInstalledBrouter,
} from '@/features/offline-regions/services/brouterDataService';

import type {
  Coordinate,
  RouteResult,
  TravelMode,
} from '../types/navigation';
import { isBrouterRegistered } from './brouterAvailability';
import { parseBrouterResponse } from './brouterResponse';
import { RoutingError, setActiveRoutingEngine } from './routingService';
import type { RoutingEngine } from './routingEngine';

const PROFILES: Record<TravelMode, string> = {
  auto: 'car-eco',
  pedestrian: 'shortest',
};

class BrouterRoutingEngine implements RoutingEngine {
  private regionId: string | null = null;
  private initialized = false;

  async initialize(regionId: string): Promise<void> {
    if (!BrouterEngine) {
      throw new RoutingError(
        'unavailable',
        'The BRouter native module is not installed in this build.',
      );
    }

    const inspection = await inspectInstalledBrouter(regionId);

    if (!inspection.ok) {
      throw new RoutingError(
        'unavailable',
        `Offline routing data is not ready: ${inspection.reason}`,
      );
    }

    try {
      await BrouterEngine.initialize({
        segmentDir: getBrouterSegmentsDirectory().uri,
      });
    } catch (error) {
      throw new RoutingError(
        'unavailable',
        error instanceof Error
          ? error.message
          : 'The BRouter engine could not load the offline segments.',
      );
    }

    this.regionId = regionId;
    this.initialized = true;
  }

  async calculateRoute(params: {
    origin: Coordinate;
    destination: Coordinate;
    costing: TravelMode;
  }): Promise<RouteResult> {
    if (!BrouterEngine || !this.initialized || !this.regionId) {
      throw new RoutingError(
        'unavailable',
        'The BRouter engine is not initialized. Download and initialize an offline region first.',
      );
    }

    let raw: string;

    try {
      raw = await BrouterEngine.route({
        origin: params.origin,
        destination: params.destination,
        profile: PROFILES[params.costing],
        timeoutMs: 60_000,
      });
    } catch (error) {
      throw new RoutingError(
        'unavailable',
        error instanceof Error
          ? error.message
          : 'The BRouter engine failed to calculate a route.',
      );
    }

    return parseBrouterResponse(raw, params.origin, params.destination);
  }

  async isReady(regionId: string): Promise<boolean> {
    if (!BrouterEngine || !this.initialized || this.regionId !== regionId) {
      return false;
    }

    try {
      return await BrouterEngine.isInitialized();
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    this.initialized = false;
    this.regionId = null;

    if (BrouterEngine) {
      await BrouterEngine.dispose().catch(() => undefined);
    }
  }
}

class BrouterNavigationEngine {
  private engine: BrouterRoutingEngine;
  private initialization: Promise<void> | null = null;

  constructor(private readonly regionId: string) {
    this.engine = new BrouterRoutingEngine();
  }

  async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  async calculateRoute(
    origin: Coordinate,
    destination: Coordinate,
    travelMode: TravelMode,
  ): Promise<RouteResult> {
    await this.ensureInitialized();

    return this.engine.calculateRoute({
      origin,
      destination,
      costing: travelMode,
    });
  }

  dispose(): Promise<void> {
    this.initialization = null;
    return this.engine.dispose();
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.engine.initialize(this.regionId).catch((error) => {
        this.initialization = null;
        throw error;
      });
    }

    return this.initialization;
  }
}

let activeOfflineEngine: BrouterNavigationEngine | null = null;
let activeOfflineRegionId: string | null = null;

export async function activateOfflineRouting(regionId: string): Promise<void> {
  if (!isBrouterRegistered()) {
    throw new RoutingError(
      'unavailable',
      'The BRouter native module is not installed in this build. Offline routing is available on Android development builds.',
    );
  }

  await deactivateOfflineRouting();

  const engine = new BrouterNavigationEngine(regionId);
  await engine.initialize();

  activeOfflineEngine = engine;
  activeOfflineRegionId = regionId;
  setActiveRoutingEngine(engine);
}

export async function deactivateOfflineRouting(): Promise<void> {
  if (!activeOfflineEngine) {
    activeOfflineRegionId = null;
    setActiveRoutingEngine(null);
    return;
  }

  const engine = activeOfflineEngine;
  activeOfflineEngine = null;
  activeOfflineRegionId = null;
  setActiveRoutingEngine(null);
  await engine.dispose();
}

export function isOfflineRoutingActivated(): boolean {
  return activeOfflineEngine !== null;
}

export function getActiveOfflineRegionId(): string | null {
  return activeOfflineRegionId;
}

export function isBrouterAvailable(): boolean {
  return isBrouterRegistered();
}
