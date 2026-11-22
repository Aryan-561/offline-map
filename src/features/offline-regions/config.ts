const DEFAULT_ROUTING_DATA_PORT = 8787;

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBaseUrl(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, '') ?? '';
}

function portFromUrl(value: string): number | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^/:]+:(\d+)/iu.exec(value);

  if (!match) {
    return null;
  }

  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 ? port : null;
}

function privateHostFromUri(hostUri: string | undefined): string | null {
  if (!hostUri) {
    return null;
  }

  const host = hostUri
    .replace(/^[a-z][a-z0-9+.-]*:\/\//iu, '')
    .split('/')[0]
    .replace(/:\d+$/u, '')
    .trim();

  if (!host) {
    return null;
  }

  const isPrivate =
    host === 'localhost' ||
    /^127\./u.test(host) ||
    /^10\./u.test(host) ||
    /^192\.168\./u.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./u.test(host);

  return isPrivate ? host : null;
}

/**
 * The routing-data service runs on the same machine as the Metro dev server.
 * Reusing Metro's host means a changed DHCP lease does not leave a stale IP in
 * the bundle. Explicit env URLs still win outside development.
 */
function devRoutingDataBaseUrl(): string | null {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return null;
  }

  try {
    // Loaded lazily: expo-constants imports React Native and must not be pulled
    // into the Node test runner.
    const Constants = (
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('expo-constants') as typeof import('expo-constants')
    ).default;
    const host = privateHostFromUri(Constants.expoConfig?.hostUri);

    if (!host) {
      return null;
    }

    const configured = normalizeBaseUrl(
      process.env.EXPO_PUBLIC_ROUTING_DATA_BASE_URL,
    );
    const port = (configured && portFromUrl(configured)) ?? DEFAULT_ROUTING_DATA_PORT;

    return `http://${host}:${port}`;
  } catch {
    return null;
  }
}

/**
 * Base URL of the routing-data service. See `tools/routing-data/README.md` for
 * the backend contract. Routing downloads are disabled, not faked, when this
 * is unset.
 */
export const ROUTING_DATA_BASE_URL =
  devRoutingDataBaseUrl() ??
  normalizeBaseUrl(process.env.EXPO_PUBLIC_ROUTING_DATA_BASE_URL);

/**
 * GitHub Releases (or any static mirror) that hosts `brouter-manifest.json`,
 * the `.rd5` segment tiles and the per-5-degree `places-*.sqlite` indexes.
 * BRouter routing is disabled, not faked, when this is unset.
 */
export const BROUTER_DATA_BASE_URL = normalizeBaseUrl(
  process.env.EXPO_PUBLIC_BROUTER_DATA_BASE_URL,
);

/** BRouter release bundled in `modules/brouter-engine`. */
export const SUPPORTED_BROUTER_ENGINE_VERSION =
  process.env.EXPO_PUBLIC_BROUTER_ENGINE_VERSION?.trim() || '1.7.10';

export const BROUTER_MANIFEST_TIMEOUT_MS = 30_000;

/**
 * The Valhalla build the native adapter is compiled against. The backend must
 * generate tiles for this engine version.
 */
export const SUPPORTED_VALHALLA_ENGINE_VERSION =
  process.env.EXPO_PUBLIC_VALHALLA_ENGINE_VERSION?.trim() || '3.9.1';

/** Extra routing coverage beyond the selected map region. */
export const ROUTING_BUFFER_KM = numberFromEnv(
  process.env.EXPO_PUBLIC_ROUTING_BUFFER_KM,
  0,
);

/** Routing downloads are strongly preferred as per-file directory packages. */
export const PREFERRED_ROUTING_PACKAGE_FORMAT =
  process.env.EXPO_PUBLIC_ROUTING_PACKAGE_FORMAT === 'zip' ? 'zip' : 'directory';

export const ROUTING_MANIFEST_TIMEOUT_MS = 30_000;
export const ROUTING_BUILD_POLL_INTERVAL_MS = 5_000;
export const ROUTING_BUILD_TIMEOUT_MS = 10 * 60_000;

/** Guard against opening an unbounded ZIP in JS memory. */
export const MAX_IN_MEMORY_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

/** Free space kept untouched after a routing package is installed. */
export const MIN_FREE_STORAGE_MARGIN_BYTES = 32 * 1024 * 1024;

/**
 * Used only to show a pre-download estimate. Real progress always comes from
 * MapLibre byte counters or downloaded bytes, never from this value.
 */
export const AVERAGE_VECTOR_TILE_BYTES = 42 * 1024;
export const STYLE_RESOURCE_OVERHEAD_BYTES = 1.5 * 1024 * 1024;

export const ROUTING_DOWNLOAD_PROGRESS_THROTTLE_MS = 300;
