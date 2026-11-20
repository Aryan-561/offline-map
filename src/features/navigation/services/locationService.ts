import * as Location from 'expo-location';

import type { Coordinate } from '../types/navigation';

export type LocationWatchOptions = {
  accuracy?: Location.Accuracy;
  distanceIntervalMeters?: number;
  timeIntervalMs?: number;
};

export async function requestForegroundLocation(): Promise<void> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    throw new Error(
      'Location permission was denied. Enable it in system settings to use navigation.',
    );
  }
}

export async function getCurrentLocation(
  accuracy: Location.Accuracy = Location.Accuracy.High,
): Promise<Coordinate> {
  const location = await Location.getCurrentPositionAsync({ accuracy });
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  };
}

/**
 * Foreground-only location updates. Background navigation is not implemented,
 * so no background permission is requested.
 */
export async function watchLocation(
  onLocation: (coordinate: Coordinate) => void,
  onError: (error: Error) => void,
  options: LocationWatchOptions = {},
): Promise<Location.LocationSubscription> {
  return Location.watchPositionAsync(
    {
      accuracy: options.accuracy ?? Location.Accuracy.High,
      distanceInterval: options.distanceIntervalMeters ?? 5,
      timeInterval: options.timeIntervalMs ?? 2000,
    },
    (location) =>
      onLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      }),
    (error) => onError(new Error(error)),
  );
}
