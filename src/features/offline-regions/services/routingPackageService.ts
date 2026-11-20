import {
  PREFERRED_ROUTING_PACKAGE_FORMAT,
  ROUTING_BUILD_POLL_INTERVAL_MS,
  ROUTING_BUILD_TIMEOUT_MS,
  ROUTING_BUFFER_KM,
  ROUTING_DATA_BASE_URL,
  ROUTING_MANIFEST_TIMEOUT_MS,
  SUPPORTED_VALHALLA_ENGINE_VERSION,
} from '../config';
import {
  OfflineRegionsError,
  type OfflineRegionBounds,
} from '../types/offlineRegion.types';
import type {
  RoutingManifestResolution,
  RoutingPackageEstimate,
  RoutingPackageFile,
  RoutingPackageManifest,
  RoutingPackageRequest,
} from '../types/routingPackage.types';
import { boundsContain } from '../utils/calculateBounds';
import { isSha256, normalizePackagePath } from '../utils/packagePath';

type FetchOptions = {
  timeoutMs?: number;
  waitForReady?: boolean;
  deadline?: number;
};

export function isRoutingPackageServiceConfigured(): boolean {
  return ROUTING_DATA_BASE_URL.length > 0;
}

export function buildRoutingPackageRequest(input: {
  regionId: string;
  regionName: string;
  center: { latitude: number; longitude: number };
  radiusKm: number;
  bounds: OfflineRegionBounds;
}): RoutingPackageRequest {
  return {
    regionId: input.regionId,
    regionName: input.regionName,
    center: input.center,
    radiusKm: input.radiusKm,
    bounds: input.bounds,
    bufferKm: ROUTING_BUFFER_KM,
    packageFormat: PREFERRED_ROUTING_PACKAGE_FORMAT,
    valhallaEngineVersion: SUPPORTED_VALHALLA_ENGINE_VERSION,
  };
}

export function routingPackageManifestUrl(regionId: string): string {
  if (!ROUTING_DATA_BASE_URL) {
    throw new OfflineRegionsError(
      'routing_configuration',
      'Routing data is not configured. Set EXPO_PUBLIC_ROUTING_DATA_BASE_URL to the routing-data service.',
    );
  }

  return `${ROUTING_DATA_BASE_URL}/packages/${encodeURIComponent(regionId)}/manifest.json`;
}

/**
 * Requests (or looks up) the routing package manifest for a region.
 *
 * The backend may build the package lazily. A 202 response is polled until the
 * package is ready or `ROUTING_BUILD_TIMEOUT_MS` elapses.
 */
export async function resolveRoutingManifest(
  request: RoutingPackageRequest,
  options: FetchOptions = {},
): Promise<RoutingManifestResolution> {
  assertConfigured();

  const deadline = options.deadline ?? Date.now() + ROUTING_BUILD_TIMEOUT_MS;
  const manifestUrl = routingPackageManifestUrl(request.regionId);

  const created = await postJson<unknown>(`${ROUTING_DATA_BASE_URL}/packages`, request);

  if (created.response.status === 200) {
    return {
      status: 'ready',
      manifest: validateRoutingManifest(created.payload, request, manifestUrl),
      manifestUrl,
    };
  }

  if (created.response.status !== 202) {
    const detail = extractServiceError(created.payload);
    throw new OfflineRegionsError(
      'routing_manifest',
      detail ??
        `The routing-data service returned HTTP ${created.response.status} while preparing this region.`,
    );
  }

  if (!options.waitForReady) {
    const building = parseBuildingResponse(created.payload, request.regionId);
    return {
      status: 'building',
      regionId: request.regionId,
      estimatedSizeBytes: building.estimatedSizeBytes,
      retryAfterSeconds: building.retryAfterSeconds,
    };
  }

  return pollForManifest(request, manifestUrl, created.payload, deadline);
}

