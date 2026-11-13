/**
 * Map style used by both the interactive map and the offline downloader.
 * Offline packs are stored against this URL, so the map must keep using the
 * same URL when the downloaded region is opened without a connection.
 *
 * Do not use the MapLibre demotiles style here: its glyph URLs are hosted on
 * the same domain as MapLibre's default tile server, which triggers a native
 * regex crash while preparing offline packs on Android.
 */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export const DEFAULT_ZOOM = 14;

/** Maximum latitude supported by the Web Mercator projection. */
export const MAX_MERCATOR_LATITUDE = 85.05112878;
