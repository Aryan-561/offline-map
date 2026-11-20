import { useCallback, useEffect, useMemo, useState } from 'react';

import { defaultZoomRange } from '@/features/offline-maps/services/regionService';
import { getStyleCapabilities } from '@/features/offline-maps/services/styleService';
import {
  getCurrentLocation,
  requestForegroundLocation,
} from '@/features/navigation/services/locationService';

import {
  AVERAGE_VECTOR_TILE_BYTES,
  STYLE_RESOURCE_OVERHEAD_BYTES,
} from '../config';
import {
  boundsCenter,
  boundsForRadius,
  createRegionId,
  estimateMapSizeBytes,
  estimateMapTileCount,
  radiusKmForBounds,
  validateRegionBounds,
} from '../utils/calculateBounds';
import * as regionDownloadService from '../services/regionDownloadService';
import {
  toOfflineRegionsError,
  type OfflineRegionBounds,
  type OfflineRegionCoordinate,
} from '../types/offlineRegion.types';

export type RegionPreview = {
  center: OfflineRegionCoordinate;
  radiusKm: number;
  bounds: OfflineRegionBounds;
};

const DEFAULT_ZOOMS = { minZoom: 10, maxZoom: 14 };
const ESTIMATE_DEBOUNCE_MS = 700;

type EstimateState = {
  key: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  estimatedSizeBytes: number | null;
  coverageBounds: OfflineRegionBounds | null;
  buildOnDemand: boolean;
  error: string | null;
};

const EMPTY_ESTIMATE: EstimateState = {
  key: '',
  status: 'idle',
  estimatedSizeBytes: null,
  coverageBounds: null,
  buildOnDemand: false,
  error: null,
};

export type RegionDownloadSeed = {
  bounds?: OfflineRegionBounds | null;
  name?: string;
};

