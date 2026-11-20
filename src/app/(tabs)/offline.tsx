import { useLocalSearchParams } from 'expo-router';

import OfflineRegionsScreen from '@/features/offline-regions/screens/OfflineRegionsScreen';
import type { OfflineRegionBounds } from '@/features/offline-regions/types/offlineRegion.types';
import { validateRegionBounds } from '@/features/offline-regions/utils/calculateBounds';

export default function OfflineRoute() {
  const params = useLocalSearchParams();

  const west = paramString(params.west);
  const south = paramString(params.south);
  const east = paramString(params.east);
  const north = paramString(params.north);
  const name = paramString(params.name);

  const initialBounds = parseBounds(west, south, east, north);
  const routeKey = [west, south, east, north, name].join('|');

  return (
    <OfflineRegionsScreen
      key={routeKey}
      initialBounds={initialBounds}
      initialName={name || 'Map area'}
    />
  );
}

function parseBounds(
  west: string,
  south: string,
  east: string,
  north: string,
): OfflineRegionBounds | null {
  if ([west, south, east, north].some((value) => value.trim().length === 0)) {
    return null;
  }

  const values = [Number(west), Number(south), Number(east), Number(north)];

  if (!values.every((value) => Number.isFinite(value))) {
    return null;
  }

  try {
    return validateRegionBounds({
      west: values[0],
      south: values[1],
      east: values[2],
      north: values[3],
    });
  } catch {
    return null;
  }
}

function paramString(value: string | string[] | undefined): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0];
  }
  return '';
}
