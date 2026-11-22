# BRouter offline data

Builds and publishes the data used by the Android BRouter engine:

- `segments4/<tile>.rd5`: public BRouter 5 x 5 degree routing segments.
- `places/places-<tile>.sqlite`: FTS5 place index for the same tile.
- `brouter-manifest.json`: sizes, SHA-256 digests and relative asset URLs.

The app downloads these assets from a GitHub Release. No routing server is
involved at runtime.

## Size warning

BRouter tiles are 5 x 5 degrees. A single tile is roughly 50-250 MB, even when
the selected map region is only a few kilometres wide. Mirror only the tiles in
`mirror.json`; mirroring the planet is not practical.

## Configure

```bash
cp tools/brouter-data/.env.example tools/brouter-data/.env
```

Set `GH_REPO` to the repository that hosts the release, then edit
`tools/brouter-data/mirror.json`:

```json
{
  "tiles": ["E75_N25"]
}
```

## Mirror segments

```bash
bun run brouter-data:mirror
```

Downloads the configured `.rd5` files from
`https://brouter.de/brouter/segments4/`, verifies they are not HTML error pages,
and writes `tools/brouter-data/data/brouter-manifest.json`.

Use `--tiles E75_N25,E70_N25` to override the configured list, or
`--concurrency` to change parallel downloads.

## Build place indexes

Place indexes are built from an OSM PBF that covers the configured tiles:

```bash
bun run brouter-data:places -- --osm /path/to/extract.osm.pbf
```

The command extracts each tile with `osmium` (Docker by default, or `--local`),
runs `osmium tags-filter`/`export`, and writes an FTS5 database. Empty tiles are
skipped; pass `--fail-on-empty` to treat them as errors.

## Publish to GitHub Releases

```bash
bun run brouter-data:upload -- --repo owner/repo --tag brouter-data
```

The command creates the release if needed and uploads the manifest plus every
asset referenced by it. Use `--dry-run` to list the files first.

Finally, point the app at the release download base:

```bash
EXPO_PUBLIC_BROUTER_DATA_BASE_URL=https://github.com/owner/repo/releases/download/brouter-data
```

## Manifest

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-21T00:00:00.000Z",
  "source": "https://brouter.de/brouter/segments4",
  "segments": {
    "source": "https://brouter.de/brouter/segments4",
    "tiles": [
      {
        "name": "E75_N25",
        "file": "E75_N25.rd5",
        "url": "E75_N25.rd5",
        "sizeBytes": 50860825,
        "sha256": "..."
      }
    ]
  },
  "places": {
    "tiles": [
      {
        "name": "E75_N25",
        "file": "places-E75_N25.sqlite",
        "url": "places-E75_N25.sqlite",
        "entries": 12345,
        "sizeBytes": 1234567,
        "sha256": "..."
      }
    ]
  },
  "profiles": { "version": null, "files": [] }
}
```

## License

BRouter is MIT licensed. Keep its `LICENSE` and attribution with the vendored
engine sources in `modules/brouter-engine/`.