export async function estimateRoutingPackage(
  request: RoutingPackageRequest,
): Promise<RoutingPackageEstimate> {
  assertConfigured();

  const result = await postJson<unknown>(
    `${ROUTING_DATA_BASE_URL}/packages/estimate`,
    request,
  );

  if (result.response.ok && isRecord(result.payload)) {
    return {
      estimatedSizeBytes: positiveNumberOrNull(result.payload.estimatedSizeBytes),
      coverageBounds: parseOptionalBounds(result.payload.coverageBounds),
      valhallaDataVersion: stringOrNull(result.payload.valhallaDataVersion),
      valhallaEngineVersion: stringOrNull(result.payload.valhallaEngineVersion),
      buildOnDemand:
        result.payload.buildOnDemand === true &&
        positiveNumberOrNull(result.payload.estimatedSizeBytes) === null,
    };
  }

  // Older servers may not implement /packages/estimate. If the package already
  // exists, its manifest is a perfectly good estimate.
  try {
    const manifest = await getJson(`${ROUTING_DATA_BASE_URL}/packages/${encodeURIComponent(request.regionId)}`);
    if (manifest.response.ok && isRecord(manifest.payload)) {
      const parsed = validateRoutingManifest(
        manifest.payload,
        request,
        routingPackageManifestUrl(request.regionId),
      );
      return {
        estimatedSizeBytes: parsed.downloadSizeBytes,
        coverageBounds: parsed.coverageBounds,
        valhallaDataVersion: parsed.valhallaDataVersion,
        valhallaEngineVersion: parsed.valhallaEngineVersion,
        buildOnDemand: false,
      };
    }
  } catch {
    // Estimation is best effort; the download flow still validates the real
    // manifest.
  }

  return {
    estimatedSizeBytes: null,
    coverageBounds: null,
    valhallaDataVersion: null,
    valhallaEngineVersion: null,
    buildOnDemand: false,
  };
}

export function assertValhallaEngineCompatible(manifest: RoutingPackageManifest): void {
  if (manifest.valhallaEngineCompatibility) {
    const supported = satisfiesRange(
      SUPPORTED_VALHALLA_ENGINE_VERSION,
      manifest.valhallaEngineCompatibility,
    );
    const manifestVersion = satisfiesRange(
      manifest.valhallaEngineVersion,
      manifest.valhallaEngineCompatibility,
    );

    if (!supported || !manifestVersion) {
      throw new OfflineRegionsError(
        'engine_unsupported',
        `This routing package requires Valhalla "${manifest.valhallaEngineCompatibility}", but this build uses ${SUPPORTED_VALHALLA_ENGINE_VERSION}.`,
      );
    }

    return;
  }

  if (!sameMajorMinor(manifest.valhallaEngineVersion, SUPPORTED_VALHALLA_ENGINE_VERSION)) {
    throw new OfflineRegionsError(
      'engine_unsupported',
      `Routing tiles were built for Valhalla ${manifest.valhallaEngineVersion}, but this build uses ${SUPPORTED_VALHALLA_ENGINE_VERSION}. Request a compatible package from the data provider.`,
    );
  }
}

