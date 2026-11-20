import type {
  OfflinePack,
  OfflinePackError,
  OfflinePackStatus,
} from '@maplibre/maplibre-react-native';
import { Paths } from 'expo-file-system';
import { AppState, Platform } from 'react-native';

import { MAP_STYLE_URL } from '@/constants/map';

import * as offlineMapRepository from '../database/offlineMapRepository';
import {
  OfflineMapsError,
  type CreateOfflineRegionInput,
  type OfflineBounds,
  type OfflineRegion,
  type OfflineRegionStatus,
  type OfflineVerificationResult,
  type StorageInfo,
} from '../types/offlineMap';
import {
  assertReasonableTileCount,
  assertZoomRange,
  boundsKey,
  boundsMatch,
  validateBounds,
} from './regionService';
import {
  isOfflineManagerAvailable,
  addListener,
  createPack,
  deletePack,
  getPack,
  getPackStatus,
  getPacks,
  pausePack,
  resumePack,
  setProgressEventThrottle,
} from './offlineManager';

import { checkOnline, getStyleCapabilities } from './styleService';

const PROGRESS_THROTTLE_MS = 400;
const PERSIST_DEBOUNCE_MS = 750;
const MIN_FREE_BYTES = 15 * 1024 * 1024;
const OFFLINE_STYLE_REVISION = 3;

type DerivedStatus = {
  status: OfflineRegionStatus;
  progress: number;
  shouldAttach: boolean;
};

type Listener = () => void;

let regions: OfflineRegion[] = [];
let initialization: Promise<void> | null = null;
let appStateSubscription: { remove: () => void } | null = null;

const listeners = new Set<Listener>();
const attachedPackIds = new Set<string>();
const inFlightRegionIds = new Set<string>();
const pendingKeys = new Set<string>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

export function isSupported(): boolean {
  return isOfflineManagerAvailable();
}

export function getStorageInfo(): StorageInfo {
  let availableBytes: number | null = null;
  let totalBytes: number | null = null;

  if (Platform.OS !== 'web') {
    try {
      const available = Paths.availableDiskSpace;
      const total = Paths.totalDiskSpace;

      if (Number.isFinite(available) && available >= 0) {
        availableBytes = available;
      }
      if (Number.isFinite(total) && total > 0) {
        totalBytes = total;
      }
    } catch {
      // Storage information is best effort.
    }
  }

  return {
    availableBytes,
    totalBytes,
    downloadedBytes: regions.reduce(
      (total, region) => (region.status === 'missing' ? total : total + region.sizeBytes),
      0,
    ),
  };
}

export function initialize(): Promise<void> {
  if (initialization) {
    return initialization;
  }

  initialization = (async () => {
    await offlineMapRepository.initializeDatabase();

    if (!isOfflineManagerAvailable()) {
      regions = await offlineMapRepository.listRegions();
      emit();
      return;
    }

    setProgressEventThrottle(PROGRESS_THROTTLE_MS);
    subscribeToAppState();
    await syncPacks();
  })().catch((error) => {
    initialization = null;
    throw error;
  });

  return initialization;
}

export async function refresh(): Promise<void> {
  await initialize();
  await syncPacks();
}

