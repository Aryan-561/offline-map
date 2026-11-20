import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import MapView from '@/components/map-view';
import type { MapFocus } from '@/components/map-view-native';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { NearbyPlaceSearch } from '@/features/navigation/components/NearbyPlaceSearch';
import { useCurrentLocation } from '@/features/navigation/hooks/useCurrentLocation';
import type { PlaceResult } from '@/features/navigation/types/navigation';
import { formatDistance } from '@/features/navigation/utils/maneuverUtils';
import { useTheme } from '@/hooks/use-theme';

export default function HomeScreen() {
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { coordinate } = useCurrentLocation(true);
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);

  const paramFocus = useMemo<MapFocus | null>(() => {
    const latitudeValue = paramValue(params.centerLat);
    const longitudeValue = paramValue(params.centerLng);
    const zoomValue = paramValue(params.zoom);
    const latitude = Number(latitudeValue);
    const longitude = Number(longitudeValue);
    const zoom = Number(zoomValue);

    if (
      latitudeValue.length === 0 ||
      longitudeValue.length === 0 ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return null;
    }

    return {
      center: [longitude, latitude] as [number, number],
      zoom: zoomValue.length > 0 && Number.isFinite(zoom) ? zoom : undefined,
    };
  }, [params.centerLat, params.centerLng, params.zoom]);

  const focus = useMemo<MapFocus | null>(() => {
    if (!selectedPlace) {
      return paramFocus;
    }

    return {
      center: [
        selectedPlace.coordinate.longitude,
        selectedPlace.coordinate.latitude,
      ],
      zoom: 16,
    };
  }, [paramFocus, selectedPlace]);

  const openNavigation = () => {
    if (!selectedPlace) {
      return;
    }

    router.push({
      pathname: '/navigate',
      params: {
        destLat: String(selectedPlace.coordinate.latitude),
        destLng: String(selectedPlace.coordinate.longitude),
        destName: selectedPlace.label,
      },
    });
  };

  return (
    <View style={styles.container}>
      <MapView
        focus={focus}
        currentLocation={coordinate}
        locationSource={coordinate ? 'external' : 'auto'}
        destination={selectedPlace?.coordinate ?? null}
        showControls={!selectedPlace}
      />

      <View style={[styles.searchOverlay, { top: insets.top + Spacing.two }]}>
        <NearbyPlaceSearch
          near={coordinate}
          onSelect={setSelectedPlace}
          placeholder="Search nearby places by name"
        />
      </View>

      {selectedPlace && (
        <View
          style={[
            styles.placeCard,
            {
              backgroundColor: theme.background,
              bottom: insets.bottom + BottomTabInset + Spacing.three,
            },
          ]}>
          <View style={styles.placeText}>
            <Text
              numberOfLines={1}
              style={[styles.placeTitle, { color: theme.text }]}>
              {selectedPlace.label}
            </Text>
            <Text
              numberOfLines={2}
              style={[styles.placeSubtitle, { color: theme.textSecondary }]}>
              {selectedPlace.description ?? 'Selected place'}
              {selectedPlace.distanceMeters != null
                ? ` · ${formatDistance(selectedPlace.distanceMeters)} away`
                : ''}
            </Text>
          </View>

          <View style={styles.placeActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show navigation to this place"
              onPress={openNavigation}
              style={({ pressed }) => [
                styles.navigateButton,
                { opacity: pressed ? 0.8 : 1 },
              ]}>
              <Text style={styles.navigateText}>Navigate</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear selected place"
              onPress={() => setSelectedPlace(null)}
              style={styles.clearButton}>
              <Text style={[styles.clearText, { color: theme.textSecondary }]}>
                Clear
              </Text>
            </Pressable>
          </View>
        </View>
      )}
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
  searchOverlay: {
    left: Spacing.three,
    position: 'absolute',
    right: Spacing.three,
  },
  placeCard: {
    borderRadius: Spacing.three,
    elevation: 6,
    gap: Spacing.two,
    left: Spacing.three,
    padding: Spacing.three,
    position: 'absolute',
    right: Spacing.three,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
  },
  placeText: {
    gap: 2,
  },
  placeTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  placeSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  placeActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
  },
  navigateButton: {
    alignItems: 'center',
    backgroundColor: '#1D72F3',
    borderRadius: Spacing.two,
    flex: 1,
    paddingVertical: Spacing.two,
  },
  navigateText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  clearButton: {
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  clearText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
