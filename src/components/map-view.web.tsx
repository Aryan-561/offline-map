import { MapUnavailable } from '@/components/map-unavailable';

type MapViewProps = {
  focus?: unknown;
};

export default function MapView(_props: MapViewProps) {
  return (
    <MapUnavailable
      title="Map unavailable on web"
      message="MapLibre React Native renders natively on iOS and Android. Open the app in a development build to view the map centered on your location."
    />
  );
}
