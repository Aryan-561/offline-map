import { OfflineRegionsError } from '../types/offlineRegion.types';

const MAX_PATH_LENGTH = 512;
const MAX_SEGMENTS = 32;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Validates a package-relative path and returns its segments.
 *
 * Rejects absolute paths, drive letters, backslashes, empty segments, `.`/`..`
 * traversal, NUL bytes and URL-encoded traversal sequences. Extraction code
 * must use the returned segments with `new File(root, ...segments)` so the
 * final path stays inside the staging directory.
 */
export function normalizePackagePath(input: string): string[] {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_PATH_LENGTH) {
    throw new OfflineRegionsError('routing_extraction', 'The package contains an invalid file path.');
  }

  if (input.includes('\0') || input.includes('\\')) {
    throw new OfflineRegionsError(
      'routing_extraction',
      'The package contains an unsafe file path (backslash or NUL byte).',
    );
  }

  let decoded = input;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    throw new OfflineRegionsError(
      'routing_extraction',
      'The package contains an unreadable file path.',
    );
  }

  if (decoded.includes('\0') || decoded.includes('\\') || decoded !== input) {
    // Reject any encoding tricks rather than trying to normalize them.
    throw new OfflineRegionsError(
      'routing_extraction',
      'The package contains an unsafe encoded file path.',
    );
  }

  if (decoded.startsWith('/') || /^[a-zA-Z]:/.test(decoded)) {
    throw new OfflineRegionsError(
      'routing_extraction',
      'The package contains an absolute file path.',
    );
  }

  const segments = decoded.split('/');

  if (
    segments.length === 0 ||
    segments.length > MAX_SEGMENTS ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        segment.includes(':') ||
        segment.includes('\0'),
    )
  ) {
    throw new OfflineRegionsError(
      'routing_extraction',
      'The package contains a path traversal attempt.',
    );
  }

  return segments;
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}
