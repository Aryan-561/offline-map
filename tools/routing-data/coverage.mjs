#!/usr/bin/env node
import { formatBbox, expandBounds, parseBounds } from './lib.mjs';

function usage() {
  console.error(
    'Usage: coverage.mjs --bounds west,south,east,north [--buffer-km 2] [--format json|bbox]',
  );
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const rawBounds = argument('--bounds');
const bufferKm = Number(argument('--buffer-km', '2'));
const format = argument('--format', 'json');

if (!rawBounds) {
  usage();
  process.exit(2);
}

try {
  const bounds = parseBounds(rawBounds);
  const coverage = expandBounds(bounds, bufferKm);

  if (format === 'bbox') {
    process.stdout.write(`${formatBbox(coverage)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(coverage, null, 2)}\n`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
