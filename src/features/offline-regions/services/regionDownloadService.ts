import { Paths } from 'expo-file-system';
import { AppState, Platform } from 'react-native';

import { getStyleCapabilities } from '@/features/offline-maps/services/styleService';
import { defaultZoomRange } from '@/features/offline-maps/services/regionService';
import { isLocalValhallaRegistered } from '@/features/navigation/services/localValhallaAvailability';

import { MIN_FREE_STORAGE_MARGIN_BYTES, ROUTING_BUFFER_KM } from '../config';
import * as repository from '../repositories/offlineRegionRepository';
import {
  fromLngLatBounds,
  OfflineRegionsError,
  toLngLatBounds,
  toOfflineRegionsError,
  type CombinedProgress,
  type CreateOfflineRegionRequest,
  type DatasetStatus,
  type OfflineRegion,
  type OfflineRegionStorageInfo,
  type OfflineRegionVerification,
} from '../types/offlineRegion.types';
import type { RoutingPackageManifest } from '../types/routingPackage.types';
import {
  boundsCenter,
  boundsForRadius,
  createRegionId,
  radiusKmForBounds,
  validateRadius,
  validateRegionBounds,
} from '../utils/calculateBounds';
import { isRegionNavigationReady } from '../utils/navigationReadiness';
import { combineDownloadProgress } from '../utils/progress';
import * as mapService from './mapDownloadService';
import {
  buildRoutingPackageRequest,
  estimateRoutingPackage,
  isRoutingPackageServiceConfigured,
  resolveRoutingManifest,
} from './routingPackageService';
import {
  cancelRoutingDownload,
  deleteRoutingData,
  downloadRoutingPackage,
  inspectInstalledRouting,
  pauseRoutingDownload,
  readStagingManifest,
  verifyInstalledRoutingData,
  type RoutingDownloadOutcome,
} from './routingDataDownloadService';

const PERSIST_DEBOUNCE_MS = 750;

type Listener = () => void;

let regions: OfflineRegion[] = [];
let initialization: Promise<void> | null = null;
let mapUnsubscribe: (() => void) | null = null;
let appStateSubscription: { remove: () => void } | null = null;

const listeners = new Set<Listener>();
const startingRegions = new Set<string>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const routingManifests = new Map<string, RoutingPackageManifest>();
const routingAttempts = new Map<string, number>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRegions(): OfflineRegion[] {
  return regions;
}

export function getRegion(id: string): OfflineRegion | null {
  return regions.find((region) => region.id === id) ?? null;
}

export function isMapDownloadSupported(): boolean {
  return mapService.isMapDownloadSupported();
}

export function isRoutingServiceConfigured(): boolean {
  return isRoutingPackageServiceConfigured();
}

export function getStorageInfo(): OfflineRegionStorageInfo {
  const mapStorage = mapService.getMapStorageInfo();
  const routingDownloaded = regions.reduce(
    (total, region) =>
      total +
      (region.routingStatus === 'completed' ? region.routingSizeBytes : 0),
    0,
  );

  return {
    availableBytes: mapStorage.availableBytes,
    totalBytes: mapStorage.totalBytes,
    downloadedBytes: mapStorage.downloadedBytes + routingDownloaded,
  };
}

export function initialize(): Promise<void> {
  if (initialization) {
    return initialization;
  }

  initialization = (async () => {
    await repository.initializeDatabase();
    regions = await repository.listRegions();

    try {
      await mapService.initializeMapDownloads();
    } catch {
      // The existing map service may be unavailable (Expo Go). Routing data can
      // still be inspected and shown.
    }

    if (!mapUnsubscribe) {
      mapUnsubscribe = mapService.subscribeToMapDownloads(() => {
        void syncMapRegions();
      });
    }

    subscribeToAppState();
    await recoverInterruptedRouting();
    await syncMapRegions();
    await importMapOnlyRegions();
    refreshNavigationReadiness();
    emit();
  })().catch((error) => {
    initialization = null;
    throw error;
  });

  return initialization;
}

