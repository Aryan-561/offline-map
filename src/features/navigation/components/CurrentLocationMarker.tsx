import { memo, useMemo } from 'react';

import { getMapLibre } from '@/features/offline-maps/services/maplibre';
import type { Coordinate } from '../types/navigation';

const { GeoJSONSource, Layer } = getMapLibre();

/**
 * Position marker driven by the navigation location service. It is used while
 * navigating so the camera and the marker share the same GPS stream.
 */
export const CurrentLocationMarker = memo(function CurrentLocationMarker({
  coordinate,
}: {
  coordinate: Coordinate;
}) {
  const data = useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'Point' as const,
        coordinates: [coordinate.longitude, coordinate.latitude] as [
          number,
          number,
        ],
      },
    }),
    [coordinate.latitude, coordinate.longitude],
  );

  return (
    <GeoJSONSource id="navigation-current-location" data={data}>
      <Layer
        id="navigation-current-location-accuracy"
        type="circle"
        source="navigation-current-location"
        paint={{
          'circle-color': '#1D72F3',
          'circle-opacity': 0.18,
          'circle-radius': 16,
        }}
      />
      <Layer
        id="navigation-current-location-point"
        type="circle"
        source="navigation-current-location"
        paint={{
          'circle-color': '#1D72F3',
          'circle-radius': 7,
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 3,
        }}
      />
    </GeoJSONSource>
  );
});
