import type { ComponentType } from 'react';
import { Platform, TurboModuleRegistry } from 'react-native';

import { MapUnavailable } from '@/components/map-unavailable';

import type { MapFocus } from './map-view-native';

type MapViewProps = {
  focus?: MapFocus | null;
};

// MapLibre is a native module that is only present in a development build.
// Loading it eagerly would crash the whole app (and every route) in Expo Go.
function loadNativeMap(): ComponentType<MapViewProps> | null {
  if (Platform.OS === 'web') {
    return null;
  }

  try {
    if (TurboModuleRegistry.get('MLRNCameraModule') == null) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./map-view-native').default as ComponentType<MapViewProps>;
  } catch {
    return null;
  }
}

const NativeMapView = loadNativeMap();

export default function MapView({ focus = null }: MapViewProps) {
  if (!NativeMapView) {
    return (
      <MapUnavailable
        title="Development build required"
        message={
          'MapLibre is not available in Expo Go. Build the app with "npx expo run:android" or "npx expo run:ios", or with "eas build --profile development", then reopen it.'
        }
      />
    );
  }

  return <NativeMapView focus={focus} />;
}