export async function refresh(): Promise<void> {
  await initialize();
  await mapService.refreshMapDownloads().catch(() => undefined);
  await recoverInterruptedRouting();
  await syncMapRegions();
}

export async function startRegionDownload(
  request: CreateOfflineRegionRequest,
): Promise<OfflineRegion> {
  await initialize();

  if (!mapService.isMapDownloadSupported()) {
    throw new OfflineRegionsError(
      'unsupported',
      'Offline maps require a development build with MapLibre installed.',
    );
  }

  const id = request.id ?? createRegionId();
  validateRadius(request.radiusKm);
  const name = normalizeName(request.name, request.center);
  const bounds = request.bounds
    ? validateRegionBounds(request.bounds)
    : boundsForRadius(request.center, request.radiusKm);

  const existing = getRegion(id);

  if (existing) {
    throw new OfflineRegionsError(
      'duplicate',
      'A region with this ID already exists. Use retry or choose the area again.',
    );
  }

  const zoomRange = await resolveZoomRange(request);
  const timestamp = new Date().toISOString();

  let record: OfflineRegion = {
    id,
    name,
    center: request.center,
    radiusKm: request.radiusKm,
    bounds,
    mapRegionId: null,
    mapPackId: null,
    mapStatus: 'pending',
    mapProgress: 0,
    mapDownloadedBytes: 0,
    mapTotalBytes: null,
    mapSizeBytes: 0,
    mapError: null,
    routingStatus: 'pending',
    routingProgress: 0,
    routingDownloadedBytes: 0,
    routingTotalBytes: null,
    routingSizeBytes: 0,
    routingError: null,
    routingCoverageBounds: null,
    routingDataVersion: null,
    routingEngineVersion: null,
    routingPackageFormat: null,
    routingChecksumVerified: false,
    routingInstalledPath: null,
    routingManifestPath: null,
    routingManifestUrl: null,
    isNavigationReady: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await repository.insertRegion(record);
  replaceRegion(record, { persist: 'immediate' });
  startingRegions.add(id);

  record = await patchRegion(id, {
    mapStatus: 'downloading',
    routingStatus: 'downloading',
    mapError: null,
    routingError: null,
  });

  // Both transfers are independent and start immediately. Each part handles
  // its own failures so one dataset succeeding never hides the other failing.
  const mapTask = startMapPart(id, bounds, zoomRange);
  const routingTask = startRoutingPart(id);

  void Promise.allSettled([mapTask, routingTask]).finally(() => {
    startingRegions.delete(id);
  });

  return record;
}

export async function pauseRegion(id: string): Promise<OfflineRegion> {
  await initialize();
  const region = requireRegion(id);
  invalidateRoutingAttempt(id);
  const tasks: Promise<unknown>[] = [];

  if (region.mapStatus === 'downloading' && region.mapRegionId) {
    tasks.push(
      mapService.pauseMapDownload(region.mapRegionId).catch((error) => {
        throw toOfflineRegionsError(error);
      }),
    );
  }

  if (region.routingStatus === 'downloading' || region.routingStatus === 'pending') {
    tasks.push(pauseRoutingDownload(region.id));
  }

  const results = await Promise.allSettled(tasks);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );

  const updated = await patchRegion(id, {
    mapStatus:
      region.mapStatus === 'downloading' || region.mapStatus === 'pending'
        ? 'paused'
        : region.mapStatus,
    routingStatus:
      region.routingStatus === 'downloading' || region.routingStatus === 'pending'
        ? 'paused'
        : region.routingStatus,
  });

  if (failure) {
    throw toOfflineRegionsError(failure.reason);
  }

  return updated;
}

