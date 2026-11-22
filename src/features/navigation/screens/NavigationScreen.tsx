import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import MapView from '@/components/map-view';
import { Spacing } from '@/constants/theme';
import {
  getRegions,
  initialize as initializeOfflineRegions,
} from '@/features/offline-regions/services/regionDownloadService';
import { regionContainsCoordinate } from '@/features/offline-regions/utils/navigationReadiness';
import { useTheme } from '@/hooks/use-theme';
import { DestinationSearch } from '../components/DestinationSearch';
import { ManeuverInstruction } from '../components/ManeuverInstruction';
import { NavigationControls } from '../components/NavigationControls';
import { NavigationHeader } from '../components/NavigationHeader';
import { RouteInfoCard } from '../components/RouteInfoCard';
import { useNavigation } from '../hooks/useNavigation';
import {
  activateOfflineRouting,
  deactivateOfflineRouting,
  getActiveOfflineRegionId,
  isOfflineRoutingActivated,
} from '../services/brouterAdapter';


export function NavigationScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const params = useLocalSearchParams<{
    destLat?: string;
    destLng?: string;
    destName?: string;
  }>();
  const navigation = useNavigation();
  const { clearDestination, selectDestination } = navigation;
  const [destinationLabel, setDestinationLabel] = useState<string | null>(null);
  const handledParamKey = useRef<string | null>(null);
  const latitude = navigation.coordinate?.latitude ?? null;
  const longitude = navigation.coordinate?.longitude ?? null;
  const destinationLatitude = navigation.destination?.latitude ?? null;
  const destinationLongitude = navigation.destination?.longitude ?? null;

  const handleSelectDestination = useCallback(
    (coordinate: { latitude: number; longitude: number }) => {
      handledParamKey.current = null;
      setDestinationLabel(null);
      selectDestination(coordinate);
    },
    [selectDestination],
  );

  const handleClearDestination = useCallback(() => {
    handledParamKey.current = null;
    setDestinationLabel(null);
    clearDestination();
  }, [clearDestination]);

  useEffect(() => {
    const latitudeValue = paramValue(params.destLat);
    const longitudeValue = paramValue(params.destLng);

    if (latitudeValue.length === 0 || longitudeValue.length === 0) {
      return;
    }

    const nextLatitude = Number(latitudeValue);
    const nextLongitude = Number(longitudeValue);

    if (
      !Number.isFinite(nextLatitude) ||
      !Number.isFinite(nextLongitude) ||
      nextLatitude < -90 ||
      nextLatitude > 90 ||
      nextLongitude < -180 ||
      nextLongitude > 180
    ) {
      return;
    }

    const key = `${nextLatitude.toFixed(6)},${nextLongitude.toFixed(6)}`;
    if (handledParamKey.current === key) {
      return;
    }

    handledParamKey.current = key;
    setDestinationLabel(paramValue(params.destName) || null);
    selectDestination({
      latitude: nextLatitude,
      longitude: nextLongitude,
    });
  }, [params.destLat, params.destLng, params.destName, selectDestination]);

  useEffect(() => {
    if (latitude === null || longitude === null) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await initializeOfflineRegions();
        if (cancelled) {
          return;
        }

        const origin = { latitude, longitude };
        const destination =
          destinationLatitude !== null && destinationLongitude !== null
            ? { latitude: destinationLatitude, longitude: destinationLongitude }
            : null;
        const region = getRegions().find(
          (candidate) =>
            candidate.isNavigationReady &&
            regionContainsCoordinate(candidate, origin) &&
            (!destination || regionContainsCoordinate(candidate, destination)),
        );

        if (!region) {
          if (isOfflineRoutingActivated()) {
            await deactivateOfflineRouting();
          }
          return;
        }

        if (getActiveOfflineRegionId() === region.id) {
          return;
        }

        await activateOfflineRouting(region.id);
      } catch {
        // Fall back to the online engine rather than blocking every route when
        // an offline region cannot be activated.
        if (isOfflineRoutingActivated()) {
          await deactivateOfflineRouting();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [destinationLatitude, destinationLongitude, latitude, longitude]);

  const error = navigation.locationError ?? navigation.routeError;
  const bottomInset = insets.bottom + Spacing.three;

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.background }]}>
      <NavigationHeader />

      <View style={styles.mapContainer}>
        <MapView
          currentLocation={navigation.coordinate}
          locationSource="external"
          showControls={false}
          contentBottomInset={0}
          destination={navigation.destination}
          route={navigation.route?.geometry}
          onMapPress={
            navigation.isNavigating ? undefined : handleSelectDestination
          }
          followLocation={navigation.isNavigating}
        />

        {!navigation.isNavigating && (
          <View style={[styles.destinationOverlay, { top: Spacing.two }]}>
            <DestinationSearch
              key={
                navigation.destination
                  ? `${navigation.destination.latitude},${navigation.destination.longitude}`
                  : 'no-destination'
              }
              destination={navigation.destination}
              near={navigation.coordinate}
              onSelect={handleSelectDestination}
              onClear={handleClearDestination}
            />
          </View>
        )}

        {navigation.isNavigating && (
          <View style={[styles.destinationOverlay, { top: Spacing.two }]}>
            <ManeuverInstruction progress={navigation.progress} />
          </View>
        )}

        {navigation.destination && !navigation.isNavigating && (
          <View style={[styles.bottomOverlay, { bottom: bottomInset }]}>
            <RouteInfoCard
              destination={navigation.destination}
              destinationLabel={destinationLabel}
              route={navigation.route}
              mode={navigation.mode}
              isCalculating={navigation.isCalculating}
              onModeChange={navigation.changeMode}
              onCalculate={navigation.retryRoute}
              onStart={navigation.startNavigation}
              onCancel={handleClearDestination}
            />
          </View>
        )}

        {navigation.isNavigating && (
          <View style={[styles.bottomOverlay, styles.controlsOverlay, { bottom: bottomInset }]}>
            <NavigationControls
              onStop={navigation.stopNavigation}
              onEnd={handleClearDestination}
            />
          </View>
        )}

        {(navigation.isRerouting || error) && (
          <View
            style={[
              styles.statusBanner,
              {
                backgroundColor: theme.background,
                bottom: bottomInset + 76,
              },
            ]}>
            {navigation.isRerouting ? (
              <>
                <ActivityIndicator color={theme.text} size="small" />
                <Text style={[styles.statusText, { color: theme.text }]}>
                  Recalculating route…
                </Text>
              </>
            ) : (
              <Text style={[styles.statusText, { color: theme.text }]}>{error}</Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function paramValue(value: string | string[] | undefined): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0];
  }
  return '';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapContainer: {
    flex: 1,
  },
  destinationOverlay: {
    left: Spacing.three,
    position: 'absolute',
    right: Spacing.three,
  },
  bottomOverlay: {
    left: Spacing.three,
    position: 'absolute',
    right: Spacing.three,
  },
  controlsOverlay: {
    alignItems: 'flex-end',
  },
  statusBanner: {
    alignItems: 'center',
    borderRadius: Spacing.two,
    elevation: 4,
    flexDirection: 'row',
    gap: Spacing.two,
    left: Spacing.three,
    padding: Spacing.two,
    position: 'absolute',
    right: Spacing.three,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  statusText: {
    flex: 1,
    fontSize: 13,
  },
});
