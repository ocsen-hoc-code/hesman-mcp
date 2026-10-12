/**
 * Generates `grammars.json`, the manifest shipped in the npm package (M1-05,
 * ADR 0001 section 4.1): every grammar Hesman may load, pinned by URL, sha256,
 * size and ABI, with its source and license.
 *
 * - Bundled entries come from `PARSERS` (URL, sha256), the committed files in
 *   `parsers/` (size, ABI read by loading them), the language registry (id,
 *   extensions, tags queries) and `NOTICE` (commit, license).
 * - On-demand entries come from `scripts/grammar-catalog.ts`.
 *
 * Run `npx tsx scripts/generate-grammar-manifest.ts` after changing any of
 * those; a unit test fails while the committed file is out of date. The script
 * never uses the network.
 */
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser } from 'web-tree-sitter';
import { LANGUAGES } from '../src/parsers/languages.js';
import type { GrammarEntry, GrammarManifest } from '../src/parsers/grammar-store.js';
import { PARSERS } from './download-parsers.js';
import { ON_DEMAND_GRAMMARS, releaseAssetUrl } from './grammar-catalog.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const MANIFEST_FILE = join(ROOT, 'grammars.json');

/** ABI range of the pinned `web-tree-sitter` 0.25.10 (ADR 0001, sections 6 and 10). */
export const RUNTIME_ABI = { min: 13, max: 15 } as const;

/** `parsers/<file>` -> the commit and license recorded for it in NOTICE. */
function bundledAttribution(): Map<string, { commit: string; license: string }> {
  const notice = readFileSync(join(ROOT, 'NOTICE'), 'utf-8');
  const found = new Map<string, { commit: string; license: string }>();
  const block = /^parsers\/(\S+\.wasm)\n {2}Repository: \S+\n {2}Revision: +\S+ \(([0-9a-f]{40})\)\n {2}License: +(\S+)$/gm;
  for (const match of notice.matchAll(block)) found.set(match[1], { commit: match[2], license: match[3] });
  return found;
}

function tagsPaths(tagsQuery: string | readonly string[] | undefined): string[] {
  if (tagsQuery === undefined) return [];
  return (typeof tagsQuery === 'string' ? [tagsQuery] : [...tagsQuery]).map((path) => `queries/${path}`);
}

export async function buildManifest(): Promise<GrammarManifest> {
  await Parser.init();
  const attribution = bundledAttribution();
  const grammars: Record<string, GrammarEntry> = {};

  for (const def of LANGUAGES) {
    const pinned = PARSERS.find((parser) => parser.name === def.grammar);
    const release = pinned && /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/releases\/download\/([^/]+)\//.exec(pinned.url);
    const credit = attribution.get(def.grammar);
    if (!pinned || !release || !credit) {
      throw new Error(`${def.id}: ${def.grammar} must be pinned in scripts/download-parsers.ts and attributed in NOTICE`);
    }
    const file = join(ROOT, 'parsers', def.grammar);
    const language = await Language.load(file);
    grammars[def.id] = {
      bundled: true,
      file: def.grammar,
      url: pinned.url,
      sha256: pinned.sha256,
      bytes: statSync(file).size,
      abi: language.abiVersion,
      source: { repo: release[1], rev: decodeURIComponent(release[2]), commit: credit.commit, license: credit.license },
      extensions: [...def.extensions],
      queries: { tags: tagsPaths(def.tagsQuery) },
    };
  }

  for (const spec of ON_DEMAND_GRAMMARS) {
    if (grammars[spec.id]) throw new Error(`Duplicate grammar id: ${spec.id}`);
    if ((spec.tags === undefined) !== (spec.extensions === undefined)) {
      throw new Error(`${spec.id}: "tags" and "extensions" go together`);
    }
    grammars[spec.id] = {
      bundled: false,
      file: spec.file,
      url: releaseAssetUrl(spec),
      sha256: spec.sha256,
      bytes: spec.bytes,
      abi: spec.abi,
      source: { repo: spec.repo, rev: spec.rev, commit: spec.commit, license: spec.license },
      ...(spec.extensions ? { extensions: [...spec.extensions] } : {}),
      ...(spec.tags ? { queries: { tags: tagsPaths(spec.tags) } } : {}),
    };
  }

  return { abi: { ...RUNTIME_ABI }, grammars };
}

export function renderManifest(manifest: GrammarManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  buildManifest()
    .then((manifest) => {
      writeFileSync(MANIFEST_FILE, renderManifest(manifest));
      const entries = Object.values(manifest.grammars);
      const onDemand = entries.filter((entry) => !entry.bundled);
      console.log(
        `Wrote ${MANIFEST_FILE}: ${entries.length - onDemand.length} bundled, ${onDemand.length} on demand ` +
          `(${onDemand.reduce((sum, entry) => sum + entry.bytes, 0)} bytes to download in total).`,
      );
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