export async function startDownload(
  input: CreateOfflineRegionInput,
): Promise<OfflineRegion> {
  await initialize();

  if (!isOfflineManagerAvailable()) {
    throw new OfflineMapsError(
      'unsupported',
      'Offline maps require a development build with MapLibre installed.',
    );
  }

  const bounds = validateBounds(input.bounds);
  const minZoom = input.minZoom;
  const maxZoom = input.maxZoom;
  const key = boundsKey(bounds, minZoom, maxZoom);

  if (pendingKeys.has(key)) {
    throw new OfflineMapsError('duplicate', 'This region is already being queued.');
  }

  pendingKeys.add(key);
  let inFlightId: string | null = null;

  try {
    await validateDownloadRequest(bounds, minZoom, maxZoom);

    const existing = regions.find(
      (region) =>
        region.styleUrl === MAP_STYLE_URL &&
        region.minZoom === minZoom &&
        region.maxZoom === maxZoom &&
        boundsMatch(region.bounds, bounds),
    );

    if (
      existing &&
      existing.status !== 'failed' &&
      existing.status !== 'missing'
    ) {
      throw new OfflineMapsError(
        'duplicate',
        existing.status === 'completed'
          ? 'This region is already downloaded.'
          : 'This region is already queued or downloaded.',
      );
    }

    const id = existing?.id ?? input.id ?? createRegionId();
    inFlightId = id;
    inFlightRegionIds.add(id);

    if (existing?.packId) {
      await deleteNativePack(existing.packId);
      attachedPackIds.delete(existing.packId);
    }

    const timestamp = new Date().toISOString();
    const record: OfflineRegion = {
      id,
      packId: null,
      name: normalizeName(input.name, bounds, minZoom, maxZoom),
      bounds,
      minZoom,
      maxZoom,
      styleUrl: MAP_STYLE_URL,
      status: 'pending',
      progress: 0,
      completedResourceCount: 0,
      requiredResourceCount: 0,
      sizeBytes: 0,
      error: null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    if (existing) {
      await offlineMapRepository.updateRegion(record);
    } else {
      await offlineMapRepository.insertRegion(record);
    }

    replaceRegion(record);

    try {
      return await beginNativeDownload(record);
    } catch (error) {
      throw await markFailed(record, error);
    }
  } finally {
    pendingKeys.delete(key);
    if (inFlightId) {
      inFlightRegionIds.delete(inFlightId);
    }
  }
}

export async function pauseRegion(id: string): Promise<OfflineRegion> {
  await initialize();
  const region = requireRegion(id);

  if (region.status === 'paused') {
    return region;
  }

  if (region.status !== 'downloading') {
    throw new OfflineMapsError('download_failed', 'Only an active download can be paused.');
  }

  if (!region.packId) {
    throw new OfflineMapsError('pack_missing', 'The MapLibre pack could not be found.');
  }

  try {
    await pausePack(region.packId);
  } catch (error) {
    throw new OfflineMapsError('download_failed', describeError(error), { cause: error });
  }

  const updated: OfflineRegion = {
    ...region,
    status: 'paused',
    updatedAt: new Date().toISOString(),
  };

  await persistRegion(updated);
  return updated;
}

export async function resumeRegion(id: string): Promise<OfflineRegion> {
  await initialize();
  const region = requireRegion(id);

  if (region.status === 'completed') {
    return region;
  }

  if (region.status === 'failed' || region.status === 'missing' || !region.packId) {
    return retryRegion(id);
  }

  if (region.status !== 'paused') {
    throw new OfflineMapsError('download_failed', 'This download is not paused.');
  }

  const pack = await getPack(region.packId).catch(() => null);

  // Packs created before the download-safe style fix would crash MapLibre on
  // resume, so restart them with the current style instead.
  if (!pack || pack.metadata.styleRevision !== OFFLINE_STYLE_REVISION) {
    return restartDownload(region);
  }

  try {
    await attachPack(region.packId);
    await resumePack(region.packId);
  } catch (error) {
    const missing = isUnknownPackError(error);
    const updated: OfflineRegion = {
      ...region,
      packId: missing ? null : region.packId,
      status: missing ? 'missing' : 'failed',
      error: missing
        ? 'MapLibre no longer has this pack on the device. Download it again.'
        : describeError(error),
      updatedAt: new Date().toISOString(),
    };
    await persistRegion(updated);
    throw new OfflineMapsError(
      missing ? 'pack_missing' : 'download_failed',
      updated.error ?? 'Unable to resume the download.',
      { cause: error },
    );
  }

  const updated: OfflineRegion = {
    ...region,
    status: 'downloading',
    error: null,
    updatedAt: new Date().toISOString(),
  };
  await persistRegion(updated);
  return updated;
}

export async function retryRegion(id: string): Promise<OfflineRegion> {
  await initialize();

  if (!isOfflineManagerAvailable()) {
    throw new OfflineMapsError(
      'unsupported',
      'Offline maps require a development build with MapLibre installed.',
    );
  }

  const region = requireRegion(id);

  if (region.status !== 'failed' && region.status !== 'missing') {
    throw new OfflineMapsError(
      'download_failed',
      'Only failed or missing downloads can be retried.',
    );
  }

  return restartDownload(region);
}

async function restartDownload(region: OfflineRegion): Promise<OfflineRegion> {
  inFlightRegionIds.add(region.id);

  try {
    await validateDownloadRequest(region.bounds, region.minZoom, region.maxZoom);

    if (region.packId) {
      await deleteNativePack(region.packId);
      attachedPackIds.delete(region.packId);
    }

    cancelPersist(region.id);
    const pending: OfflineRegion = {
      ...region,
      packId: null,
      styleUrl: MAP_STYLE_URL,
      status: 'pending',
      progress: 0,
      completedResourceCount: 0,
      requiredResourceCount: 0,
      sizeBytes: 0,
      error: null,
      updatedAt: new Date().toISOString(),
    };
    await persistRegion(pending);

    try {
      return await beginNativeDownload(pending);
    } catch (error) {
      throw await markFailed(pending, error);
    }
  } finally {
    inFlightRegionIds.delete(region.id);
  }
}

export async function removeRegion(id: string): Promise<void> {
  await initialize();
  const region = requireRegion(id);

  cancelPersist(id);

  if (region.packId) {
    await deleteNativePack(region.packId);
    attachedPackIds.delete(region.packId);
  }

  await offlineMapRepository.deleteRegion(id);
  regions = regions.filter((item) => item.id !== id);
  emit();
}

export async function verifyRegion(id: string): Promise<OfflineVerificationResult> {
  await initialize();
  const region = requireRegion(id);

  if (!isOfflineManagerAvailable()) {
    throw new OfflineMapsError(
      'unsupported',
      'Offline maps require a development build with MapLibre installed.',
    );
  }

  if (!region.packId) {
    const missing = await persistMissing(region, 'MapLibre has no pack for this region.');
    return { ok: false, message: missing.error ?? 'Pack is missing.', region: missing };
  }

  try {
    const status = await getPackStatus(region.packId);

    if (!status) {
      const missing = await persistMissing(region, 'MapLibre has no pack for this region.');
      return { ok: false, message: missing.error ?? 'Pack is missing.', region: missing };
    }

    const complete =
      status.state === 'complete' ||
      (status.requiredResourceCount > 0 &&
        status.completedResourceCount >= status.requiredResourceCount);

    const derived = deriveStatus(status, region.status);
    const updated: OfflineRegion = {
      ...region,
      status: complete ? 'completed' : derived.status,
      progress: complete ? 100 : derived.progress,
      completedResourceCount: status.completedResourceCount,
      requiredResourceCount: status.requiredResourceCount,
      sizeBytes: status.completedResourceSize,
      updatedAt: new Date().toISOString(),
    };
    await persistRegion(updated);

    return {
      ok: complete,
      message: complete
        ? 'MapLibre confirms this pack is fully downloaded. Turn on airplane mode and open it to verify resources.'
        : 'MapLibre reports that this pack is not complete yet.',
      region: updated,
    };
  } catch (error) {
    if (isUnknownPackError(error)) {
      const missing = await persistMissing(region, 'MapLibre no longer has this pack.');
      return {
        ok: false,
        message: missing.error ?? 'Pack is missing.',
        region: missing,
      };
    }

    throw new OfflineMapsError('download_failed', describeError(error), { cause: error });
  }
}

async function validateDownloadRequest(
  bounds: OfflineBounds,
  minZoom: number,
  maxZoom: number,
): Promise<void> {
  if (!(await checkOnline())) {
    throw new OfflineMapsError(
      'offline',
      'No internet connection. Connect to the internet before downloading map data.',
    );
  }

  const capabilities = await getStyleCapabilities();
  assertZoomRange(minZoom, maxZoom, capabilities);
  assertReasonableTileCount(bounds, minZoom, maxZoom);
  assertStorageAvailable();
}

async function beginNativeDownload(record: OfflineRegion): Promise<OfflineRegion> {
  const pack = await createPack(
    {
      mapStyle: record.styleUrl,
      bounds: record.bounds,
      minZoom: record.minZoom,
      maxZoom: record.maxZoom,
      metadata: {
        appId: record.id,
        regionName: record.name,
        bounds: record.bounds,
        minZoom: record.minZoom,
        maxZoom: record.maxZoom,
        styleUrl: record.styleUrl,
        styleRevision: OFFLINE_STYLE_REVISION,
        createdAt: record.createdAt,
      },
    },
    handleProgress,
    handleError,
  );

  attachedPackIds.add(pack.id);

  // Progress events can arrive before createPack resolves. Preserve whatever
  // state MapLibre already reported instead of overwriting it with "downloading".
  const current = getRegion(record.id) ?? record;
  const updated: OfflineRegion = {
    ...current,
    packId: pack.id,
    status: current.status === 'pending' ? 'downloading' : current.status,
    error: current.status === 'failed' ? current.error : null,
    updatedAt: new Date().toISOString(),
  };

  await persistRegion(updated);
  return updated;
}

async function markFailed(record: OfflineRegion, error: unknown): Promise<OfflineMapsError> {
  const message = describeError(error);
  const current = getRegion(record.id) ?? record;
  const failed: OfflineRegion = {
    ...current,
    status: 'failed',
    error: message,
    updatedAt: new Date().toISOString(),
  };

  cancelPersist(record.id);
  await persistRegion(failed);
  return new OfflineMapsError('download_failed', message, { cause: error });
}

function handleProgress(pack: OfflinePack, status: OfflinePackStatus): void {
  const id = findRegionIdForPack(pack);
  const region = id ? getRegion(id) : null;

  if (!region) {
    return;
  }

  const derived = deriveStatus(status, region.status);

  const updated: OfflineRegion = {
    ...region,
    status: derived.status,
    progress: derived.progress,
    completedResourceCount: status.completedResourceCount,
    requiredResourceCount: status.requiredResourceCount,
    sizeBytes: status.completedResourceSize,
    error: derived.status === 'failed' ? region.error : null,
    updatedAt: new Date().toISOString(),
  };

  if (derived.status === 'completed' || derived.status === 'failed') {
    attachedPackIds.delete(pack.id);
  }

  replaceRegion(updated);
  schedulePersist(region.id, derived.status === 'completed' ? 0 : PERSIST_DEBOUNCE_MS);
}

function handleError(pack: OfflinePack, error: OfflinePackError): void {
  const id = findRegionIdForPack(pack);
  const region = id ? getRegion(id) : null;

  if (!region) {
    return;
  }

  const message = error.message?.trim() || 'The map download failed.';
  const updated: OfflineRegion = {
    ...region,
    status: 'failed',
    error: message,
    updatedAt: new Date().toISOString(),
  };

  cancelPersist(region.id);
  replaceRegion(updated);
  void offlineMapRepository.updateRegion(updated).catch(() => undefined);
}

async function syncPacks(): Promise<void> {
  const stored = await offlineMapRepository.listRegions();

  let nativePacks: OfflinePack[] = [];
  try {
    nativePacks = await getPacks();
  } catch {
    regions = sortRegions(stored);
    emit();
    return;
  }

  const byPackId = new Map<string, OfflineRegion>();
  const byId = new Map<string, OfflineRegion>();

  for (const region of stored) {
    byId.set(region.id, region);
    if (region.packId) {
      byPackId.set(region.packId, region);
    }
  }

  const seen = new Set<string>();
  const synced: OfflineRegion[] = [];
  const timestamp = new Date().toISOString();

  for (const pack of nativePacks) {
    const metadata = pack.metadata ?? {};
    const metadataAppId =
      typeof metadata.appId === 'string' && metadata.appId.length > 0
        ? metadata.appId
        : null;

    const record =
      byPackId.get(pack.id) ??
      (metadataAppId ? byId.get(metadataAppId) : undefined) ??
      byId.get(pack.id);

    const id = record?.id ?? metadataAppId ?? pack.id;

    if (seen.has(id)) {
      continue;
    }

    let status: OfflinePackStatus | null = null;
    try {
      status = await pack.status();
    } catch {
      status = null;
    }

    const bounds =
      metadataBounds(metadata.bounds) ??
      (isOfflineBounds(pack.bounds) ? pack.bounds : record?.bounds);

    if (!bounds) {
      continue;
    }

    const minZoom = integerOr(metadata.minZoom, record?.minZoom ?? 0);
    const maxZoom = integerOr(metadata.maxZoom, record?.maxZoom ?? minZoom);
    const derived = deriveStatus(status, record?.status);

    const updated: OfflineRegion = {
      id,
      packId: pack.id,
      name: stringOr(metadata.regionName, record?.name) ?? 'Offline region',
      bounds,
      minZoom,
      maxZoom,
      styleUrl: stringOr(metadata.styleUrl, record?.styleUrl) ?? MAP_STYLE_URL,
      status: derived.status,
      progress: derived.progress,
      completedResourceCount:
        status?.completedResourceCount ?? record?.completedResourceCount ?? 0,
      requiredResourceCount:
        status?.requiredResourceCount ?? record?.requiredResourceCount ?? 0,
      sizeBytes: status?.completedResourceSize ?? record?.sizeBytes ?? 0,
      error:
        derived.status === 'failed'
          ? record?.error ?? 'The download failed.'
          : derived.status === 'paused' && !record?.packId
            ? 'The download was interrupted. Resume to continue.'
            : derived.status === 'paused' && record?.status === 'downloading'
              ? 'The download was interrupted when the app closed. Resume to continue.'
              : null,
      createdAt:
        stringOr(metadata.createdAt, record?.createdAt) ?? timestamp,
      updatedAt: timestamp,
    };

    if (record) {
      await offlineMapRepository.updateRegion(updated);
    } else {
      try {
        await offlineMapRepository.insertRegion(updated);
      } catch {
        await offlineMapRepository.updateRegion(updated);
      }
    }

    seen.add(id);
    synced.push(updated);

    if (derived.shouldAttach) {
      void attachPack(pack.id);
    }
  }

  for (const record of stored) {
    if (seen.has(record.id)) {
      continue;
    }

    if (inFlightRegionIds.has(record.id)) {
      synced.push(record);
      continue;
    }

    const failedBeforeStart = record.status === 'pending';
    const updated: OfflineRegion = {
      ...record,
      packId: null,
      status: failedBeforeStart ? 'failed' : 'missing',
      error: failedBeforeStart
        ? 'The download was interrupted before it started. Retry to download again.'
        : 'MapLibre no longer has this pack on the device. Delete it or download it again.',
      updatedAt: timestamp,
    };

    await offlineMapRepository.updateRegion(updated);
    synced.push(updated);
  }

  regions = sortRegions(synced);
  emit();
}

async function attachPack(packId: string): Promise<void> {
  if (attachedPackIds.has(packId)) {
    return;
  }

  attachedPackIds.add(packId);

  try {
    await addListener(packId, handleProgress, handleError);
  } catch (error) {
    attachedPackIds.delete(packId);
    throw error;
  }
}

async function persistMissing(
  region: OfflineRegion,
  message: string,
): Promise<OfflineRegion> {
  const updated: OfflineRegion = {
    ...region,
    packId: null,
    status: 'missing',
    error: message,
    updatedAt: new Date().toISOString(),
  };
  await persistRegion(updated);
  return updated;
}

function findRegionIdForPack(pack: OfflinePack): string | null {
  const appId =
    typeof pack.metadata?.appId === 'string' && pack.metadata.appId.length > 0
      ? pack.metadata.appId
      : null;

  if (appId && getRegion(appId)) {
    return appId;
  }

  return regions.find((region) => region.packId === pack.id)?.id ?? null;
}

function deriveStatus(
  status: OfflinePackStatus | null,
  previousStatus?: OfflineRegionStatus | null,
): DerivedStatus {
  if (!status) {
    return {
      status:
        previousStatus === 'completed'
          ? 'completed'
          : previousStatus === 'failed'
            ? 'failed'
            : 'paused',
      progress: previousStatus === 'completed' ? 100 : 0,
      shouldAttach: false,
    };
  }

  if (status.state === 'complete') {
    return { status: 'completed', progress: 100, shouldAttach: false };
  }

  if (status.state === 'active') {
    return {
      status: 'downloading',
      progress: clampPercentage(status.percentage),
      shouldAttach: true,
    };
  }

  if (previousStatus === 'failed') {
    return {
      status: 'failed',
      progress: clampPercentage(status.percentage),
      shouldAttach: false,
    };
  }

  const allResourcesPresent =
    status.requiredResourceCount > 0 &&
    status.completedResourceCount >= status.requiredResourceCount;

  if (allResourcesPresent) {
    return { status: 'completed', progress: 100, shouldAttach: false };
  }

  return {
    status: 'paused',
    progress: clampPercentage(status.percentage),
    shouldAttach: false,
  };
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
      void offlineMapRepository.updateRegion(region).catch(() => undefined);
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

async function persistRegion(region: OfflineRegion): Promise<void> {
  cancelPersist(region.id);
  replaceRegion(region);
  await offlineMapRepository.updateRegion(region);
}

function replaceRegion(region: OfflineRegion): void {
  let found = false;
  const next = regions.map((item) => {
    if (item.id === region.id) {
      found = true;
      return region;
    }
    return item;
  });

  if (!found) {
    next.push(region);
  }

  regions = sortRegions(next);
  emit();
}

function requireRegion(id: string): OfflineRegion {
  const region = getRegion(id);
  if (!region) {
    throw new OfflineMapsError('pack_missing', 'This offline region no longer exists.');
  }
  return region;
}

async function deleteNativePack(packId: string): Promise<void> {
  try {
    await deletePack(packId);
  } catch (error) {
    if (!isUnknownPackError(error)) {
      throw new OfflineMapsError('download_failed', describeError(error), { cause: error });
    }
  }
}

function assertStorageAvailable(): void {
  if (Platform.OS === 'web') {
    return;
  }

  try {
    const available = Paths.availableDiskSpace;
    if (Number.isFinite(available) && available >= 0 && available < MIN_FREE_BYTES) {
      throw new OfflineMapsError(
        'storage',
        'Not enough free storage to download this region. Free up space and try again.',
      );
    }
  } catch (error) {
    if (error instanceof OfflineMapsError) {
      throw error;
    }
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
        void offlineMapRepository.updateRegion(region).catch(() => undefined);
      }
    }
  });
}

