import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import MapView from '@/components/map-view';

export default function HomeScreen() {
  const params = useLocalSearchParams();

  const focus = useMemo(() => {
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

  return (
    <View style={styles.container}>
      <MapView focus={focus} />
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
});
