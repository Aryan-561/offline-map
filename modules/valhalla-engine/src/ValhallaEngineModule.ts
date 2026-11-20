import { NativeModule, requireOptionalNativeModule } from 'expo';

export type ValhallaInitializeOptions = {
  regionId: string;
  tilePath: string;
  configPath: string | null;
  dataVersion: string;
  engineVersion: string;
};

export type ValhallaEngineNativeModule = NativeModule & {
  initialize(options: ValhallaInitializeOptions): Promise<void>;
  route(request: Record<string, unknown>): Promise<string>;
  isInitialized(): Promise<boolean>;
  dispose(): Promise<void>;
};

/**
 * Null in Expo Go, on web, and on platforms without the native module.
 * Callers must treat a null module as “offline routing unavailable”.
 */
const ValhallaEngine =
  requireOptionalNativeModule<ValhallaEngineNativeModule>('ValhallaEngine');

export default ValhallaEngine;
