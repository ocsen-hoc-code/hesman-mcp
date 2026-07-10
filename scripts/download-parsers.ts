import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const PARSERS: Record<string, string> = {
  'tree-sitter-typescript.wasm':
    'https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm',
};

const OUT_DIR = new URL('../parsers', import.meta.url).pathname;

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  for (const [name, url] of Object.entries(PARSERS)) {
    const outPath = `${OUT_DIR}/${name}`;
    console.log(`Downloading ${name}...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${name}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(outPath, buf);
    console.log(`  → ${outPath} (${(buf.length / 1024).toFixed(1)} KB)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
