import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/ui/public');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = existsSync(PUBLIC_DIR) ? walk(PUBLIC_DIR) : [];
const rel = (f: string) => relative(PUBLIC_DIR, f);
const read = (f: string) => readFileSync(f, 'utf8');

// XML namespaces are identifiers, not requests.
const ALLOWED_URLS = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink']);

describe('dashboard static files', () => {
  it('has an entry page', () => {
    expect(files.map(rel)).toContain('index.html');
  });

  it('references no remote origin (the app must work offline)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = read(file);
      for (const match of text.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'`)<]*/gi)) {
        const url = match[0];
        if (!/^https?:/.test(url) && !/(src|href|url\()\s*=?\s*["'(]?$/.test(text.slice(Math.max(0, match.index - 8), match.index))) continue;
        if (!ALLOWED_URLS.has(url)) offenders.push(`${rel(file)}: ${url}`);
      }
      expect(text, rel(file)).not.toMatch(/@import\s+url\(\s*["']?https?:/i);
    }
    expect(offenders).toEqual([]);
  });

  it('index.html only loads files that exist', () => {
    const html = read(join(PUBLIC_DIR, 'index.html'));
    const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(1);
    for (const ref of refs) {
      expect(ref.startsWith('/') || ref.includes(':'), `${ref} must be a relative path`).toBe(false);
      expect(existsSync(join(PUBLIC_DIR, ref)), ref).toBe(true);
    }
  });

  it('every module import resolves to a file', () => {
    for (const file of files.filter((f) => f.endsWith('.js'))) {
      const text = read(file);
      const specifiers = [
        ...text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm),
        ...text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
        ...text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
      ].map((m) => m[1]);
      for (const spec of specifiers) {
        expect(spec.startsWith('.'), `${rel(file)} imports "${spec}"`).toBe(true);
        expect(existsSync(resolve(dirname(file), spec)), `${rel(file)} imports "${spec}"`).toBe(true);
      }
    }
  });

  it('never assigns HTML from data (no innerHTML or document.write)', () => {
    for (const file of files.filter((f) => f.endsWith('.js'))) {
      expect(read(file), rel(file)).not.toMatch(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/);
    }
  });

  it("works under the server's Content-Security-Policy (default-src 'self')", () => {
    const html = read(join(PUBLIC_DIR, 'index.html'));
    // No inline script, inline event handler or inline style in the page.
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/<style|\sstyle\s*=/i);
    for (const file of files.filter((f) => f.endsWith('.js'))) {
      // No code from strings, and no style attributes written from script.
      expect(read(file), rel(file)).not.toMatch(/\beval\(|new Function\(|\bstyle:|\.style\.|setAttribute\('style'/);
    }
  });

  it('uses no path the server refuses to serve (dotfiles, a "server" folder)', () => {
    for (const path of files.map(rel)) {
      const parts = path.split(/[\\/]/);
      expect(parts.some((part) => part.startsWith('.')), path).toBe(false);
      expect(parts[0], path).not.toBe('server');
    }
  });

  it('keeps every file small and readable', () => {
    for (const file of files) {
      expect(read(file).split('\n').length, rel(file)).toBeLessThanOrEqual(600);
    }
  });

  it('declares English and a viewport', () => {
    const html = read(join(PUBLIC_DIR, 'index.html'));
    expect(html).toMatch(/<html lang="en"/);
    expect(html).toMatch(/name="viewport"/);
  });
});
