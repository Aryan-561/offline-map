import { useCallback, useEffect, useState } from 'react';

import { isBrouterAvailable } from '@/features/navigation/services/brouterAdapter';
import { subscribeBrouterAvailability } from '@/features/navigation/services/brouterAvailability';

import * as regionDownloadService from '../services/regionDownloadService';
import {
  toOfflineRegionsError,
  type OfflineRegion,
  type OfflineRegionStorageInfo,
  type OfflineRegionVerification,
} from '../types/offlineRegion.types';

export function useOfflineRegions() {
  const [regions, setRegions] = useState<OfflineRegion[]>(() =>
    regionDownloadService.getRegions(),
  );
  const [storage, setStorage] = useState<OfflineRegionStorageInfo>(() =>
    regionDownloadService.getStorageInfo(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSupported] = useState(() => regionDownloadService.isMapDownloadSupported());
  const [isRoutingConfigured] = useState(() =>
    regionDownloadService.isRoutingServiceConfigured(),
  );
  const [isLocalEngineAvailable, setIsLocalEngineAvailable] = useState(() =>
    isBrouterAvailable(),
  );

  useEffect(() => {
    return subscribeBrouterAvailability(() => {
      setIsLocalEngineAvailable(isBrouterAvailable());
      regionDownloadService.refreshNavigationReadiness();
      setRegions(regionDownloadService.getRegions());
    });
  }, []);

  useEffect(() => {
    let active = true;

    const sync = () => {
      if (!active) {
        return;
      }
      setRegions(regionDownloadService.getRegions());
      setStorage(regionDownloadService.getStorageInfo());
    };

    const unsubscribe = regionDownloadService.subscribe(sync);

    regionDownloadService
      .initialize()
      .then(sync)
      .catch((cause) => {
        if (active) {
          setError(toOfflineRegionsError(cause).message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | null> => {
      setError(null);
      try {
        const result = await action();
        setRegions(regionDownloadService.getRegions());
        setStorage(regionDownloadService.getStorageInfo());
        return result;
      } catch (cause) {
        setError(toOfflineRegionsError(cause).message);
        return null;
      }
    },
    [],
  );

  const pause = useCallback(
    (id: string) => run(() => regionDownloadService.pauseRegion(id)),
    [run],
  );

  const resume = useCallback(
    (id: string) => run(() => regionDownloadService.resumeRegion(id)),
    [run],
  );

  const retry = useCallback(
    (id: string) => run(() => regionDownloadService.retryRegion(id)),
    [run],
  );

  const cancel = useCallback(
    (id: string) => run(() => regionDownloadService.cancelRegion(id)),
    [run],
  );

  const remove = useCallback(
    (id: string) => run(() => regionDownloadService.removeRegion(id)),
    [run],
  );

  const verify = useCallback(
    (id: string): Promise<OfflineRegionVerification | null> =>
      run(() => regionDownloadService.verifyRegion(id)),
    [run],
  );

  const refresh = useCallback(async () => {
    await run(async () => {
      await regionDownloadService.refresh();
      return true;
    });
  }, [run]);

  const clearError = useCallback(() => setError(null), []);

  return {
    regions,
    storage,
    loading,
    error,
    isSupported,
    isRoutingConfigured,
    isLocalEngineAvailable,
    pause,
    resume,
    retry,
    cancel,
    remove,
    verify,
    refresh,
    clearError,
  };
}