export async function resumeRegion(id: string): Promise<OfflineRegion> {
  await initialize();
  const region = requireRegion(id);

  if (region.mapStatus === 'completed' && region.routingStatus === 'completed') {
    return region;
  }

  if (region.mapStatus === 'paused') {
    if (region.mapRegionId) {
      await mapService.resumeMapDownload(region.mapRegionId).catch(async (error) => {
        const code =
          error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        if (code.includes('not found') || code.includes('no longer')) {
          await startMapPart(id, region.bounds, await resolveExistingZoomRange(region));
        } else {
          throw toOfflineRegionsError(error);
        }
      });
    } else {
      await startMapPart(id, region.bounds, await resolveExistingZoomRange(region));
    }
  }

  if (region.routingStatus === 'paused') {
    void restartRouting(id);
  }

  return requireRegion(id);
}

export async function retryRegion(id: string): Promise<OfflineRegion> {
  await initialize();
  const region = requireRegion(id);

  if (region.mapStatus === 'failed') {
    if (region.mapRegionId) {
      await mapService.retryMapDownload(region.mapRegionId).catch(async (error) => {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (message.includes('not found') || message.includes('no longer')) {
          await startMapPart(id, region.bounds, await resolveExistingZoomRange(region));
        } else {
          throw toOfflineRegionsError(error);
        }
      });
    } else {
      await startMapPart(id, region.bounds, await resolveExistingZoomRange(region));
    }
  }

  if (region.routingStatus === 'failed' || region.routingStatus === 'paused') {
    void restartRouting(id);
  }

  return requireRegion(id);
}

export async function cancelRegion(id: string): Promise<OfflineRegion> {
  await initialize();
  const region = requireRegion(id);

  invalidateRoutingAttempt(id);
  await cancelRoutingDownload(id);

  if (
    region.mapRegionId &&
    (region.mapStatus === 'downloading' ||
      region.mapStatus === 'pending' ||
      region.mapStatus === 'paused')
  ) {
    await mapService.pauseMapDownload(region.mapRegionId).catch(() => undefined);
  }

  return patchRegion(id, {
    mapStatus:
      region.mapStatus === 'downloading' || region.mapStatus === 'pending'
        ? 'paused'
        : region.mapStatus,
    routingStatus: 'failed',
    routingError: 'The routing download was cancelled. Retry to download it again.',
    isNavigationReady: false,
  });
}

export async function removeRegion(id: string): Promise<void> {
  await initialize();
  const region = requireRegion(id);

  invalidateRoutingAttempt(id);
  await cancelRoutingDownload(id).catch(() => undefined);
  await deleteRoutingData(id).catch(() => undefined);
  routingManifests.delete(id);

  if (region.mapRegionId) {
    await mapService.removeMapDownload(region.mapRegionId).catch(() => undefined);
  }

  await repository.deleteRegion(id);
  cancelPersist(id);
  regions = regions.filter((item) => item.id !== id);
  emit();
}

export async function verifyRegion(id: string): Promise<OfflineRegionVerification> {
  await initialize();
  const region = requireRegion(id);
  let mapOk = region.mapStatus === 'completed';
  let routingOk = false;
  const messages: string[] = [];

  if (region.mapRegionId) {
    try {
      const result = await mapService.verifyMapDownload(region.mapRegionId);
      mapOk = result.ok;
      messages.push(result.ok ? 'Map data verified.' : result.message);
    } catch (error) {
      mapOk = false;
      messages.push(toOfflineRegionsError(error).message);
    }
  } else {
    messages.push('Map data has not been downloaded.');
  }

  const routing = await verifyInstalledRoutingData(id);
  routingOk = routing.ok;
  messages.push(routing.message);

  const checksumVerified = routing.ok;
  const updated = await patchRegion(id, {
    mapStatus: mapOk ? 'completed' : 'failed',
    routingStatus: routingOk ? 'completed' : 'failed',
    routingChecksumVerified: checksumVerified,
    routingError: routingOk ? null : routing.message,
  });

  return {
    ok: mapOk && routingOk,
    mapOk,
    routingOk,
    message: messages.join(' '),
    region: updated,
  };
}

