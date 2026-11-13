import type { CameraRef, MapRef } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DEFAULT_ZOOM, MAP_STYLE_URL } from '@/constants/map';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { getMapLibre } from '@/features/offline-maps/services/maplibre';
import { useTheme } from '@/hooks/use-theme';

const { Camera, Map, UserLocation } = getMapLibre();

type Coords = {
  latitude: number;
  longitude: number;
};

type LocationState = 'loading' | 'ready' | 'denied' | 'unavailable';

export type MapFocus = {
  center: [longitude: number, latitude: number];
  zoom?: number;
};

type MapViewNativeProps = {
  focus?: MapFocus | null;
};

export default function MapView({ focus = null }: MapViewNativeProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locationState, setLocationState] = useState<LocationState>('loading');
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function locate() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) {
          return;
        }
        if (status !== 'granted') {
          setLocationState('denied');
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) {
          return;
        }

        setCoords({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
        setLocationState('ready');
      } catch {
        if (!cancelled) {
          setLocationState('unavailable');
        }
      }
    }

    locate();

    return () => {
      cancelled = true;
    };
  }, []);

  const locationCenter: [number, number] | null = coords
    ? [coords.longitude, coords.latitude]
    : null;
  const mapCenter = focus?.center ?? locationCenter;
  const mapZoom = focus?.zoom ?? DEFAULT_ZOOM;
  const cameraKey = focus ? `${focus.center.join(',')}:${mapZoom}` : 'location';

  const handleDownloadArea = async () => {
    const bounds = await mapRef.current?.getBounds();

    if (!bounds) {
      return;
    }

    router.push({
      pathname: '/offline',
      params: {
        west: String(bounds[0]),
        south: String(bounds[1]),
        east: String(bounds[2]),
        north: String(bounds[3]),
        name: 'Map area',
      },
    });
  };

  return (
    <View style={styles.container}>
      <Map
        ref={mapRef}
        style={styles.map}
        mapStyle={MAP_STYLE_URL}
        contentInset={{ bottom: insets.bottom + BottomTabInset }}
        onDidFinishLoadingMap={() => setMapReady(true)}
        logo={false}>
        {mapCenter && (
          <>
            <Camera
              key={cameraKey}
              ref={cameraRef}
              initialViewState={{ center: mapCenter, zoom: mapZoom }}
              minZoom={2}
              maxZoom={19}
            />
            <UserLocation accuracy heading />
          </>
        )}
      </Map>

      {!focus && locationState !== 'ready' && (
        <View style={[styles.statusOverlay, { backgroundColor: theme.background }]}>
          {locationState === 'loading' ? (
            <ActivityIndicator color={theme.text} />
          ) : (
            <Text style={[styles.statusText, { color: theme.text }]}>
              {locationState === 'denied'
                ? 'Location permission is needed to center the map on you. Enable it in Settings and reopen the app.'
                : 'Unable to determine your location.'}
            </Text>
          )}
        </View>
      )}

      {mapReady && mapCenter && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Download the current map area for offline use"
          onPress={() => void handleDownloadArea()}
          style={({ pressed }) => [
            styles.downloadButton,
            {
              backgroundColor: theme.background,
              bottom: insets.bottom + BottomTabInset + Spacing.three,
              opacity: pressed ? 0.7 : 1,
            },
          ]}>
          <Text style={[styles.locateText, { color: theme.text }]}>Download area</Text>
        </Pressable>
      )}

      {locationCenter && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Center map on my location"
          onPress={() =>
            cameraRef.current?.flyTo({
              center: locationCenter,
              zoom: DEFAULT_ZOOM,
              duration: 600,
            })
          }
          style={({ pressed }) => [
            styles.locateButton,
            {
              backgroundColor: theme.background,
              bottom: insets.bottom + BottomTabInset + Spacing.three,
              opacity: pressed ? 0.7 : 1,
            },
          ]}>
          <Text style={[styles.locateText, { color: theme.text }]}>Locate</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  statusOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  statusText: {
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
  },
  locateButton: {
    position: 'absolute',
    right: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  downloadButton: {
    position: 'absolute',
    left: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  locateText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