export function validateRoutingManifest(
  value: unknown,
  request?: RoutingPackageRequest,
  manifestUrl?: string,
): RoutingPackageManifest {
  if (!isRecord(value)) {
    throw manifestError('The routing-data service returned an invalid manifest.');
  }

  if (value.schemaVersion !== 1) {
    throw manifestError('Unsupported routing package schema version.');
  }

  const packageFormat = value.packageFormat;

  if (packageFormat !== 'directory' && packageFormat !== 'zip') {
    throw manifestError('The routing package has an unsupported package format.');
  }

  const regionId = requiredString(value.regionId, 'regionId');
  const regionName = requiredString(value.regionName, 'regionName');
  const bounds = requiredBounds(value.bounds, 'bounds');
  const coverageBounds = requiredBounds(value.coverageBounds, 'coverageBounds');
  const radiusKm = requiredNumber(value.radiusKm, 'radiusKm');
  const bufferKm = requiredNumber(value.bufferKm, 'bufferKm');
  const valhallaDataVersion = requiredString(value.valhallaDataVersion, 'valhallaDataVersion');
  const valhallaEngineVersion = requiredString(
    value.valhallaEngineVersion,
    'valhallaEngineVersion',
  );
  const downloadSizeBytes = requiredPositiveNumber(
    value.downloadSizeBytes,
    'downloadSizeBytes',
  );
  const createdAt = requiredString(value.createdAt, 'createdAt');

  if (request && regionId !== request.regionId) {
    throw manifestError(
      `The routing package belongs to "${regionId}", not "${request.regionId}".`,
    );
  }

  if (request && !boundsContain(coverageBounds, request.bounds)) {
    throw manifestError(
      'The routing package coverage does not contain the requested region.',
    );
  }

  if (request && Math.abs(radiusKm - request.radiusKm) > 0.01) {
    throw manifestError('The routing package radius does not match the request.');
  }

  const manifest: RoutingPackageManifest = {
    schemaVersion: 1,
    packageFormat,
    regionId,
    regionName,
    bounds,
    coverageBounds,
    radiusKm,
    bufferKm,
    valhallaDataVersion,
    valhallaEngineVersion,
    valhallaEngineCompatibility: stringOrUndefined(
      value.valhallaEngineCompatibility,
    ),
    createdAt,
    downloadSizeBytes,
    metadata: parseMetadata(value.metadata),
  };

  if (packageFormat === 'directory') {
    const files = validateFiles(value.files, 'files');

    if (files.length === 0) {
      throw manifestError('The routing package contains no files.');
    }

    const total = files.reduce((sum, file) => sum + file.sizeBytes, 0);

    if (Math.abs(total - downloadSizeBytes) > 1) {
      throw manifestError('The routing package download size does not match its files.');
    }

    manifest.files = files.map((file) => ({
      ...file,
      url: resolvePackageUrl(file.url, manifestUrl),
    }));
  } else {
    const archive = value.archive;

    if (!isRecord(archive)) {
      throw manifestError('The routing package is missing its archive information.');
    }

    const archiveUrl = resolvePackageUrl(
      requiredString(archive.url, 'archive.url'),
      manifestUrl,
    );
    const archiveSize = requiredPositiveNumber(archive.sizeBytes, 'archive.sizeBytes');
    const archiveSha = requiredString(archive.sha256, 'archive.sha256');
    const files = validateFiles(archive.files, 'archive.files');

    if (archiveSize !== downloadSizeBytes) {
      throw manifestError(
        'The routing archive size does not match downloadSizeBytes.',
      );
    }

    if (!isSha256(archiveSha)) {
      throw manifestError('The routing archive checksum is invalid.');
    }

    if (files.length === 0) {
      throw manifestError('The routing archive lists no expected files.');
    }

    manifest.archive = {
      url: archiveUrl,
      sizeBytes: archiveSize,
      sha256: archiveSha,
      files: files.map((file) => ({
        ...file,
        url: resolvePackageUrl(file.url, manifestUrl),
      })),
    };
  }

  return manifest;
}

export function fileUrlList(manifest: RoutingPackageManifest): RoutingPackageFile[] {
  if (manifest.packageFormat === 'directory') {
    return manifest.files ?? [];
  }

  return manifest.archive?.files ?? [];
}

export function manifestDownloadBytes(manifest: RoutingPackageManifest): number {
  return manifest.packageFormat === 'zip'
    ? manifest.archive?.sizeBytes ?? manifest.downloadSizeBytes
    : manifest.files?.reduce((sum, file) => sum + file.sizeBytes, 0) ??
        manifest.downloadSizeBytes;
}