function sortRegions(list: OfflineRegion[]): OfflineRegion[] {
  const rank: Record<OfflineRegionStatus, number> = {
    downloading: 0,
    pending: 1,
    paused: 2,
    failed: 3,
    missing: 4,
    completed: 5,
  };

  return [...list].sort((a, b) => {
    const byStatus = rank[a.status] - rank[b.status];
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

function createRegionId(): string {
  return `region_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeName(
  name: string,
  bounds: OfflineBounds,
  minZoom: number,
  maxZoom: number,
): string {
  const trimmed = name.trim();
  if (trimmed.length > 0) {
    return trimmed.slice(0, 80);
  }

  const latitude = ((bounds[1] + bounds[3]) / 2).toFixed(3);
  const longitude = ((bounds[0] + bounds[2]) / 2).toFixed(3);
  return `Area ${latitude}, ${longitude} · z${minZoom}–${maxZoom}`;
}

function metadataBounds(value: unknown): OfflineBounds | null {
  if (!isOfflineBounds(value)) {
    return null;
  }

  try {
    return validateBounds(value);
  } catch {
    return null;
  }
}

function isOfflineBounds(value: unknown): value is OfflineBounds {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

function integerOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : fallback;
}

function stringOr(value: unknown, fallback: string | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

function describeError(error: unknown): string {
  if (error instanceof OfflineMapsError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message || 'The map download failed.';
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  return 'The map download failed.';
}

function isUnknownPackError(error: unknown): boolean {
  const message = describeError(error).toLowerCase();
  return (
    message.includes('not found') ||
    message.includes('unknown offline region') ||
    message.includes('already been deleted') ||
    message.includes('no longer exists')
  );
}
