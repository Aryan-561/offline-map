import type {
  Coordinate,
  RouteResult,
  TravelMode,
} from '../types/navigation';

/**
 * Platform-independent routing abstraction used by the offline-regions
 * feature. A native Valhalla bridge is injected at build time; the adapter
 * fails loudly when the native module is absent instead of falling back to the
 * network.
 */
export interface RoutingEngine {
  initialize(regionId: string): Promise<void>;

  calculateRoute(params: {
    origin: Coordinate;
    destination: Coordinate;
    costing: TravelMode;
  }): Promise<RouteResult>;

  isReady(regionId: string): Promise<boolean>;

  dispose(): Promise<void>;
}
