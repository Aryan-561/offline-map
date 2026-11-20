import { File } from 'expo-file-system';

import { inspectInstalledRouting } from '@/features/offline-regions/services/routingDataDownloadService';

import type {
  Coordinate,
  RouteResult,
  TravelMode,
} from '../types/navigation';
import {
  isLocalValhallaRegistered,
  setLocalValhallaRegistered,
} from './localValhallaAvailability';
import { parseRouteResponse, RoutingError, setActiveRoutingEngine } from './routingService';
import type { RoutingEngine } from './routingEngine';

/**
 * The missing native dependency for true offline routing.
 *
 * A future Expo module (or a valhalla-mobile based native module) must register
 * an implementation that loads Valhalla tiles from `tilePath` and returns the
 * same JSON shape as a Valhalla `/route` HTTP response. The adapter deliberately
 * does not provide a JavaScript fallback and never calls the online API.
 */
export type NativeValhallaRouteRequest = {
  locations: { lat: number; lon: number }[];
  costing: TravelMode;
  units: 'kilometers';
  directions_options: { units: 'kilometers'; language: string };
};

export type NativeValhallaBridge = {
  initialize(options: {
    regionId: string;
    tilePath: string;
    configPath: string | null;
    dataVersion: string;
    engineVersion: string;
  }): Promise<void>;
  route(request: NativeValhallaRouteRequest): Promise<unknown>;
  isInitialized(): Promise<boolean>;
  dispose(): Promise<void>;
};

let nativeBridge: NativeValhallaBridge | null = null;

export function registerNativeValhallaBridge(bridge: NativeValhallaBridge | null): void {
  nativeBridge = bridge;
  setLocalValhallaRegistered(bridge !== null);
}

export function isLocalValhallaAvailable(): boolean {
  return isLocalValhallaRegistered();
}

export class LocalValhallaRoutingEngine implements RoutingEngine {
  private regionId: string | null = null;
  private initialized = false;

  async initialize(regionId: string): Promise<void> {
    const bridge = requireBridge();

    const inspection = await inspectInstalledRouting(regionId);

    if (!inspection.ok) {
      throw new RoutingError(
        'unavailable',
        `Offline routing data is not ready: ${inspection.reason}`,
      );
    }

    const configFile = new File(
      inspection.installedPath,
      'metadata',
      'valhalla.json',
    );

    try {
      await bridge.initialize({
        regionId,
        tilePath: new File(inspection.installedPath, 'valhalla-tiles').uri,
        configPath: configFile.exists ? configFile.uri : null,
        dataVersion: inspection.manifest.valhallaDataVersion,
        engineVersion: inspection.manifest.valhallaEngineVersion,
      });
    } catch (error) {
      throw new RoutingError(
        'unavailable',
        error instanceof Error
          ? error.message
          : 'The native Valhalla engine could not load the routing tiles.',
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
    if (!this.initialized || !this.regionId) {
      throw new RoutingError(
        'unavailable',
        'The local Valhalla engine is not initialized. Download and initialize an offline region first.',
      );
    }

    const bridge = requireBridge();

    let payload: unknown;

    try {
      payload = await bridge.route({
        locations: [
          { lat: params.origin.latitude, lon: params.origin.longitude },
          { lat: params.destination.latitude, lon: params.destination.longitude },
        ],
        costing: params.costing,
        units: 'kilometers',
        directions_options: { units: 'kilometers', language: 'en-US' },
      });
    } catch (error) {
      throw new RoutingError(
        'unavailable',
        error instanceof Error
          ? error.message
          : 'The local Valhalla engine failed to calculate a route.',
      );
    }

    return parseRouteResponse(payload, params.origin, params.destination);
  }

  async isReady(regionId: string): Promise<boolean> {
    if (!nativeBridge || !this.initialized || this.regionId !== regionId) {
      return false;
    }

    try {
      return await nativeBridge.isInitialized();
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    const bridge = nativeBridge;

    this.initialized = false;
    this.regionId = null;

    if (bridge) {
      await bridge.dispose().catch(() => undefined);
    }
  }
}

/**
 * Adapts the new interface to the navigation layer's existing `RoutingEngine`
 * contract so the existing navigation UI and tracking code do not change.
 */
class LocalValhallaNavigationEngine {
  private engine: LocalValhallaRoutingEngine;
  private initialization: Promise<void> | null = null;

  constructor(private readonly regionId: string) {
    this.engine = new LocalValhallaRoutingEngine();
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

let activeOfflineEngine: LocalValhallaNavigationEngine | null = null;
let activeOfflineRegionId: string | null = null;

/**
 * Switches the existing navigation feature to the local engine for a region.
 * Throws if no native bridge is registered, so callers can disable the action
 * instead of claiming offline routing works.
 */
export async function activateOfflineRouting(regionId: string): Promise<void> {
  if (!isLocalValhallaAvailable()) {
    throw new RoutingError(
      'unavailable',
      'The local Valhalla native module is not installed in this build. Offline routing cannot run yet.',
    );
  }

  await deactivateOfflineRouting();

  const engine = new LocalValhallaNavigationEngine(regionId);
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

function requireBridge(): NativeValhallaBridge {
  if (!nativeBridge) {
    throw new RoutingError(
      'unavailable',
      'The local Valhalla native module is not installed. Add a native Valhalla bridge and register it with registerNativeValhallaBridge().',
    );
  }

  return nativeBridge;
}
