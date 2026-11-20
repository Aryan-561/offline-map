import { MapUnavailable } from '@/components/map-unavailable';
import type { Coordinate, RouteGeometry } from '@/features/navigation/types/navigation';

type MapViewProps = {
  focus?: unknown;
  destination?: Coordinate | null;
  route?: RouteGeometry | null;
  currentLocation?: Coordinate | null;
  locationSource?: 'auto' | 'external';
  showControls?: boolean;
  contentBottomInset?: number;
  onMapPress?: (coordinate: Coordinate) => void;
  followLocation?: boolean;
};

export default function MapView(_props: MapViewProps) {
  return (
    <MapUnavailable
      title="Map unavailable on web"
      message="MapLibre React Native renders natively on iOS and Android. Open the app in a development build to view the map centered on your location."
    />
  );
}
