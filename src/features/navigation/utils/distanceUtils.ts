import type { Coordinate } from '../types/navigation';

const EARTH_RADIUS_METERS = 6_371_000;

/** Great-circle distance between two coordinates, in metres. */
export function distanceBetween(first: Coordinate, second: Coordinate): number {
  const latitudeDelta = ((second.latitude - first.latitude) * Math.PI) / 180;
  const longitudeDelta = ((second.longitude - first.longitude) * Math.PI) / 180;
  const latitude = (first.latitude * Math.PI) / 180;
  const secondLatitude = (second.latitude * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.sin(longitudeDelta / 2) ** 2 * Math.cos(latitude) * Math.cos(secondLatitude);
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Converts a longitude/latitude point to local metres around a latitude. */
export function toLocalMeters(
  point: [number, number],
  latitude: number,
): [number, number] {
  const scale = (Math.PI / 180) * EARTH_RADIUS_METERS;
  return [
    point[0] * scale * Math.cos((latitude * Math.PI) / 180),
    point[1] * scale,
  ];
}
