import { NativeModule, requireOptionalNativeModule } from 'expo';

export type BrouterInitializeOptions = {
  segmentDir: string;
};

export type BrouterRouteRequest = {
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  profile: string;
  timeoutMs?: number;
};

export type BrouterEngineNativeModule = NativeModule & {
  initialize(options: BrouterInitializeOptions): Promise<void>;
  route(request: BrouterRouteRequest): Promise<string>;
  isInitialized(): Promise<boolean>;
  dispose(): Promise<void>;
};

/**
 * Null in Expo Go, on web, and on iOS. Callers must treat a null module as
 * “offline routing unavailable”.
 */
const BrouterEngine =
  requireOptionalNativeModule<BrouterEngineNativeModule>('BrouterEngine');

export default BrouterEngine;
