import { Platform, TurboModuleRegistry } from 'react-native';

import { OfflineMapsError } from '../types/offlineMap';

type MapLibreModule = typeof import('@maplibre/maplibre-react-native');

let loadedModule: MapLibreModule | null = null;

/**
 * MapLibre is a native module. In Expo Go the package cannot be imported at all
 * because its turbo modules are resolved eagerly, so every call site must check
 * availability before loading it.
 */
export function isMapLibreAvailable(): boolean {
  if (Platform.OS === 'web') {
    return false;
  }

  try {
    return (
      TurboModuleRegistry.get('MLRNCameraModule') != null &&
      TurboModuleRegistry.get('MLRNOfflineModule') != null
    );
  } catch {
    return false;
  }
}

export function getMapLibre(): MapLibreModule {
  if (!isMapLibreAvailable()) {
    throw new OfflineMapsError(
      'unsupported',
      'Offline maps require a development build with MapLibre installed.',
    );
  }

  if (!loadedModule) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loadedModule = require('@maplibre/maplibre-react-native') as MapLibreModule;
  }

  return loadedModule;
}
