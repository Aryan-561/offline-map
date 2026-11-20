export type TravelMode = 'auto' | 'pedestrian';

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type RoutePoint = [longitude: number, latitude: number];

export type RouteGeometry = {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'LineString';
    coordinates: RoutePoint[];
  };
};

export type RouteManeuver = {
  id: number;
  instruction: string;
  verbalInstruction: string;
  type: number;
  distanceMeters: number;
  durationSeconds: number;
  beginShapeIndex: number | null;
  endShapeIndex: number | null;
  coordinate: Coordinate;
  streetNames: string[];
};

export type RouteSummary = {
  from: string;
  to: string;
};

export type RouteResult = {
  geometry: RouteGeometry;
  distanceMeters: number;
  durationSeconds: number;
  maneuvers: RouteManeuver[];
  summary: RouteSummary;
};

export type NavigationProgress = {
  distanceToRouteMeters: number;
  distanceAlongRouteMeters: number;
  distanceToNextManeuverMeters: number | null;
  remainingDistanceMeters: number;
  remainingDurationSeconds: number;
  nextManeuver: RouteManeuver | null;
  currentStreetName: string | null;
  isOffRoute: boolean;
};

export type NavigationTuning = {
  /** Distance from the route line that starts counting as a deviation. */
  offRouteThresholdMeters: number;
  /** Consecutive off-route fixes required before considering a reroute. */
  offRouteConfirmationSamples: number;
  /** Time the user must remain off-route before considering a reroute. */
  offRouteConfirmationMs: number;
  /** Minimum time between two reroute requests. */
  rerouteCooldownMs: number;
  /** Manoeuvres this close behind the current position are treated as current. */
  maneuverAheadToleranceMeters: number;
};

export type PlaceResult = {
  id: string;
  label: string;
  description?: string;
  coordinate: Coordinate;
  /** Great-circle distance from the search origin, when one was supplied. */
  distanceMeters?: number;
};