export function useRegionDownload(initial?: RegionDownloadSeed) {
  const [seedBounds] = useState<OfflineRegionBounds | null>(() => {
    if (!initial?.bounds) {
      return null;
    }

    try {
      return validateRegionBounds(initial.bounds);
    } catch {
      return null;
    }
  });
  const [center, setCenter] = useState<OfflineRegionCoordinate | null>(() =>
    seedBounds ? boundsCenter(seedBounds) : null,
  );
  const [name, setName] = useState(initial?.name ?? '');
  const [radiusKm, setRadiusKm] = useState(() =>
    seedBounds ? radiusKmForBounds(seedBounds) : 5,
  );
  const [boundsOverride, setBoundsOverride] =
    useState<OfflineRegionBounds | null>(seedBounds);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<{
    minZoom: number;
    maxZoom: number;
  }>(DEFAULT_ZOOMS);
  const [estimateState, setEstimateState] = useState<EstimateState>(EMPTY_ESTIMATE);
  const [estimateNonce, setEstimateNonce] = useState(0);
  const [starting, setStarting] = useState(false);
  const [draftRegionId, setDraftRegionId] = useState(() => createRegionId());

  const refreshRoutingEstimate = useCallback(() => {
    setEstimateNonce((current) => current + 1);
  }, []);

  const isRoutingConfigured = regionDownloadService.isRoutingServiceConfigured();

  const updateCenter = useCallback((next: OfflineRegionCoordinate | null) => {
    setCenter(next);
    setBoundsOverride(null);
    setDraftRegionId(createRegionId());
  }, []);

  const updateRadius = useCallback((next: number) => {
    setRadiusKm(next);
    setBoundsOverride(null);
    setDraftRegionId(createRegionId());
  }, []);

  const bounds = useMemo(() => {
    if (boundsOverride) {
      return boundsOverride;
    }

    if (!center) {
      return null;
    }

    try {
      return boundsForRadius(center, radiusKm);
    } catch {
      return null;
    }
  }, [boundsOverride, center, radiusKm]);

  useEffect(() => {
    let active = true;

    getStyleCapabilities()
      .then((result) => {
        if (!active) {
          return;
        }
        setCapabilities({
          minZoom: result.minZoom,
          maxZoom: result.maxZoom,
        });
        setStyleError(null);
      })
      .catch((cause) => {
        if (active) {
          setStyleError(toOfflineRegionsError(cause).message);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const zooms = useMemo(() => {
    const defaults = defaultZoomRange({
      styleUrl: '',
      hasGlyphs: false,
      hasSprite: false,
      warnings: [],
      ...capabilities,
    });

    return {
      minZoom: Math.max(capabilities.minZoom, defaults.minZoom),
      maxZoom: Math.min(capabilities.maxZoom, defaults.maxZoom),
    };
  }, [capabilities]);

  const estimatedTiles = useMemo(
    () =>
      bounds
        ? estimateMapTileCount(bounds, zooms.minZoom, zooms.maxZoom)
        : null,
    [bounds, zooms.maxZoom, zooms.minZoom],
  );

  const mapEstimateBytes = useMemo(
    () =>
      bounds
        ? estimateMapSizeBytes(
            bounds,
            zooms.minZoom,
            zooms.maxZoom,
            AVERAGE_VECTOR_TILE_BYTES,
            STYLE_RESOURCE_OVERHEAD_BYTES,
          )
        : null,
    [bounds, zooms.maxZoom, zooms.minZoom],
  );

  useEffect(() => {
    if (!center || !bounds || !isRoutingConfigured) {
      return;
    }

    let active = true;
    const key = draftRegionId;

    const timer = setTimeout(() => {
      setEstimateState((current) => ({
        ...current,
        key,
        status: 'loading',
        error: null,
      }));

      void regionDownloadService
        .estimateRoutingForRegion({
          regionId: draftRegionId,
          regionName: name,
          center,
          radiusKm,
          bounds,
        })
        .then((result) => {
          if (active) {
            setEstimateState({
              key,
              status: 'ready',
              estimatedSizeBytes: result.estimatedSizeBytes,
              coverageBounds: result.coverageBounds,
              buildOnDemand: result.buildOnDemand,
              error: null,
            });
          }
        })
        .catch((cause) => {
          if (active) {
            setEstimateState({
              key,
              status: 'error',
              estimatedSizeBytes: null,
              coverageBounds: null,
              buildOnDemand: false,
              error: toOfflineRegionsError(cause).message,
            });
          }
        });
    }, ESTIMATE_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    bounds,
    center,
    draftRegionId,
    estimateNonce,
    isRoutingConfigured,
    name,
    radiusKm,
  ]);

  const locate = useCallback(async (): Promise<OfflineRegionCoordinate | null> => {
    setError(null);
    setLoadingLocation(true);

    try {
      await requestForegroundLocation();
      const coordinate = await getCurrentLocation();
      updateCenter(coordinate);
      return coordinate;
    } catch (cause) {
      setError(toOfflineRegionsError(cause).message);
      return null;
    } finally {
      setLoadingLocation(false);
    }
  }, [updateCenter]);

  const start = useCallback(async () => {
    setError(null);

    if (!center || !bounds) {
      setError('Choose your current location first.');
      return null;
    }

    setStarting(true);

    try {
      const region = await regionDownloadService.startRegionDownload({
        id: draftRegionId,
        name,
        center,
        radiusKm,
        bounds,
        minZoom: zooms.minZoom,
        maxZoom: zooms.maxZoom,
      });

      setDraftRegionId(createRegionId());
      return region;
    } catch (cause) {
      setError(toOfflineRegionsError(cause).message);
      return null;
    } finally {
      setStarting(false);
    }
  }, [bounds, center, draftRegionId, name, radiusKm, zooms.maxZoom, zooms.minZoom]);

  const preview = useMemo<RegionPreview | null>(
    () => (center && bounds ? { center, radiusKm, bounds } : null),
    [bounds, center, radiusKm],
  );

  const estimateCurrent = estimateState.key === draftRegionId;
  const estimate =
    estimateCurrent && estimateState.status === 'ready'
      ? {
          estimatedSizeBytes: estimateState.estimatedSizeBytes,
          coverageBounds: estimateState.coverageBounds,
          buildOnDemand: estimateState.buildOnDemand,
        }
      : null;
  const estimatingRouting =
    Boolean(center && bounds && isRoutingConfigured) &&
    (!estimateCurrent || estimateState.status === 'loading');
  const routingEstimateError = !isRoutingConfigured
    ? 'Routing-data service is not configured. Set EXPO_PUBLIC_ROUTING_DATA_BASE_URL to enable routing downloads.'
    : estimateCurrent && estimateState.status === 'error'
      ? estimateState.error
      : null;
  const routingWillBuild =
    Boolean(estimate?.buildOnDemand) && estimate?.estimatedSizeBytes == null;

  const totalEstimateBytes =
    mapEstimateBytes === null && estimate?.estimatedSizeBytes == null
      ? null
      : (mapEstimateBytes ?? 0) + (estimate?.estimatedSizeBytes ?? 0);

  return {
    center,
    name,
    setName,
    radiusKm,
    setRadiusKm: updateRadius,
    bounds,
    preview,
    zooms,
    estimatedTiles,
    mapEstimateBytes,
    routingEstimateBytes: estimate?.estimatedSizeBytes ?? null,
    routingCoverageBounds: estimate?.coverageBounds ?? null,
    routingWillBuild,
    totalEstimateBytes,
    estimatingRouting,
    routingEstimateError,
    styleError,
    loadingLocation,
    starting,
    error,
    clearError: () => setError(null),
    refreshRoutingEstimate,
    locate,
    start,
    draftRegionId,
  };
}
