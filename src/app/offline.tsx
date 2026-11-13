import { useLocalSearchParams } from 'expo-router';

import OfflineMapsScreen from '@/features/offline-maps/screens/OfflineMapsScreen';
import { validateBounds } from '@/features/offline-maps/services/regionService';
import type { OfflineBounds } from '@/features/offline-maps/types/offlineMap';

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
    <OfflineMapsScreen
      key={routeKey}
      initialBounds={initialBounds}
      initialName={initialBounds ? name || 'Map area' : ''}
    />
  );
}

function parseBounds(
  west: string,
  south: string,
  east: string,
  north: string,
): OfflineBounds | null {
  if ([west, south, east, north].some((value) => value.trim().length === 0)) {
    return null;
  }

  const values = [Number(west), Number(south), Number(east), Number(north)];

  if (!values.every((value) => Number.isFinite(value))) {
    return null;
  }

  try {
    return validateBounds(values as OfflineBounds);
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