export function getCombinedProgress(region: OfflineRegion): CombinedProgress {
  return combineDownloadProgress(
    {
      status: region.mapStatus,
      progress: region.mapProgress,
      downloadedBytes: region.mapDownloadedBytes,
      totalBytes: region.mapTotalBytes,
    },
    {
      status: region.routingStatus,
      progress: region.routingProgress,
      downloadedBytes: region.routingDownloadedBytes,
      totalBytes: region.routingTotalBytes,
    },
  );
}

async function startMapPart(
  id: string,
  bounds: OfflineRegion['bounds'],
  zoom: { minZoom: number; maxZoom: number },
): Promise<void> {
  const region = getRegion(id);

  if (!region) {
    return;
  }

  try {
    const mapRegion = await mapService.startMapDownload({
      id,
      name: region.name,
      bounds: toLngLatBounds(bounds),
      minZoom: zoom.minZoom,
      maxZoom: zoom.maxZoom,
    });

    await patchRegion(id, {
      mapRegionId: mapRegion.id,
      mapPackId: mapRegion.packId,
      mapStatus: mapService.toDatasetStatus(mapRegion.status),
      mapError: null,
    });
  } catch (error) {
    const offlineError = toOfflineRegionsError(error);
    await patchRegion(id, {
      mapStatus: 'failed',
      mapError: offlineError.message,
    });
  }
}

async function restartRouting(id: string): Promise<void> {
  const region = getRegion(id);

  if (
    !region ||
    region.routingStatus === 'downloading' ||
    region.routingStatus === 'pending'
  ) {
    return;
  }

  // Mark the attempt pending synchronously so double-tapping Resume/Retry
  // cannot start two routing attempts for the same region.
  patchRegion(id, {
    routingStatus: 'pending',
    routingError: null,
    isNavigationReady: false,
  });

  await startRoutingPart(id);
}

async function startRoutingPart(id: string): Promise<void> {
  const region = getRegion(id);

  if (!region) {
    return;
  }

  const attempt = beginRoutingAttempt(id);

  try {
    if (!isRoutingPackageServiceConfigured()) {
      throw new OfflineRegionsError(
        'routing_configuration',
        'Routing data is not configured. Set EXPO_PUBLIC_ROUTING_DATA_BASE_URL to a routing-data service, then retry.',
      );
    }

    const packageRequest = buildRoutingPackageRequest({
      regionId: region.id,
      regionName: region.name,
      center: region.center,
      radiusKm: region.radiusKm,
      bounds: region.bounds,
    });

    // Resume from a verified staging manifest without requiring the backend to
    // still be reachable. Full validation still happens before installation.
    let manifest = routingManifests.get(id) ?? (await readStagingManifest(id));
    let manifestUrl = region.routingManifestUrl;

    if (!isRoutingAttemptCurrent(id, attempt)) {
      return;
    }

    if (!manifest) {
      const resolution = await resolveRoutingManifest(packageRequest, {
        waitForReady: true,
      });

      if (!isRoutingAttemptCurrent(id, attempt)) {
        return;
      }

      if (resolution.status !== 'ready') {
        await patchRegion(id, {
          routingStatus: 'downloading',
          routingError:
            'The routing-data service is still building this package. Keep the app open and retry shortly.',
        });
        return;
      }

      manifest = resolution.manifest;
      manifestUrl = resolution.manifestUrl;
    }

    routingManifests.set(id, manifest);

    if (!isRoutingAttemptCurrent(id, attempt)) {
      return;
    }

    patchRegion(id, {
      routingStatus: 'downloading',
      routingProgress: region.routingProgress,
      routingDownloadedBytes: region.routingDownloadedBytes,
      routingTotalBytes: manifest.downloadSizeBytes,
      routingCoverageBounds: manifest.coverageBounds,
      routingDataVersion: manifest.valhallaDataVersion,
      routingEngineVersion: manifest.valhallaEngineVersion,
      routingPackageFormat: manifest.packageFormat,
      routingManifestUrl: manifestUrl,
      routingError: null,
    });

    const outcome = await downloadRoutingPackage({
      regionId: id,
      manifest,
      callbacks: {
        onProgress: (progress) => {
          if (!isRoutingAttemptCurrent(id, attempt)) {
            return;
          }

          patchRegion(id, {
            routingStatus: 'downloading',
            routingProgress: progress.progress,
            routingDownloadedBytes: progress.downloadedBytes,
            routingTotalBytes: progress.totalBytes,
          });
        },
      },
    });

    if (!isRoutingAttemptCurrent(id, attempt)) {
      return;
    }

    await applyRoutingOutcome(id, outcome);
  } catch (error) {
    if (!isRoutingAttemptCurrent(id, attempt)) {
      return;
    }

    const offlineError = toOfflineRegionsError(error);

    if (offlineError.code === 'cancelled') {
      await patchRegion(id, {
        routingStatus: 'failed',
        routingError: 'The routing download was cancelled. Retry to download it again.',
        isNavigationReady: false,
      });
      return;
    }

    await patchRegion(id, {
      routingStatus: 'failed',
      routingError: offlineError.message,
      isNavigationReady: false,
    });
  }
}

