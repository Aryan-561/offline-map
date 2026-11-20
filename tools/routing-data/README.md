# Offline routing data

The app downloads two independent datasets for each offline region:

1. A MapLibre offline pack for rendering the map.
2. A Valhalla routing package for on-device route calculation.

This directory contains the data-preparation side of the second dataset. It
does **not** contain fake tiles, generated routes, or a JavaScript routing
engine. If a package cannot be built or served, the app reports the failure and
does not silently fall back to online routing.

When the app downloads a combined region, it requests its routing package at
the same time as the MapLibre map pack. The reference server can either adopt
an existing prebuilt package or build the missing package from a configured OSM
extract. On-demand builds are enabled by default.

## Native Valhalla module

The mobile app keeps a clear adapter boundary at
`src/features/navigation/services/localValhallaAdapter.ts`. The Android
development build registers a bridge backed by
[`Rallista/valhalla-mobile`](https://github.com/Rallista/valhalla-mobile) 0.6.4,
which embeds **Valhalla 3.9.1**.

- The local Expo module lives in `modules/valhalla-engine`.
- It loads the installed `valhalla-tiles/` directory with
  `ValhallaConfigFactory.usingTilesDir(...)`.
- Route requests go through `routeRaw(...)` and are parsed by the existing
  navigation response parser.
- The downloaded `metadata/valhalla.json` is not used directly because its
  `tile_dir` is relative. The native module builds an absolute, per-region
  config instead.
- Expo Go, web, and platforms without the module report
  `isLocalValhallaAvailable() === false`; they never fall back to an online
  router.

iOS is not wired yet: it requires macOS, `expo prebuild`, pods, and a Swift
wrapper around the valhalla-mobile SPM product (iOS 16.4+).

A region is marked navigation-ready only when its map and routing data are
installed and checksum-verified **and** a native bridge is registered. Actual
offline routing still must be verified on a physical device with the network
disabled; downloading and verifying data alone is not sufficient.

The bridge must use the installed package's tiles locally. It must not proxy the
request to a remote Valhalla server.

## Backend contract

Set `EXPO_PUBLIC_ROUTING_DATA_BASE_URL` to the base URL of the service. The app
calls:

### `GET /regions`

Optional discovery endpoint implemented by the reference server. It returns
summaries of every prebuilt package:

```json
{
  "regions": [
    {
      "regionId": "region_mabc123_x1y2z3",
      "regionName": "Home area",
      "bounds": { "west": -122.54, "south": 37.68, "east": -122.3, "north": 37.87 },
      "coverageBounds": { "west": -122.56, "south": 37.66, "east": -122.28, "north": 37.89 },
      "radiusKm": 10,
      "packageFormat": "directory",
      "valhallaDataVersion": "osm-2026-11-01",
      "valhallaEngineVersion": "3.9.1",
      "valhallaEngineCompatibility": ">=3.9.1 <3.10.0",
      "downloadSizeBytes": 73400320,
      "createdAt": "2026-11-14T12:00:00.000Z",
      "manifestUrl": "/packages/region_mabc123_x1y2z3/manifest.json"
    }
  ]
}
```

The mobile client does not require this endpoint; it is for operators and
future region catalogs.

### `POST /packages`

Request body:

```json
{
  "regionId": "region_mabc123_x1y2z3",
  "regionName": "Home area",
  "center": { "latitude": 37.7749, "longitude": -122.4194 },
  "radiusKm": 10,
  "bounds": { "west": -122.54, "south": 37.68, "east": -122.3, "north": 37.87 },
  "bufferKm": 0,
  "packageFormat": "directory",
  "valhallaEngineVersion": "3.9.1"
}
```

Responses:

- `200` with a complete manifest. Download may start immediately.
- `202` while building:

```json
{
  "status": "building",
  "regionId": "region_mabc123_x1y2z3",
  "estimatedSizeBytes": 73400320,
  "retryAfterSeconds": 15
}
```

The app polls `GET /packages/{regionId}`. The package must cover the requested
bounds plus `bufferKm`; the client rejects manifests that do not. Set
`bufferKm` to `0` to make routing coverage exactly match the map boundary.

The reference server rejects an unsupported `packageFormat` and an engine
version whose major/minor does not match `VALHALLA_ENGINE_VERSION` (default
`3.9.1`). It returns `501` for ZIP requests because this server only produces
directory packages; set `EXPO_PUBLIC_ROUTING_PACKAGE_FORMAT=directory` for local
development.

### `POST /packages/estimate`

Same request shape. Return:

```json
{
  "estimatedSizeBytes": 73400320,
  "coverageBounds": { "west": -122.56, "south": 37.66, "east": -122.28, "north": 37.89 },
  "valhallaDataVersion": "osm-2026-11-01",
  "valhallaEngineVersion": "3.9.1"
}
```

`estimatedSizeBytes` may be `null` if the package has not been built. It is only
a pre-download estimate; the real manifest size and per-file checksums are
authoritative.

### `GET /packages/{regionId}`

Returns `200` with the manifest, `202` with the building payload, or `404`.

### `GET /packages/{regionId}/manifest.json`

Static manifest. Relative `files[].url` values are resolved against this URL.

### Package files

`GET /packages/{regionId}/<path>` serves the files listed in the manifest.

## Manifest schema

Directory packages are preferred because the app can verify and resume each
file without loading an archive into JS memory.

```json
{
  "schemaVersion": 1,
  "packageFormat": "directory",
  "regionId": "region_mabc123_x1y2z3",
  "regionName": "Home area",
  "bounds": { "west": -122.54, "south": 37.68, "east": -122.3, "north": 37.87 },
  "coverageBounds": { "west": -122.56, "south": 37.66, "east": -122.28, "north": 37.89 },
  "radiusKm": 10,
  "bufferKm": 0,
  "valhallaDataVersion": "osm-2026-11-01",
  "valhallaEngineVersion": "3.9.1",
  "valhallaEngineCompatibility": ">=3.9.1 <3.10.0",
  "createdAt": "2026-11-14T12:00:00.000Z",
  "downloadSizeBytes": 73400320,
  "files": [
    {
      "path": "valhalla-tiles/2/000/123/456.gph",
      "url": "valhalla-tiles/2/000/123/456.gph",
      "sizeBytes": 123456,
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
  ],
  "metadata": {
    "generatedBy": "tools/routing-data/generate-manifest.mjs",
    "fileCount": 1,
    "source": "geofabrik/california-latest.osm.pbf"
  }
}
```

Rules enforced by the app:

- `schemaVersion` is `1`.
- `packageFormat` is `"directory"` or `"zip"`.
- `coverageBounds` contains the requested bounds (small floating-point tolerance).
- `radiusKm` and `bufferKm` are finite and non-negative.
- `downloadSizeBytes` is positive. For directory packages it must equal the sum
  of file sizes.
- Every path is relative, has no `..`, backslash, NUL, drive letter, or encoded
  traversal segment.
- Every SHA-256 is 64 lowercase hexadecimal characters.
- `valhallaEngineVersion` matches the app's supported engine, or the optional
  `valhallaEngineCompatibility` range is satisfied.
- `manifest.json` itself is not listed in `files`.

ZIP packages are supported for interoperability but the client refuses archives
larger than 128 MiB because extraction currently happens in JS memory. Prefer
directory packages.

The on-demand builder also writes an optional `places.sqlite` FTS5 index of
named OpenStreetMap features (nodes and ways) for offline place-name search. It
is a normal package file, so it is checksummed, downloaded and verified like the
Valhalla tiles. If the index is missing or fails to build, routing still works
and the app falls back to the online geocoder.

The app only searches regions whose installed routing package includes
`places.sqlite`. If a package was built before the index existed, backfill just
the index instead of rebuilding its Valhalla tiles:

```bash
bun run routing-data:backfill --region-id <region-id>
# or every prebuilt package under data/regions:
bun run routing-data:backfill
```

The backfill script clips the configured OSM extract to each package's
`coverageBounds`, builds `places.sqlite`, adds it to `manifest.json`, and
recomputes `downloadSizeBytes`. It uses the same `stefda/osmium-tool` Docker
image as the builder by default; pass `--local` to use `osmium` from `PATH`, or
`--dry-run` to validate without modifying packages. `--force` rebuilds an
existing index.

After backfilling, restart the routing-data server and re-download the affected
regions in the app. Installed copies are not updated in place, because the app
verifies each installed package against the manifest it downloaded with.

To build the index manually, run the same commands used by
`buildPlacesIndex` in `places.mjs`:

```bash
osmium tags-filter region.osm.pbf n/name w/name -o places.osm.pbf --overwrite
osmium export places.osm.pbf -f geojsonseq -o places.geojson --overwrite
node tools/routing-data/places.mjs \
  --work-dir <workdir> \
  --output <package-dir>/places.sqlite \
  --local
```

## Build a package

Prerequisites:

- Valhalla command-line tools **matching the app's engine version**:
  `valhalla_build_config`, `valhalla_build_tiles`.
- Docker, if you use the server's on-demand builder. The default images are
  `stefda/osmium-tool` and `ghcr.io/valhalla/valhalla:3.9.1`.
- An OSM `.osm.pbf` extract. Geofabrik publishes regional extracts.
- Optional: `osmium` to cut the OSM extract to the coverage bbox before tile
  build.

Set the engine version consistently:

```bash
export VALHALLA_ENGINE_VERSION=3.9.1
export EXPO_PUBLIC_VALHALLA_ENGINE_VERSION=3.9.1
```

Then build:

```bash
tools/routing-data/build-region.sh \
  --region-id region_example_home \
  --name "Home area" \
  --osm /data/california-latest.osm.pbf \
  --bounds "-122.54,37.68,-122.30,37.87" \
  --radius-km 10 \
  --buffer-km 0 \
  --data-version "osm-2026-11-01" \
  --engine-version 3.9.1
```

The script:

1. Expands the requested bounds by `bufferKm` (same formula as the app).
2. Optionally cuts the OSM extract to that bbox with `osmium`.
3. Runs `valhalla_build_tiles` with a config whose tile directory is
   `valhalla-tiles`.
4. Copies `valhalla-tiles/` and `metadata/valhalla.json` into
   `tools/routing-data/data/regions/{regionId}/`.
5. Builds `places.sqlite` when `osmium` is available. A failure here is logged
   and does not fail the routing package.
6. Hashes every file and writes `manifest.json`.

It fails if Valhalla produced no tile files. It never inserts placeholder
tiles.

If your Valhalla tools are inside a container, run the same script with the
data directories mounted and the container's `PATH` containing the Valhalla
binaries. Use an image tag that matches `VALHALLA_ENGINE_VERSION`; do not mix
tile output from one Valhalla version with a native engine from another.

The generated `metadata/valhalla.json` uses portable relative tile paths. A
native bridge may still need to rewrite paths for its own working directory; the
adapter passes both `tilePath` and `configPath` explicitly.

## Serve a package for development

```bash
bun run routing-data
```

`bun run routing-data` loads `tools/routing-data/.env` when present. Use it for
machine-specific settings such as `DOCKER_HOST` and a smaller regional
`ROUTING_OSM_SOURCE_URL`; on-demand builds download that extract once and reuse
it for later regions.

Then point the app at it:

```bash
EXPO_PUBLIC_ROUTING_DATA_BASE_URL=http://<LAN-IP>:8787 bunx expo start
```

The service binds to all network interfaces by default so a physical device
can reach it over the LAN. Set `HOST=127.0.0.1` only when testing from the same
computer. The app cannot reach a service bound only to `localhost`.

For Android, cleartext HTTP may be blocked by the release/development network
security configuration. Use HTTPS (for example a tunnel) or configure
development-only cleartext traffic deliberately.

The server adopts an existing package automatically when its coverage contains
the requested bounds and its radius is large enough. Set
`ROUTING_DATA_ADOPT_PREBUILT=0` to disable this behavior.

If no matching package exists, the server builds one on demand. Set
`ROUTING_BUILD_ON_DEMAND=0` to disable this and return an explicit error
instead.

## On-demand package builds

The server builds a package when no prebuilt package covers the requested
region. Builds run one at a time in a background queue. The app receives `202`
while the build is running and starts the routing download as soon as the
manifest appears.

```bash
DOCKER_HOST=unix:///var/run/docker.sock \
ROUTING_DATA_ADOPT_PREBUILT=1 \
ROUTING_OSM_SOURCE_URL=https://download.openstreetmap.fr/extracts/asia/india-latest.osm.pbf \
node tools/routing-data/server.mjs
```

Choose an OSM source with one of:

- `ROUTING_OSM_EXTRACT=/path/to/extract.osm.pbf` for a local extract.
- `ROUTING_OSM_SOURCE_URL=https://.../extract.osm.pbf` for a downloaded extract.
  The server caches it under `data/sources/`.
- `ROUTING_OSM_SOURCES='[{"url":"https://...","bounds":[west,south,east,north]}]'`
  to configure multiple sources. The smallest source containing the requested
  bounds is used. An entry without `bounds` acts as a fallback.

If none of those variables is set, the server defaults to the India extract
from openstreetmap.fr. The first build may take several minutes because the
extract is downloaded once; later builds reuse the cached file.

The builder clips the extract to the requested coverage, runs
`valhalla_build_tiles` inside the matching Valhalla image, writes a verified
manifest, and atomically installs the package under `data/regions/`. It fails
without creating a package if Valhalla produces no tiles.

Useful builder overrides:

- `ROUTING_OSMIUM_IMAGE` (default `stefda/osmium-tool`)
- `ROUTING_VALHALLA_IMAGE` (default `ghcr.io/valhalla/valhalla:3.9.1`)
- `ROUTING_DOCKER_BIN` (default `docker`)
- `ROUTING_KEEP_BUILD_WORK=1` to keep the temporary work directory for debugging.

On-demand builds trust the configured extract. Do not enable them on a public
server without authentication and resource limits.

## Verification checklist

Do not mark offline routing as complete until all of these are true on a
physical device:

1. Both map and routing datasets show `completed`.
2. The routing manifest was engine-compatible and every file hash matched.
3. A native Valhalla bridge is registered and loaded the installed tiles.
4. Enable airplane mode / disconnect Wi-Fi and mobile data.
5. Calculate a route entirely inside the installed coverage area.
6. Confirm the route result came from the local engine (no HTTP request to the
   online Valhalla endpoint).

Until step 3 exists, the app is intentionally limited to downloading and
verifying data, not offline route calculation.
