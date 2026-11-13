import { MAP_STYLE_URL } from '@/constants/map';

import {
  OfflineMapsError,
  type StyleCapabilities,
} from '../types/offlineMap';

type StyleSource = {
  type?: string;
  url?: string;
  tiles?: string[];
  minzoom?: number;
  maxzoom?: number;
  data?: unknown;
};

type StyleLayer = {
  id?: string;
  source?: string;
  layout?: {
    'text-font'?: string[];
  };
};

type StyleDocument = {
  version?: number;
  glyphs?: string;
  sprite?: string | { id?: string; url?: string }[];
  sources?: Record<string, StyleSource>;
  layers?: StyleLayer[];
};

type TileJson = {
  minzoom?: number;
  maxzoom?: number;
  tiles?: string[];
};

const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MIN_ZOOM = 0;
const DEFAULT_MAX_ZOOM = 22;

let cachedCapabilities: StyleCapabilities | null = null;

export async function getStyleCapabilities(
  options: { force?: boolean } = {},
): Promise<StyleCapabilities> {
  if (cachedCapabilities && !options.force) {
    return cachedCapabilities;
  }

  const style = await fetchJson<StyleDocument>(MAP_STYLE_URL);

  if (style.version !== 8) {
    throw new OfflineMapsError(
      'style_resources',
      'The map style is not a valid MapLibre style (version 8 is required).',
    );
  }

  const layers = Array.isArray(style.layers) ? style.layers : [];
  const sources = style.sources ?? {};
  const sourceIds = Object.keys(sources);

  if (sourceIds.length === 0 || layers.length === 0) {
    throw new OfflineMapsError(
      'style_resources',
      'The map style has no sources or layers and cannot be downloaded.',
    );
  }

  for (const layer of layers) {
    if (layer.source && !sources[layer.source]) {
      throw new OfflineMapsError(
        'style_resources',
        `Layer "${layer.id ?? 'unknown'}" references missing source "${layer.source}".`,
      );
    }
  }

  let minZoom = Number.POSITIVE_INFINITY;
  let maxZoom = Number.NEGATIVE_INFINITY;
  const warnings: string[] = [];

  for (const [id, source] of Object.entries(sources)) {
    if (!source || typeof source !== 'object') {
      continue;
    }

    if (source.type === 'geojson') {
      if (typeof source.data === 'string') {
        await fetchResource(source.data, `GeoJSON source "${id}"`);
      }
      continue;
    }

    if (source.type === 'video') {
      throw new OfflineMapsError(
        'style_resources',
        `Video source "${id}" cannot be used offline.`,
      );
    }

    if (source.type === 'image') {
      warnings.push(`Image source "${id}" may not be available offline.`);
      continue;
    }

    if (source.type !== 'vector' && source.type !== 'raster' && source.type !== 'raster-dem') {
      warnings.push(`Unknown source type "${source.type ?? 'none'}" for "${id}".`);
      continue;
    }

    const sourceZoom = await resolveSourceZoom(source, id);
    minZoom = Math.min(minZoom, sourceZoom.minZoom);
    maxZoom = Math.max(maxZoom, sourceZoom.maxZoom);
  }

  if (!Number.isFinite(minZoom) || !Number.isFinite(maxZoom)) {
    throw new OfflineMapsError(
      'style_resources',
      'The map style does not contain a downloadable tile source.',
    );
  }

  const hasGlyphs = typeof style.glyphs === 'string' && style.glyphs.length > 0;
  const hasSprite =
    (typeof style.sprite === 'string' && style.sprite.length > 0) ||
    (Array.isArray(style.sprite) && style.sprite.length > 0);

  if (hasGlyphs) {
    await validateGlyphs(style.glyphs as string, layers);
  } else {
    warnings.push('This style does not declare glyphs, so map labels will not render.');
  }

  if (hasSprite) {
    await validateSprites(style.sprite);
  }

  cachedCapabilities = {
    styleUrl: MAP_STYLE_URL,
    minZoom: Math.max(DEFAULT_MIN_ZOOM, Math.floor(minZoom)),
    maxZoom: Math.min(DEFAULT_MAX_ZOOM, Math.floor(maxZoom)),
    hasGlyphs,
    hasSprite,
    warnings,
  };

  return cachedCapabilities;
}