async function applyRoutingOutcome(
  id: string,
  outcome: RoutingDownloadOutcome,
): Promise<void> {
  if (outcome.status === 'paused') {
    patchRegion(id, {
      routingStatus: 'paused',
      routingProgress: outcome.totalBytes
        ? (outcome.downloadedBytes / outcome.totalBytes) * 100
        : 0,
      routingDownloadedBytes: outcome.downloadedBytes,
      routingTotalBytes: outcome.totalBytes,
      routingError: 'Routing download paused. Resume to continue from verified files.',
    });
    return;
  }

  await patchRegion(id, {
    routingStatus: 'completed',
    routingProgress: 100,
    routingDownloadedBytes: outcome.sizeBytes,
    routingTotalBytes: outcome.manifest.downloadSizeBytes,
    routingSizeBytes: outcome.sizeBytes,
    routingChecksumVerified: true,
    routingCoverageBounds: outcome.manifest.coverageBounds,
    routingDataVersion: outcome.manifest.valhallaDataVersion,
    routingEngineVersion: outcome.manifest.valhallaEngineVersion,
    routingPackageFormat: outcome.manifest.packageFormat,
    routingInstalledPath: outcome.installedPath,
    routingManifestPath: `${outcome.installedPath}/manifest.json`,
    routingError: null,
  });
}

async function syncMapRegions(): Promise<void> {
  if (regions.length === 0) {
    return;
  }

  const updates: OfflineRegion[] = [];

  for (const region of regions) {
    const mapRegion = mapService.getMapRegion(
      region.mapRegionId ?? region.id,
    );
    const inFlight = startingRegions.has(region.id);

    if (!mapRegion) {
      if (
        !inFlight &&
        region.mapRegionId !== null &&
        region.mapStatus !== 'failed' &&
        region.mapStatus !== 'pending'
      ) {
        updates.push({
          ...region,
          mapPackId: null,
          mapStatus: 'failed',
          mapError:
            'MapLibre no longer has this pack on the device. Retry to download the map data again.',
          isNavigationReady: false,
          updatedAt: new Date().toISOString(),
        });
      }
      continue;
    }

    const mapStatus = mapService.toDatasetStatus(mapRegion.status);
    const mapTotalBytes = mapService.estimateMapTotalBytes(mapRegion);
    const mapDownloadedBytes = mapService.mapDownloadedBytes(mapRegion);

    if (
      region.mapRegionId === mapRegion.id &&
      region.mapPackId === mapRegion.packId &&
      region.mapStatus === mapStatus &&
      Math.abs(region.mapProgress - mapRegion.progress) < 0.1 &&
      region.mapDownloadedBytes === mapDownloadedBytes &&
      region.mapSizeBytes === mapRegion.sizeBytes &&
      region.mapError === mapRegion.error &&
      region.mapTotalBytes === mapTotalBytes
    ) {
      continue;
    }

    updates.push({
      ...region,
      mapRegionId: mapRegion.id,
      mapPackId: mapRegion.packId,
      mapStatus,
      mapProgress: mapRegion.progress,
      mapDownloadedBytes,
      mapTotalBytes,
      mapSizeBytes: mapRegion.sizeBytes,
      mapError: mapRegion.error,
      isNavigationReady: deriveNavigationReady({
        ...region,
        mapStatus,
      }),
      updatedAt: new Date().toISOString(),
    });
  }

  if (updates.length === 0) {
    return;
  }

  for (const updated of updates) {
    replaceRegion(updated);
    schedulePersist(updated.id, PERSIST_DEBOUNCE_MS);
  }
}

