import type { RouteManeuver } from '../types/navigation';

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) {
    return '—';
  }
  if (meters < 1000) {
    return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return '—';
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} hr` : `${hours} hr ${remainder} min`;
}

export function maneuverLabel(maneuver: RouteManeuver | null): string {
  return maneuver?.instruction ?? 'Continue on the route';
}

/**
 * Valhalla maneuver type codes. The instruction text is authoritative; this is
 * only used for the compact type label shown above the instruction.
 */
export function maneuverTypeLabel(maneuver: RouteManeuver | null): string {
  if (!maneuver) {
    return 'Continue';
  }

  switch (maneuver.type) {
    case 1:
    case 2:
    case 3:
      return 'Depart';
    case 4:
    case 5:
    case 6:
      return 'Arrival';
    case 7:
      return 'Continue';
    case 8:
      return 'Continue';
    case 9:
    case 10:
    case 11:
      return 'Turn right';
    case 12:
      return 'U-turn';
    case 13:
      return 'U-turn';
    case 14:
    case 15:
    case 16:
      return 'Turn left';
    case 17:
    case 18:
    case 19:
      return 'Ramp';
    case 20:
    case 21:
      return 'Exit';
    case 22:
    case 23:
    case 24:
      return 'Keep';
    case 25:
    case 38:
    case 39:
      return 'Merge';
    case 26:
    case 27:
      return 'Roundabout';
    case 28:
    case 29:
      return 'Ferry';
    default:
      return 'Manoeuvre';
  }
}

export function formatCoordinate(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}