async function pollForManifest(
  request: RoutingPackageRequest,
  manifestUrl: string,
  lastPayload: unknown,
  deadline: number,
): Promise<RoutingManifestResolution> {
  let payload = lastPayload;

  while (Date.now() < deadline) {
    const retryAfter = parseBuildingResponse(payload, request.regionId).retryAfterSeconds;
    const delay = Math.max(
      1_000,
      Math.min(30_000, (retryAfter ?? ROUTING_BUILD_POLL_INTERVAL_MS / 1_000) * 1_000),
    );

    await sleep(delay);

    const result = await getJson(
      `${ROUTING_DATA_BASE_URL}/packages/${encodeURIComponent(request.regionId)}`,
    );

    if (result.response.status === 200) {
      return {
        status: 'ready',
        manifest: validateRoutingManifest(result.payload, request, manifestUrl),
        manifestUrl,
      };
    }

    if (result.response.status === 202) {
      payload = result.payload;
      continue;
    }

    if (result.response.status === 404) {
      throw new OfflineRegionsError(
        'routing_manifest',
        'The routing-data service lost this package while it was building. Try again.',
      );
    }

    throw new OfflineRegionsError(
      'routing_manifest',
      `The routing-data service returned HTTP ${result.response.status} while building this package.`,
    );
  }

  throw new OfflineRegionsError(
    'routing_download_failed',
    'The routing package took too long to build. Try again later or choose a smaller region.',
  );
}

function validateFiles(value: unknown, field: string): RoutingPackageFile[] {
  if (!Array.isArray(value)) {
    throw manifestError(`The routing package is missing "${field}".`);
  }

  const seen = new Set<string>();

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw manifestError(`Invalid routing package file at index ${index}.`);
    }

    const path = requiredString(entry.path, `${field}[${index}].path`);
    const url = requiredString(entry.url, `${field}[${index}].url`);
    const sizeBytes = requiredPositiveNumber(
      entry.sizeBytes,
      `${field}[${index}].sizeBytes`,
    );
    const sha256 = requiredString(entry.sha256, `${field}[${index}].sha256`);

    normalizePackagePath(path);

    if (!isSha256(sha256)) {
      throw manifestError(`Invalid SHA-256 checksum for "${path}".`);
    }

    if (path === 'manifest.json') {
      throw manifestError('The routing package files must not overwrite manifest.json.');
    }

    if (seen.has(path)) {
      throw manifestError(`Duplicate routing package file: ${path}`);
    }

    seen.add(path);

    return { path, url, sizeBytes, sha256 };
  });
}

function resolvePackageUrl(url: string, manifestUrl?: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  if (!manifestUrl) {
    throw manifestError('A relative package URL cannot be resolved without a manifest URL.');
  }

  try {
    return new URL(url, manifestUrl).toString();
  } catch {
    throw manifestError(`Invalid package URL: ${url}`);
  }
}

function parseBuildingResponse(
  payload: unknown,
  regionId: string,
): { estimatedSizeBytes: number | null; retryAfterSeconds: number | null } {
  if (!isRecord(payload)) {
    return { estimatedSizeBytes: null, retryAfterSeconds: null };
  }

  if (payload.regionId !== undefined && payload.regionId !== regionId) {
    throw manifestError('The routing-data service returned a different region ID.');
  }

  return {
    estimatedSizeBytes: positiveNumberOrNull(payload.estimatedSizeBytes),
    retryAfterSeconds: positiveNumberOrNull(payload.retryAfterSeconds),
  };
}