/**
 * The map screen historically downloaded MapLibre packs without routing data.
 * Import those completed packs once so they can be made navigation-ready
 * without downloading the map again.
 */
async function importMapOnlyRegions(): Promise<void> {
  const knownIds = new Set(regions.map((region) => region.id));
  const importedIds: string[] = [];

  for (const mapRegion of mapService.listMapRegions()) {
    if (knownIds.has(mapRegion.id) || mapRegion.status !== 'completed') {
      continue;
    }

    const bounds = fromLngLatBounds(mapRegion.bounds);
    const center = boundsCenter(bounds);
    const radiusKm = radiusKmForBounds(bounds);
    const timestamp = new Date().toISOString();
    const record: OfflineRegion = {
      id: mapRegion.id,
      name: mapRegion.name,
      center,
      radiusKm,
      bounds,
      mapRegionId: mapRegion.id,
      mapPackId: mapRegion.packId,
      mapStatus: 'completed',
      mapProgress: 100,
      mapDownloadedBytes: mapRegion.sizeBytes,
      mapTotalBytes: mapService.estimateMapTotalBytes(mapRegion),
      mapSizeBytes: mapRegion.sizeBytes,
      mapError: null,
      routingStatus: 'paused',
      routingProgress: 0,
      routingDownloadedBytes: 0,
      routingTotalBytes: null,
      routingSizeBytes: 0,
      routingError:
        'Map data is ready. Resume to download routing data for offline navigation.',
      routingCoverageBounds: null,
      routingDataVersion: null,
      routingEngineVersion: null,
      routingPackageFormat: null,
      routingChecksumVerified: false,
      routingInstalledPath: null,
      routingManifestPath: null,
      routingManifestUrl: null,
      isNavigationReady: false,
      createdAt: mapRegion.createdAt,
      updatedAt: timestamp,
    };

    await repository.insertRegion(record);
    replaceRegion(record);
    importedIds.push(record.id);
  }

  for (const id of importedIds) {
    void downloadRoutingForImportedRegion(id);
  }
}

async function downloadRoutingForImportedRegion(id: string): Promise<void> {
  const region = getRegion(id);

  if (
    !region ||
    region.routingStatus !== 'paused' ||
    !isRoutingPackageServiceConfigured()
  ) {
    return;
  }

  try {
    const resolution = await resolveRoutingManifest(
      buildRoutingPackageRequest({
        regionId: region.id,
        regionName: region.name,
        center: region.center,
        radiusKm: region.radiusKm,
        bounds: region.bounds,
      }),
      { waitForReady: false },
    );

    if (
      resolution.status !== 'ready' ||
      getRegion(id)?.routingStatus !== 'paused'
    ) {
      return;
    }

    await restartRouting(id);
  } catch {
    // Keep the imported region paused so the user can retry manually.
  }
}

