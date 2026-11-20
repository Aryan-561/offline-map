#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

REGION_ID=""
NAME=""
OSM=""
BOUNDS=""
RADIUS_KM=""
BUFFER_KM="2"
DATA_VERSION=""
ENGINE_VERSION="${VALHALLA_ENGINE_VERSION:-3.9.1}"
OUTPUT_ROOT="$SCRIPT_DIR/data/regions"
WORK_DIR=""
KEEP_WORK="0"

usage() {
  cat <<'USAGE'
Usage:
  build-region.sh \
    --region-id <id> \
    --osm <region.osm.pbf> \
    --bounds west,south,east,north \
    --radius-km <number> \
    --data-version <OSM/build identifier> \
    [--name <display name>] \
    [--buffer-km 2] \
    [--engine-version 3.9.1] \
    [--output-root tools/routing-data/data/regions] \
    [--work-dir <temporary build directory>] \
    [--keep-work]

Requirements:
  valhalla_build_config, valhalla_build_tiles (same engine version as the app),
  and optionally osmium for cutting the OSM extract to the coverage bbox.

The script never invents tiles. It fails if Valhalla did not produce any.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region-id) REGION_ID="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --osm) OSM="${2:-}"; shift 2 ;;
    --bounds) BOUNDS="${2:-}"; shift 2 ;;
    --radius-km) RADIUS_KM="${2:-}"; shift 2 ;;
    --buffer-km) BUFFER_KM="${2:-}"; shift 2 ;;
    --data-version) DATA_VERSION="${2:-}"; shift 2 ;;
    --engine-version) ENGINE_VERSION="${2:-}"; shift 2 ;;
    --output-root) OUTPUT_ROOT="${2:-}"; shift 2 ;;
    --work-dir) WORK_DIR="${2:-}"; shift 2 ;;
    --keep-work) KEEP_WORK="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

for required in REGION_ID OSM BOUNDS RADIUS_KM DATA_VERSION; do
  if [[ -z "${!required}" ]]; then
    echo "Missing required option for $required." >&2
    usage
    exit 2
  fi
done

if ! command -v valhalla_build_tiles >/dev/null 2>&1; then
  echo "valhalla_build_tiles was not found on PATH." >&2
  echo "Install Valhalla $ENGINE_VERSION or run this script inside a matching Valhalla container." >&2
  exit 1
fi

if ! command -v valhalla_build_config >/dev/null 2>&1; then
  echo "valhalla_build_config was not found on PATH." >&2
  exit 1
fi

if [[ ! -f "$OSM" ]]; then
  echo "OSM extract not found: $OSM" >&2
  exit 1
fi

if [[ ! "$REGION_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "region-id must be 1-128 characters of letters, digits, dot, underscore or dash." >&2
  exit 2
fi

if [[ -z "$NAME" ]]; then
  NAME="$REGION_ID"
fi

if [[ -z "$WORK_DIR" ]]; then
  WORK_DIR="$OUTPUT_ROOT/.work/$REGION_ID"
fi

PACKAGE_DIR="$OUTPUT_ROOT/$REGION_ID"
COVERAGE_BBOX="$(node "$SCRIPT_DIR/coverage.mjs" --bounds "$BOUNDS" --buffer-km "$BUFFER_KM" --format bbox)"

mkdir -p "$WORK_DIR"
EXTRACT="$WORK_DIR/region.osm.pbf"
CONFIG="$WORK_DIR/valhalla.json"

if command -v osmium >/dev/null 2>&1; then
  echo "Cutting OSM data to coverage bbox $COVERAGE_BBOX"
  osmium extract --overwrite -b "$COVERAGE_BBOX" -o "$EXTRACT" "$OSM"
else
  echo "osmium not found; building from the full OSM extract."
  cp "$OSM" "$EXTRACT"
fi

# Relative tile paths make the packaged config portable. The build runs from
# the work directory, so tiles are written to <work>/valhalla-tiles.
valhalla_build_config --mjolnir-tile-dir valhalla-tiles > "$CONFIG"

# Keep the packaged config portable and avoid referencing a separate tile
# archive that this pipeline does not produce.
node -e '
  const fs = require("node:fs");
  const file = process.argv[1];
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!config.mjolnir) throw new Error("missing mjolnir config");
  config.mjolnir.tile_dir = "valhalla-tiles";
  config.mjolnir.tile_extract = null;
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
' "$CONFIG"

echo "Building Valhalla tiles with $ENGINE_VERSION..."
(
  cd "$WORK_DIR"
  valhalla_build_tiles -c "$CONFIG" "$EXTRACT"
)

TILES="$WORK_DIR/valhalla-tiles"

if [[ ! -d "$TILES" ]] || [[ -z "$(find "$TILES" -type f -print -quit)" ]]; then
  echo "Valhalla produced no tile files in $TILES." >&2
  exit 1
fi

rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR/metadata"
cp -R "$TILES" "$PACKAGE_DIR/valhalla-tiles"
cp "$CONFIG" "$PACKAGE_DIR/metadata/valhalla.json"

if command -v osmium >/dev/null 2>&1 && node -e "require('node:sqlite')" >/dev/null 2>&1; then
  echo "Building offline place index..."
  if ! node "$SCRIPT_DIR/places.mjs" \
    --work-dir "$WORK_DIR" \
    --osm-file region.osm.pbf \
    --output "$PACKAGE_DIR/places.sqlite" \
    --local; then
    echo "Warning: offline place index was not built." >&2
    rm -f "$PACKAGE_DIR/places.sqlite"
  fi
else
  echo "osmium or node:sqlite unavailable; skipping offline place index."
fi

node "$SCRIPT_DIR/generate-manifest.mjs" \
  --region-id "$REGION_ID" \
  --name "$NAME" \
  --package-dir "$PACKAGE_DIR" \
  --bounds "$BOUNDS" \
  --radius-km "$RADIUS_KM" \
  --buffer-km "$BUFFER_KM" \
  --data-version "$DATA_VERSION" \
  --engine-version "$ENGINE_VERSION" \
  --source "$OSM"

if [[ "$KEEP_WORK" != "1" ]]; then
  rm -rf "$WORK_DIR"
fi

echo
echo "Routing package ready: $PACKAGE_DIR"
echo "Serve the $OUTPUT_ROOT directory with tools/routing-data/server.mjs or another HTTPS static host."