async function postJson<T>(
  url: string,
  body: unknown,
): Promise<{ response: Response; payload: T }> {
  return requestJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getJson<T>(url: string): Promise<{ response: Response; payload: T }> {
  return requestJson<T>(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
): Promise<{ response: Response; payload: T }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROUTING_MANIFEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });

    let payload: T;
    try {
      payload = (await response.json()) as T;
    } catch {
      payload = undefined as T;
    }

    return { response, payload };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new OfflineRegionsError(
        'offline',
        'The routing-data service did not respond in time.',
        { cause: error },
      );
    }

    throw new OfflineRegionsError(
      'offline',
      `Cannot reach the routing-data service at ${ROUTING_DATA_BASE_URL}. Start it with "bun run routing-data" on your computer, keep this device on the same Wi-Fi, and allow TCP port 8787 through the firewall.`,
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function assertConfigured(): void {
  if (!isRoutingPackageServiceConfigured()) {
    throw new OfflineRegionsError(
      'routing_configuration',
      'Routing data is not configured. Set EXPO_PUBLIC_ROUTING_DATA_BASE_URL to the routing-data service.',
    );
  }
}

function manifestError(message: string): OfflineRegionsError {
  return new OfflineRegionsError('routing_manifest', message);
}

function extractServiceError(value: unknown): string | null {
  if (!isRecord(value) || typeof value.error !== 'string' || value.error.trim() === '') {
    return null;
  }

  return value.error.trim();
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw manifestError(`Routing manifest field "${field}" is invalid.`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw manifestError(`Routing manifest field "${field}" is invalid.`);
  }
  return value;
}

function requiredPositiveNumber(value: unknown, field: string): number {
  const number = requiredNumber(value, field);
  if (number <= 0) {
    throw manifestError(`Routing manifest field "${field}" must be greater than zero.`);
  }
  return number;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function positiveNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function requiredBounds(value: unknown, field: string): OfflineRegionBounds {
  const bounds = parseOptionalBounds(value);

  if (!bounds) {
    throw manifestError(`Routing manifest field "${field}" has invalid bounds.`);
  }

  return bounds;
}

function parseOptionalBounds(value: unknown): OfflineRegionBounds | null {
  if (!isRecord(value)) {
    return null;
  }

  const west = value.west;
  const south = value.south;
  const east = value.east;
  const north = value.north;

  if (
    typeof west !== 'number' ||
    typeof south !== 'number' ||
    typeof east !== 'number' ||
    typeof north !== 'number' ||
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north) ||
    west >= east ||
    south >= north ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90
  ) {
    return null;
  }

  return { west, south, east, north };
}

function parseMetadata(value: unknown): RoutingPackageManifest['metadata'] {
  if (!isRecord(value)) {
    return undefined;
  }

  const tileLevels = positiveNumberOrNull(value.tileLevels);
  const tileSizeDegrees = positiveNumberOrNull(value.tileSizeDegrees);

  return {
    tileLevels: tileLevels ?? undefined,
    tileSizeDegrees: tileSizeDegrees ?? undefined,
    source: stringOrUndefined(value.source),
    notes: stringOrUndefined(value.notes),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sameMajorMinor(a: string, b: string): boolean {
  const left = a.split('.');
  const right = b.split('.');

  return left[0] === right[0] && left[1] === right[1];
}

function satisfiesRange(version: string, range: string): boolean {
  const comparators = range
    .replace(/,/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (comparators.length === 0) {
    return true;
  }

  const current = parseVersion(version);

  if (!current) {
    return false;
  }

  return comparators.every((comparator) => {
    const match = /^(>=|<=|>|<|=|\^|~)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(
      comparator,
    );

    if (!match) {
      return false;
    }

    const operator = match[1] ?? '=';
    const target = {
      major: Number(match[2]),
      minor: Number(match[3] ?? 0),
      patch: Number(match[4] ?? 0),
    };

    if (operator === '^') {
      return (
        current.major === target.major &&
        compareVersions(current, target) >= 0
      );
    }

    if (operator === '~') {
      return (
        current.major === target.major &&
        current.minor === target.minor &&
        compareVersions(current, target) >= 0
      );
    }

    const comparison = compareVersions(current, target);

    switch (operator) {
      case '>=':
        return comparison >= 0;
      case '<=':
        return comparison <= 0;
      case '>':
        return comparison > 0;
      case '<':
        return comparison < 0;
      default:
        return comparison === 0;
    }
  });
}

function parseVersion(
  version: string,
): { major: number; minor: number; patch: number } | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
  };
}

function compareVersions(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number },
): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}
