/**
 * Maintainer check for the on-demand catalog (ADR 0001, section 4.4). Uses the
 * network, so it is not part of the test suite:
 *
 *   npx tsx scripts/verify-grammar-catalog.ts [--cache <directory>] [language…]
 *
 * For every on-demand grammar of `grammars.json` (or the named ones) it
 * downloads the pinned URL through the same code the server uses (sha256 and
 * size are checked there), loads the file in the pinned `web-tree-sitter`,
 * compares the ABI with the manifest and compiles every vendored tags query
 * against it. Run it after changing `scripts/grammar-catalog.ts` or a query
 * of an on-demand language. `--cache` reuses grammars downloaded earlier.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser, Query } from 'web-tree-sitter';
import { GrammarStore } from '../src/parsers/grammar-store.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cacheFlag = args.indexOf('--cache');
  const cacheRoot = cacheFlag === -1 ? mkdtempSync(join(tmpdir(), 'hesman-verify-grammars-')) : args.splice(cacheFlag, 2)[1];
  const store = new GrammarStore({ cacheRoot, offline: false });
  const ids = args.length > 0 ? args : store.ids().filter((id) => !store.entry(id)!.bundled);

  await Parser.init();
  let failures = 0;
  for (const id of ids) {
    try {
      const entry = store.entry(id);
      if (!entry) throw new Error('not in grammars.json');
      const how = await store.install(id);
      const language = await Language.load(store.verifiedPath(id));
      if (language.abiVersion !== entry.abi) throw new Error(`ABI is ${language.abiVersion}, the manifest says ${entry.abi}`);
      const layers = entry.queries?.tags ?? [];
      for (const layer of layers) {
        try {
          new Query(language, readFileSync(join(ROOT, layer), 'utf-8')).delete();
        } catch (err) {
          throw new Error(`${layer} does not compile: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      console.log(`ok    ${id}: ${how}, sha256 and size match, ABI ${entry.abi}, ${layers.length} tags quer${layers.length === 1 ? 'y' : 'ies'} compiled`);
    } catch (err) {
      failures++;
      console.log(`FAIL  ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`${ids.length - failures} of ${ids.length} grammars verified (cache: ${store.cacheDir}).`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
