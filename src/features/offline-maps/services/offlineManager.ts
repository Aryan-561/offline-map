import type {
  OfflinePack,
  OfflinePackCreateOptions,
  OfflinePackErrorListener,
  OfflinePackProgressListener,
  OfflinePackStatus,
} from '@maplibre/maplibre-react-native';

import { getMapLibre, isMapLibreAvailable } from './maplibre';

export function isOfflineManagerAvailable(): boolean {
  return isMapLibreAvailable();
}

export async function getPacks(): Promise<OfflinePack[]> {
  return getMapLibre().OfflineManager.getPacks();
}

export async function createPack(
  options: OfflinePackCreateOptions,
  onProgress: OfflinePackProgressListener,
  onError: OfflinePackErrorListener,
): Promise<OfflinePack> {
  return getMapLibre().OfflineManager.createPack(options, onProgress, onError);
}

export async function getPack(packId: string): Promise<OfflinePack> {
  return getMapLibre().OfflineManager.getPack(packId);
}

export async function deletePack(packId: string): Promise<void> {
  await getMapLibre().OfflineManager.deletePack(packId);
}

export async function addListener(
  packId: string,
  onProgress: OfflinePackProgressListener,
  onError: OfflinePackErrorListener,
): Promise<void> {
  await getMapLibre().OfflineManager.addListener(packId, onProgress, onError);
}

export function removeListener(packId: string): void {
  getMapLibre().OfflineManager.removeListener(packId);
}

export async function getPackStatus(packId: string): Promise<OfflinePackStatus> {
  const pack = await getPack(packId);
  return pack.status();
}

export async function pausePack(packId: string): Promise<void> {
  const pack = await getPack(packId);
  await pack.pause();
}

export async function resumePack(packId: string): Promise<void> {
  const pack = await getPack(packId);
  await pack.resume();
}

export function setProgressEventThrottle(milliseconds: number): void {
  if (!isOfflineManagerAvailable()) {
    return;
  }

  getMapLibre().OfflineManager.setProgressEventThrottle(milliseconds);
}

export function setTileCountLimit(limit: number): void {
  if (!isOfflineManagerAvailable()) {
    return;
  }

  getMapLibre().OfflineManager.setTileCountLimit(limit);
}
