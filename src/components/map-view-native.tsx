import type {
  CameraRef,
  MapRef,
  PressEvent,
} from '@maplibre/maplibre-react-native';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DEFAULT_ZOOM, MAP_STYLE_URL } from '@/constants/map';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { CurrentLocationMarker } from '@/features/navigation/components/CurrentLocationMarker';
import {
  getCurrentLocation,
  requestForegroundLocation,
} from '@/features/navigation/services/locationService';
import type {
  Coordinate,
  RouteGeometry,
} from '@/features/navigation/types/navigation';
import { getMapLibre } from '@/features/offline-maps/services/maplibre';
import { useTheme } from '@/hooks/use-theme';

const { Camera, GeoJSONSource, Layer, Map, UserLocation } = getMapLibre();

type LocationState = 'loading' | 'ready' | 'denied' | 'unavailable';

export type MapFocus = {
  center: [longitude: number, latitude: number];
  zoom?: number;
};

export type MapViewRegionPreview = {
  center: Coordinate;
  radiusKm: number;
};

type MapViewNativeProps = {
  focus?: MapFocus | null;
  destination?: Coordinate | null;
  route?: RouteGeometry | null;
  currentLocation?: Coordinate | null;
  locationSource?: 'auto' | 'external';
  showControls?: boolean;
  contentBottomInset?: number;
  onMapPress?: (coordinate: Coordinate) => void;
  followLocation?: boolean;
  regionPreview?: MapViewRegionPreview | null;
};