async function recoverInterruptedRouting(): Promise<void> {
  const recovered: OfflineRegion[] = [];

  for (const region of regions) {
    if (region.routingStatus === 'completed') {
      const inspection = await inspectInstalledRouting(region.id);

      if (inspection.ok) {
        const restored: OfflineRegion = {
          ...region,
          routingInstalledPath: inspection.installedPath,
          routingSizeBytes: inspection.sizeBytes,
          routingChecksumVerified: true,
          routingError: null,
          updatedAt: new Date().toISOString(),
        };

        recovered.push({
          ...restored,
          isNavigationReady: deriveNavigationReady(restored),
        });
      } else {
        recovered.push({
          ...region,
          routingStatus: 'failed',
          routingChecksumVerified: false,
          routingError: inspection.reason,
          isNavigationReady: false,
          updatedAt: new Date().toISOString(),
        });
      }
      continue;
    }

    if (region.routingStatus === 'downloading' || region.routingStatus === 'pending') {
      const staging = await readStagingManifest(region.id);
      recovered.push({
        ...region,
        routingStatus: 'paused',
        routingTotalBytes: staging
          ? staging.downloadSizeBytes
          : region.routingTotalBytes,
        routingCoverageBounds: staging?.coverageBounds ?? region.routingCoverageBounds,
        routingError:
          'The routing download was interrupted when the app closed. Resume to continue.',
        isNavigationReady: false,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  if (recovered.length === 0) {
    return;
  }

  for (const region of recovered) {
    replaceRegion(region);
    await repository.updateRegion(region);
  }
}

async function resolveExistingZoomRange(
  region: OfflineRegion,
): Promise<{ minZoom: number; maxZoom: number }> {
  const mapRegion = mapService.getMapRegion(
    region.mapRegionId ?? region.id,
  );

  if (mapRegion) {
    return { minZoom: mapRegion.minZoom, maxZoom: mapRegion.maxZoom };
  }

  return resolveZoomRange({});
}

function resolveZoomRange(input: {
  minZoom?: number;
  maxZoom?: number;
}): Promise<{ minZoom: number; maxZoom: number }> {
  if (
    Number.isInteger(input.minZoom) &&
    Number.isInteger(input.maxZoom) &&
    (input.minZoom ?? 0) <= (input.maxZoom ?? 0)
  ) {
    return Promise.resolve({
      minZoom: input.minZoom as number,
      maxZoom: input.maxZoom as number,
    });
  }

  return getStyleCapabilities()
    .then((capabilities) => defaultZoomRange(capabilities))
    .catch((error) => {
      throw new OfflineRegionsError(
        'style_resources',
        toOfflineRegionsError(error).message,
        { cause: error },
      );
    });
}

function patchRegion(
  id: string,
  patch: Partial<Omit<OfflineRegion, 'id'>>,
): OfflineRegion {
  const current = requireRegion(id);
  const updated: OfflineRegion = {
    ...current,
    ...patch,
    isNavigationReady:
      patch.isNavigationReady ??
      deriveNavigationReady({ ...current, ...patch }),
    updatedAt: new Date().toISOString(),
  };

  replaceRegion(updated);
  schedulePersist(id, PERSIST_DEBOUNCE_MS);
  return updated;
}

function deriveNavigationReady(region: OfflineRegion): boolean {
  return isRegionNavigationReady(region, isLocalValhallaRegistered());
}

/**
 * Re-evaluates readiness after the native bridge registers, without hashing
 * tiles. This only changes the derived flag; installed data is untouched.
 */
export function refreshNavigationReadiness(): void {
  let changed = false;

  for (const region of regions) {
    const next = deriveNavigationReady(region);

    if (next === region.isNavigationReady) {
      continue;
    }

    changed = true;
    replaceRegion({
      ...region,
      isNavigationReady: next,
      updatedAt: new Date().toISOString(),
    });
    schedulePersist(region.id, PERSIST_DEBOUNCE_MS);
  }

  if (changed) {
    emit();
  }
}

function replaceRegion(
  region: OfflineRegion,
  options: { persist: 'none' | 'immediate' } = { persist: 'none' },
): void {
  let found = false;

  regions = regions.map((item) => {
    if (item.id === region.id) {
      found = true;
      return region;
    }
    return item;
  });

  if (!found) {
    regions = [...regions, region];
  }

  regions = sortRegions(regions);
  emit();

  if (options.persist === 'immediate') {
    void repository.updateRegion(region).catch(() => undefined);
  }
}

function schedulePersist(id: string, delay: number): void {
  const existing = persistTimers.get(id);

  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    persistTimers.delete(id);
    const region = getRegion(id);
    if (region) {
      void repository.updateRegion(region).catch(() => undefined);
    }
  }, delay);

  persistTimers.set(id, timer);
}

function cancelPersist(id: string): void {
  const timer = persistTimers.get(id);

  if (timer) {
    clearTimeout(timer);
    persistTimers.delete(id);
  }
}

function subscribeToAppState(): void {
  if (appStateSubscription) {
    return;
  }

  appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      return;
    }

    for (const [id, timer] of persistTimers) {
      clearTimeout(timer);
      persistTimers.delete(id);
      const region = getRegion(id);
      if (region) {
        void repository.updateRegion(region).catch(() => undefined);
      }
    }
  });
}