export async function checkOnline(): Promise<boolean> {
  try {
    const response = await request(MAP_STYLE_URL, { method: 'HEAD' });

    if (response.ok) {
      return true;
    }

    const fallback = await request(MAP_STYLE_URL, { method: 'GET' });
    return fallback.ok;
  } catch {
    return false;
  }
}

async function resolveSourceZoom(
  source: StyleSource,
  sourceId: string,
): Promise<{ minZoom: number; maxZoom: number }> {
  if (source.url) {
    const tileJson = await fetchJson<TileJson>(source.url);
    assertTileTemplates(tileJson.tiles, sourceId);

    return {
      minZoom: numberOr(tileJson.minzoom, numberOr(source.minzoom, DEFAULT_MIN_ZOOM)),
      maxZoom: numberOr(tileJson.maxzoom, numberOr(source.maxzoom, DEFAULT_MAX_ZOOM)),
    };
  }

  assertTileTemplates(source.tiles, sourceId);

  return {
    minZoom: numberOr(source.minzoom, DEFAULT_MIN_ZOOM),
    maxZoom: numberOr(source.maxzoom, DEFAULT_MAX_ZOOM),
  };
}

function assertTileTemplates(tiles: string[] | undefined, sourceId: string): void {
  if (!Array.isArray(tiles) || tiles.length === 0) {
    throw new OfflineMapsError(
      'style_resources',
      `Source "${sourceId}" does not provide downloadable tiles.`,
    );
  }

  const invalid = tiles.find((tile) => typeof tile !== 'string' || !tile.includes('{z}'));
  if (invalid !== undefined) {
    throw new OfflineMapsError(
      'style_resources',
      `Source "${sourceId}" has an invalid tile URL template.`,
    );
  }
}

async function validateGlyphs(glyphs: string, layers: StyleLayer[]): Promise<void> {
  if (!glyphs.includes('{fontstack}') || !glyphs.includes('{range}')) {
    throw new OfflineMapsError(
      'style_resources',
      'The style glyph URL does not contain the required {fontstack} and {range} placeholders.',
    );
  }

  const font =
    layers
      .map((layer) => layer.layout?.['text-font'])
      .find((fonts): fonts is string[] => Array.isArray(fonts) && fonts.length > 0) ??
    ['Open Sans Regular'];

  const url = glyphs
    .replace('{fontstack}', encodeURIComponent(font.join(',')))
    .replace('{range}', '0-255');

  const response = await request(url);

  if (!response.ok) {
    throw new OfflineMapsError(
      'style_resources',
      `Map fonts are unavailable (HTTP ${response.status}). The region cannot render labels offline.`,
    );
  }
}

async function validateSprites(sprite: StyleDocument['sprite']): Promise<void> {
  const spriteUrls =
    typeof sprite === 'string'
      ? [sprite]
      : Array.isArray(sprite)
        ? sprite.map((entry) => entry.url).filter((url): url is string => typeof url === 'string')
        : [];

  for (const spriteUrl of spriteUrls) {
    const jsonUrl = spriteUrl.endsWith('.json') ? spriteUrl : `${spriteUrl}.json`;
    const response = await request(jsonUrl);

    if (!response.ok) {
      throw new OfflineMapsError(
        'style_resources',
        `Map sprites are unavailable (HTTP ${response.status}). The region cannot render icons offline.`,
      );
    }
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await request(url);

  if (!response.ok) {
    throw new OfflineMapsError(
      'style_resources',
      `Map resource request failed (HTTP ${response.status}): ${url}`,
    );
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new OfflineMapsError('style_resources', `Map resource is not valid JSON: ${url}`, {
      cause: error,
    });
  }
}

async function fetchResource(url: string, label: string): Promise<void> {
  const response = await request(url);

  if (!response.ok) {
    throw new OfflineMapsError(
      'style_resources',
      `${label} is unavailable (HTTP ${response.status}).`,
    );
  }
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } catch (error) {
    throw new OfflineMapsError(
      'offline',
      'No internet connection. Connect to the internet before downloading map data.',
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
