import type {
  CombinedProgress,
  DatasetStatus,
} from '../types/offlineRegion.types';

export type DatasetProgressInput = {
  status: DatasetStatus;
  progress: number;
  downloadedBytes: number;
  totalBytes: number | null;
};

/**
 * Combines two independent downloads. When both totals are known it uses real
 * byte counts; only when justified totals are unavailable does it fall back to
 * the reported percentages.
 */
export function combineDownloadProgress(
  map: DatasetProgressInput,
  routing: DatasetProgressInput,
): CombinedProgress {
  const mapTotal = validTotal(map.totalBytes);
  const routingTotal = validTotal(routing.totalBytes);

  if (mapTotal !== null && routingTotal !== null) {
    const totalBytes = mapTotal + routingTotal;
    const downloadedBytes = Math.min(
      totalBytes,
      Math.max(0, map.downloadedBytes) + Math.max(0, routing.downloadedBytes),
    );

    return {
      progress: totalBytes > 0 ? clamp((downloadedBytes / totalBytes) * 100) : 0,
      downloadedBytes,
      totalBytes,
      method: 'bytes',
    };
  }

  if (mapTotal !== null) {
    const downloadedBytes = Math.max(0, map.downloadedBytes) + Math.max(0, routing.downloadedBytes);
    return {
      progress: weightedProgress(map.progress, routing.progress, mapTotal, routingTotal),
      downloadedBytes,
      totalBytes: null,
      method: 'percentage',
    };
  }

  const downloadedBytes = Math.max(0, map.downloadedBytes) + Math.max(0, routing.downloadedBytes);
  return {
    progress: weightedProgress(map.progress, routing.progress, mapTotal, routingTotal),
    downloadedBytes,
    totalBytes: null,
    method: 'percentage',
  };
}

export function datasetPercent(
  downloadedBytes: number,
  totalBytes: number | null,
  fallbackPercent = 0,
): number {
  if (totalBytes !== null && totalBytes > 0) {
    return clamp((downloadedBytes / totalBytes) * 100);
  }
  return clamp(fallbackPercent);
}

export function clamp(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

export function isTerminalStatus(status: DatasetStatus): boolean {
  return status === 'completed' || status === 'failed';
}

export function isActiveStatus(status: DatasetStatus): boolean {
  return status === 'pending' || status === 'downloading';
}

function validTotal(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function weightedProgress(
  mapPercent: number,
  routingPercent: number,
  mapTotal: number | null,
  routingTotal: number | null,
): number {
  if (mapTotal !== null && routingTotal !== null) {
    return clamp(
      (mapPercent * mapTotal + routingPercent * routingTotal) /
        (mapTotal + routingTotal),
    );
  }

  if (mapTotal !== null) {
    // The routing size has not been resolved yet (manifest pending). Weight the
    // known progress more heavily without inventing a byte count.
    return clamp((mapPercent * 2 + routingPercent) / 3);
  }

  if (routingTotal !== null) {
    return clamp((mapPercent + routingPercent * 2) / 3);
  }

  return clamp((mapPercent + routingPercent) / 2);
}