function beginRoutingAttempt(id: string): number {
  const attempt = (routingAttempts.get(id) ?? 0) + 1;
  routingAttempts.set(id, attempt);
  return attempt;
}

function invalidateRoutingAttempt(id: string): void {
  routingAttempts.set(id, (routingAttempts.get(id) ?? 0) + 1);
}

function isRoutingAttemptCurrent(id: string, attempt: number): boolean {
  return routingAttempts.get(id) === attempt;
}

function requireRegion(id: string): OfflineRegion {
  const region = getRegion(id);

  if (!region) {
    throw new OfflineRegionsError('not_found', 'This offline region no longer exists.');
  }

  return region;
}

function sortRegions(list: OfflineRegion[]): OfflineRegion[] {
  const rank = (status: DatasetStatus): number => {
    switch (status) {
      case 'downloading':
        return 0;
      case 'pending':
        return 1;
      case 'paused':
        return 2;
      case 'failed':
        return 3;
      case 'completed':
        return 4;
      default:
        return 5;
    }
  };

  return [...list].sort((a, b) => {
    const byStatus =
      rank(a.mapStatus) + rank(a.routingStatus) -
      (rank(b.mapStatus) + rank(b.routingStatus));

    if (byStatus !== 0) {
      return byStatus;
    }

    return b.createdAt.localeCompare(a.createdAt);
  });
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function normalizeName(
  name: string,
  center: OfflineRegion['center'],
): string {
  const trimmed = name.trim();

  if (trimmed.length > 0) {
    return trimmed.slice(0, 80);
  }

  return `Offline region ${center.latitude.toFixed(4)}, ${center.longitude.toFixed(4)}`;
}

/**
 * Exposed for the UI estimate step. This never downloads or fabricates a
 * routing size; it asks the configured backend.
 */
export async function estimateRoutingForRegion(input: {
  regionId: string;
  regionName: string;
  center: OfflineRegion['center'];
  radiusKm: number;
  bounds: OfflineRegion['bounds'];
}): Promise<{
  estimatedSizeBytes: number | null;
  coverageBounds: OfflineRegion['bounds'] | null;
  buildOnDemand: boolean;
}> {
  const request = buildRoutingPackageRequest(input);
  const estimate = await estimateRoutingPackage(request);

  return {
    estimatedSizeBytes: estimate.estimatedSizeBytes,
    coverageBounds: estimate.coverageBounds,
    buildOnDemand: estimate.buildOnDemand,
  };
}

export function assertStorageForRouting(sizeBytes: number): void {
  if (Platform.OS === 'web') {
    return;
  }

  try {
    const available = Paths.availableDiskSpace;
    if (
      Number.isFinite(available) &&
      available >= 0 &&
      available < sizeBytes + MIN_FREE_STORAGE_MARGIN_BYTES
    ) {
      throw new OfflineRegionsError(
        'storage',
        'Not enough free storage to download this region. Free up space and try again.',
      );
    }
  } catch (error) {
    if (error instanceof OfflineRegionsError) {
      throw error;
    }
  }
}

export { ROUTING_BUFFER_KM };
