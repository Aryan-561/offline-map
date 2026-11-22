#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { MANIFEST_FILE, readManifest } from './manifest.mjs';

const DEFAULT_DATA_DIR = path.join('tools', 'brouter-data', 'data');
const DEFAULT_TAG = 'brouter-data';

function run(command, args, { log = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    log(`$ ${command} ${args.join(' ')}`);
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} exited with code ${code}${
            stderr.trim() ? `: ${stderr.trim().split('\n').slice(-3).join(' ')}` : ''
          }`,
        ),
      );
    });
  });
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function uploadRelease({
  dataDir = DEFAULT_DATA_DIR,
  repo,
  tag = DEFAULT_TAG,
  gh = 'gh',
  dryRun = false,
  log = () => {},
}) {
  const manifestPath = path.join(dataDir, MANIFEST_FILE);
  const manifest = await readManifest(manifestPath);

  if (!manifest) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const files = [manifestPath];

  for (const tile of manifest.segments.tiles) {
    const file = path.join(dataDir, 'segments4', tile.file);
    if (await exists(file)) files.push(file);
  }

  for (const tile of manifest.places.tiles) {
    const file = path.join(dataDir, 'places', tile.file);
    if (await exists(file)) files.push(file);
  }

  const repoArgs = repo ? ['--repo', repo] : [];

  if (dryRun) {
    log(`Would upload ${files.length} files to ${tag}:`);
    for (const file of files) log(`  ${file}`);
    return;
  }

  try {
    await run(gh, ['release', 'view', tag, ...repoArgs], { log });
  } catch {
    await run(
      gh,
      [
        'release',
        'create',
        tag,
        ...repoArgs,
        '--title',
        'BRouter offline data',
        '--notes',
        'Mirrored BRouter .rd5 segments and per-tile place indexes.',
      ],
      { log },
    );
  }

  await run(gh, ['release', 'upload', tag, ...files, '--clobber', ...repoArgs], { log });

  log(`Published ${files.length} files to release ${tag}.`);
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  uploadRelease({
    dataDir: option('--data-dir', DEFAULT_DATA_DIR),
    repo: option('--repo', process.env.GH_REPO),
    tag: option('--tag', process.env.BROUTER_RELEASE_TAG ?? DEFAULT_TAG),
    dryRun: process.argv.includes('--dry-run'),
    log: (message) => console.log(message),
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
