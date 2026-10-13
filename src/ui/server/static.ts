import { readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, sep } from 'node:path';

/**
 * Static files of the dashboard, confined to one directory (`dist/ui/`).
 *
 * A request path is decoded once and then checked segment by segment before
 * it touches the disk; the real path of the file must still be inside the
 * real path of the directory, so a symlink cannot lead out of it. Directories
 * are never listed.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** A dashboard asset is small; anything larger is not ours to serve. */
const MAX_STATIC_BYTES = 10 * 1024 * 1024;

/**
 * `dist/ui/server/` holds the compiled code of this server next to the copied
 * frontend; it is not part of the page.
 */
const RESERVED_TOP_LEVEL = new Set(['server']);

export type StaticResult =
  | { status: 200; contentType: string; body: Buffer }
  | { status: 400 | 404; message: string };

const notFound: StaticResult = { status: 404, message: 'Not found' };

/** The file a request path (without the query string) names, or why there is none. */
export function resolveStaticFile(staticDir: string, rawPath: string): StaticResult {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { status: 400, message: 'Malformed path' };
  }
  if (decoded.includes('\0')) return { status: 400, message: 'Malformed path' };
  if (!decoded.startsWith('/') || decoded.includes('\\')) return notFound;

  const segments = decoded === '/' ? ['index.html'] : decoded.slice(1).split('/');
  for (const segment of segments) {
    // Empty (`//x`, a trailing slash), `.`/`..`, dotfiles and drive or stream names (`c:`) are never served.
    if (segment.length === 0 || segment.startsWith('.') || segment.includes(':')) return notFound;
  }
  if (RESERVED_TOP_LEVEL.has(segments[0])) return notFound;

  try {
    const realDir = realpathSync(staticDir);
    const realFile = realpathSync(join(realDir, ...segments));
    if (!realFile.startsWith(realDir + sep)) return notFound;
    const stat = statSync(realFile);
    if (!stat.isFile() || stat.size > MAX_STATIC_BYTES) return notFound;
    return {
      status: 200,
      contentType: CONTENT_TYPES[extname(realFile).toLowerCase()] ?? 'application/octet-stream',
      body: readFileSync(realFile),
    };
  } catch {
    return notFound; // missing, unreadable, or the directory itself is missing
  }
}