export default function MapView({
  focus = null,
  destination = null,
  route = null,
  currentLocation = null,
  locationSource = 'auto',
  showControls = true,
  contentBottomInset = BottomTabInset,
  onMapPress,
  followLocation = false,
  regionPreview = null,
}: MapViewNativeProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const [coords, setCoords] = useState<Coordinate | null>(null);
  const [locationState, setLocationState] = useState<LocationState>('loading');
  const [mapReady, setMapReady] = useState(false);

  const usesExternalLocation =
    locationSource === 'external' || currentLocation != null;

  useEffect(() => {
    if (usesExternalLocation) {
      return;
    }

    let cancelled = false;

    async function locate() {
      try {
        await requestForegroundLocation();
        const location = await getCurrentLocation();
        if (cancelled) {
          return;
        }

        setCoords(location);
        setLocationState('ready');
      } catch {
        if (!cancelled) {
          setLocationState('denied');
        }
      }
    }

    void locate();

    return () => {
      cancelled = true;
    };
  }, [usesExternalLocation]);

  const locationCenter = useMemo<[number, number] | null>(() => {
    const source = currentLocation ?? coords;
    return source ? [source.longitude, source.latitude] : null;
  }, [coords, currentLocation]);

  const mapCenter = focus?.center ?? locationCenter;
  const mapZoom = focus?.zoom ?? DEFAULT_ZOOM;
  const cameraKey = focus ? `${focus.center.join(',')}:${mapZoom}` : 'location';
  const effectiveLocationState: LocationState = usesExternalLocation
    ? 'ready'
    : locationState;

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

  useEffect(() => {
    if (!route || route.geometry.coordinates.length < 2 || !mapReady || followLocation) {
      return;
    }

    const coordinates = route.geometry.coordinates;
    const longitudes = coordinates.map(([longitude]) => longitude);
    const latitudes = coordinates.map(([, latitude]) => latitude);
    cameraRef.current?.fitBounds(
      [
        Math.min(...longitudes),
        Math.min(...latitudes),
        Math.max(...longitudes),
        Math.max(...latitudes),
      ],
      { padding: { top: 140, right: 48, bottom: 300, left: 48 }, duration: 700 },
    );
  }, [followLocation, mapReady, route]);

  useEffect(() => {
    if (followLocation && locationCenter) {
      cameraRef.current?.easeTo({
        center: locationCenter,
        zoom: 16.5,
        duration: 600,
      });
    }
  }, [followLocation, locationCenter]);

  const routeData = useMemo(() => route ?? null, [route]);

  const regionPreviewData = useMemo(
    () => (regionPreview ? circleFeature(regionPreview.center, regionPreview.radiusKm) : null),
    [regionPreview],
  );

  const destinationData = useMemo(
    () =>
      destination
        ? {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'Point' as const,
              coordinates: [destination.longitude, destination.latitude] as [
                number,
                number,
              ],
            },
          }
        : null,
    [destination],
  );

  const originData = useMemo(
    () =>
      locationCenter
        ? {
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'Point' as const, coordinates: locationCenter },
          }
        : null,
    [locationCenter],
  );

  return (
    <View style={styles.container}>
      <Map
        ref={mapRef}
        style={styles.map}
        mapStyle={MAP_STYLE_URL}
        contentInset={{ bottom: insets.bottom + contentBottomInset }}
        onDidFinishLoadingMap={() => setMapReady(true)}
        onPress={(event) => {
          if (!onMapPress) {
            return;
          }
          const { lngLat } = event.nativeEvent as PressEvent;
          onMapPress({ longitude: lngLat[0], latitude: lngLat[1] });
        }}
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
            {currentLocation ? (
              <CurrentLocationMarker coordinate={currentLocation} />
            ) : (
              <UserLocation accuracy heading />
            )}
            {routeData && (
              <GeoJSONSource id="navigation-route" data={routeData}>
                <Layer
                  id="navigation-route-casing"
                  type="line"
                  source="navigation-route"
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{
                    'line-color': '#FFFFFF',
                    'line-opacity': 0.9,
                    'line-width': 10,
                  }}
                />
                <Layer
                  id="navigation-route-line"
                  type="line"
                  source="navigation-route"
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{ 'line-color': '#1D72F3', 'line-width': 6 }}
                />
              </GeoJSONSource>
            )}
            {regionPreviewData && (
              <GeoJSONSource id="offline-region-preview" data={regionPreviewData}>
                <Layer
                  id="offline-region-preview-fill"
                  type="fill"
                  source="offline-region-preview"
                  paint={{
                    'fill-color': '#1D72F3',
                    'fill-opacity': 0.12,
                  }}
                />
                <Layer
                  id="offline-region-preview-line"
                  type="line"
                  source="offline-region-preview"
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{
                    'line-color': '#1D72F3',
                    'line-width': 2,
                    'line-dasharray': [2, 1],
                  }}
                />
              </GeoJSONSource>
            )}
            {originData && (
              <GeoJSONSource id="navigation-origin" data={originData}>
                <Layer
                  id="navigation-origin-point"
                  type="circle"
                  source="navigation-origin"
                  paint={{
                    'circle-color': '#1D72F3',
                    'circle-radius': 7,
                    'circle-stroke-color': '#FFFFFF',
                    'circle-stroke-width': 3,
                  }}
                />
              </GeoJSONSource>
            )}
            {destinationData && (
              <GeoJSONSource id="navigation-destination" data={destinationData}>
                <Layer
                  id="navigation-destination-point"
                  type="circle"
                  source="navigation-destination"
                  paint={{
                    'circle-color': '#D93025',
                    'circle-radius': 8,
                    'circle-stroke-color': '#FFFFFF',
                    'circle-stroke-width': 3,
                  }}
                />
              </GeoJSONSource>
            )}
          </>
        )}
      </Map>

      {!focus && effectiveLocationState !== 'ready' && (
        <View style={[styles.statusOverlay, { backgroundColor: theme.background }]}>
          {effectiveLocationState === 'loading' ? (
            <ActivityIndicator color={theme.text} />
          ) : (
            <Text style={[styles.statusText, { color: theme.text }]}>
              {effectiveLocationState === 'denied'
                ? 'Location permission is needed to center the map on you. Enable it in Settings and reopen the app.'
                : 'Unable to determine your location.'}
            </Text>
          )}
        </View>
      )}

      {showControls && mapReady && mapCenter && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Download the current map area for offline use"
          onPress={() => void handleDownloadArea()}
          style={({ pressed }) => [
            styles.downloadButton,
            {
              backgroundColor: theme.background,
              bottom: insets.bottom + contentBottomInset + Spacing.three,
              opacity: pressed ? 0.7 : 1,
            },
          ]}>
          <Text style={[styles.locateText, { color: theme.text }]}>Download area</Text>
        </Pressable>
      )}

      {showControls && locationCenter && !followLocation && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open navigation"
            onPress={() => router.push({ pathname: '/navigate' } as never)}
            style={({ pressed }) => [
              styles.navigationButton,
              {
                backgroundColor: theme.background,
                bottom:
                  insets.bottom + contentBottomInset + Spacing.three + 48,
                opacity: pressed ? 0.7 : 1,
              },
            ]}>
            <Text style={[styles.locateText, { color: theme.text }]}>Navigate</Text>
          </Pressable>
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
                bottom: insets.bottom + contentBottomInset + Spacing.three,
                opacity: pressed ? 0.7 : 1,
              },
            ]}>
            <Text style={[styles.locateText, { color: theme.text }]}>Locate</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function circleFeature(
  center: Coordinate,
  radiusKm: number,
): {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
} {
  const points = 72;
  const latitudeDelta = radiusKm / 110.574;
  const longitudeScale = Math.cos((center.latitude * Math.PI) / 180);
  const longitudeDelta =
    Math.abs(longitudeScale) < 1e-6
      ? 180
      : radiusKm / (111.32 * Math.abs(longitudeScale));
  const ring: [number, number][] = [];

  for (let index = 0; index <= points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    ring.push([
      center.longitude + Math.cos(angle) * longitudeDelta,
      center.latitude + Math.sin(angle) * latitudeDelta,
    ]);
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
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
  navigationButton: {
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
