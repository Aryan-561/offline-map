import { useCallback, useEffect, useState } from 'react';

import * as downloadService from '../services/downloadService';
import { getStyleCapabilities } from '../services/styleService';
import {
  toOfflineMapsError,
  type CreateOfflineRegionInput,
  type OfflineRegion,
  type OfflineVerificationResult,
  type StorageInfo,
  type StyleCapabilities,
} from '../types/offlineMap';

export function useOfflineMaps() {
  const [regions, setRegions] = useState<OfflineRegion[]>(() => downloadService.getRegions());
  const [storage, setStorage] = useState<StorageInfo>(() => downloadService.getStorageInfo());
  const [capabilities, setCapabilities] = useState<StyleCapabilities | null>(null);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSupported] = useState(() => downloadService.isSupported());

  useEffect(() => {
    let active = true;

    const sync = () => {
      if (!active) {
        return;
      }
      setRegions(downloadService.getRegions());
      setStorage(downloadService.getStorageInfo());
    };

    const unsubscribe = downloadService.subscribe(sync);

    downloadService
      .initialize()
      .then(sync)
      .catch((cause) => {
        if (active) {
          setError(toOfflineMapsError(cause).message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    getStyleCapabilities()
      .then((result) => {
        if (active) {
          setCapabilities(result);
          setStyleError(null);
        }
      })
      .catch((cause) => {
        if (active) {
          setStyleError(toOfflineMapsError(cause).message);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | null> => {
    setError(null);
    try {
      const result = await action();
      setRegions(downloadService.getRegions());
      setStorage(downloadService.getStorageInfo());
      return result;
    } catch (cause) {
      setError(toOfflineMapsError(cause).message);
      return null;
    }
  }, []);

  const startDownload = useCallback(
    (input: CreateOfflineRegionInput) => run(() => downloadService.startDownload(input)),
    [run],
  );

  const pause = useCallback(
    (id: string) => run(() => downloadService.pauseRegion(id)),
    [run],
  );

  const resume = useCallback(
    (id: string) => run(() => downloadService.resumeRegion(id)),
    [run],
  );

  const retry = useCallback(
    (id: string) => run(() => downloadService.retryRegion(id)),
    [run],
  );

  const remove = useCallback(
    (id: string) => run(() => downloadService.removeRegion(id)),
    [run],
  );

  const verify = useCallback(
    (id: string): Promise<OfflineVerificationResult | null> =>
      run(() => downloadService.verifyRegion(id)),
    [run],
  );

  const refresh = useCallback(async () => {
    await run(async () => {
      await downloadService.refresh();
      const nextCapabilities = await getStyleCapabilities({ force: true });
      setCapabilities(nextCapabilities);
      setStyleError(null);
    });
  }, [run]);

  const clearError = useCallback(() => setError(null), []);

  return {
    regions,
    storage,
    capabilities,
    styleError,
    loading,
    error,
    isSupported,
    startDownload,
    pause,
    resume,
    retry,
    remove,
    verify,
    refresh,
    clearError,
  };
}
