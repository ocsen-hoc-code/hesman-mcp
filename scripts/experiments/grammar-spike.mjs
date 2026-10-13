#!/usr/bin/env node
/**
 * M1-01 spike: load Tree-sitter WASM grammars with a given `web-tree-sitter`
 * build, parse a small sample per language and run a `tags.scm` query.
 *
 * Not part of the product and not wired into any npm script. It has no
 * dependencies of its own: point it at an installed `web-tree-sitter` package
 * directory (any version) and at a manifest of grammars to try.
 *
 *   node scripts/experiments/grammar-spike.mjs \
 *     --runtime /path/to/node_modules/web-tree-sitter \
 *     --manifest /path/to/manifest.json [--filter <substring>] [--json]
 *
 * Manifest: [{ "lang": "java", "source": "upstream v0.23.5",
 *              "wasm": "/abs/tree-sitter-java.wasm", "tags": "/abs/tags.scm" }]
 * `lang` selects the built-in sample; `tags` is optional. `--filter` keeps
 * only entries whose "<lang> <source>" contains the substring, which is handy
 * for isolating one grammar per process when a load crashes the runtime.
 *
 * The script papers over the two public API generations of web-tree-sitter:
 *   <= 0.24: CommonJS default export `Parser`, `Parser.Language.load()`,
 *            `language.query(src)`, `language.version`
 *   >= 0.25: named exports `{ Parser, Language, Query }`, `Language.load()`,
 *            `new Query(language, src)`, `language.abiVersion`
 * Results of the 2026-10-11 run are recorded in docs/adr/0001-grammar-distribution.md.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SAMPLES = {
  typescript: `import { readFileSync } from 'node:fs';
export interface Shape { area(): number }
/** Greets people. */
export class Greeter implements Shape {
  constructor(private readonly name: string) {}
  greet(): string { return \`hi \${this.name}\`; }
  area(): number { return 1; }
}
export type Id = string | number;
export function main(): void { console.log(new Greeter('x').greet(), readFileSync); }
`,
  python: `import os
class Greeter:
    """Greets people."""
    def __init__(self, name):
        self.name = name
    def greet(self):
        return f"hi {self.name}"
LIMIT = 10
def main():
    print(Greeter("x").greet(), os.getcwd())
`,
  go: `package demo
import "fmt"
// Shape has an area.
type Shape interface { Area() float64 }
type Greeter struct { Name string }
// Greet greets people.
func (g *Greeter) Greet() string { return "hi " + g.Name }
func (g *Greeter) Area() float64 { return 1 }
const Limit = 10
func main() { g := &Greeter{Name: "x"}; fmt.Println(g.Greet()) }
`,
  java: `package demo;
import java.util.List;
/** Greets people. */
public class Greeter implements Runnable {
  private final String name;
  public Greeter(String name) { this.name = name; }
  public String greet(List<String> xs) { return "hi " + name + xs.size(); }
  @Override public void run() { System.out.println(greet(List.of())); }
}
interface Shape { double area(); }
enum Color { RED, GREEN }
`,
  csharp: `using System;
namespace Demo {
  public interface IShape { double Area(); }
  /// <summary>Greets people.</summary>
  public class Greeter : IShape {
    private readonly string name;
    public Greeter(string name) { this.name = name; }
    public string Greet() => $"hi {name}";
    public double Area() { Console.WriteLine(Greet()); return 1.0; }
  }
  public record Point(int X, int Y);
  public enum Color { Red, Green }
}
`,
  cpp: `#include <string>
#include <vector>
namespace demo {
struct Point { int x; int y; };
// Greets people.
class Greeter {
 public:
  explicit Greeter(std::string name) : name_(std::move(name)) {}
  std::string greet() const { return "hi " + name_; }
 private:
  std::string name_;
};
template <typename T> T add(T a, T b) { return a + b; }
}  // namespace demo
int main() { demo::Greeter g("x"); return demo::add(1, 2) + g.greet().size(); }
`,
  rust: `use std::fmt;
/// Greets people.
pub struct Greeter { name: String }
pub trait Shape { fn area(&self) -> f64; }
pub enum Color { Red, Green }
impl Greeter {
    pub fn new(name: &str) -> Self { Greeter { name: name.to_string() } }
    pub fn greet(&self) -> String { format!("hi {}", self.name) }
}
impl Shape for Greeter { fn area(&self) -> f64 { 1.0 } }
const LIMIT: usize = 10;
fn main() { let g = Greeter::new("x"); println!("{}", g.greet()); }
`,
  php: `<?php
namespace Demo;
interface Shape { public function area(): float; }
/** Greets people. */
class Greeter implements Shape {
    private string $name;
    public function __construct(string $name) { $this->name = $name; }
    public function greet(): string { return "hi " . $this->name; }
    public function area(): float { return 1.0; }
}
function main(): void { $g = new Greeter("x"); echo $g->greet(); }
main();
`,
  ruby: `require "json"
module Demo
  # Greets people.
  class Greeter
    attr_reader :name
    def initialize(name)
      @name = name
    end
    def greet
      "hi #{name}"
    end
    def self.build(name) = new(name)
  end
end
puts Demo::Greeter.build("x").greet
`,
  kotlin: `package demo
import kotlin.math.PI
interface Shape { fun area(): Double }
/** Greets people. */
class Greeter(private val name: String) : Shape {
    fun greet(): String = "hi $name"
    override fun area(): Double = PI
}
object Registry { val items = mutableListOf<String>() }
enum class Color { RED, GREEN }
fun main() { println(Greeter("x").greet()) }
`,
  swift: `import Foundation
protocol Shape { func area() -> Double }
/// Greets people.
class Greeter: Shape {
    let name: String
    init(name: String) { self.name = name }
    func greet() -> String { return "hi \\(name)" }
    func area() -> Double { return 1.0 }
}
struct Point { var x: Int; var y: Int }
enum Color { case red, green }
func main() { print(Greeter(name: "x").greet()) }
`,
  bash: `#!/usr/bin/env bash
set -euo pipefail
NAME="\${1:-world}"
# Greets people.
greet() {
  local who="$1"
  echo "hi \${who}"
}
function cleanup { rm -f "/tmp/demo.$$"; }
trap cleanup EXIT
for i in 1 2 3; do greet "\${NAME}-\${i}"; done
`,
  lua: `local M = {}
--- Greets people.
function M.greet(name)
  return "hi " .. name
end
local function helper(a, b) return a + b end
function M:area() return helper(1, 2) end
local Greeter = { name = "x" }
function Greeter.new(name) return setmetatable({ name = name }, Greeter) end
print(M.greet(Greeter.new("x").name))
return M
`,
};

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function loadRuntime(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const major = Number(pkg.version.split('.')[1]);
  if (major <= 24) {
    const require = createRequire(import.meta.url);
    const Parser = require(dir);
    await Parser.init();
    return {
      version: pkg.version,
      api: 'legacy',
      newParser: () => new Parser(),
      load: (p) => Parser.Language.load(p),
      abi: (l) => l.version,
      query: (l, src) => l.query(src),
    };
  }
  const entry = existsSync(join(dir, 'web-tree-sitter.js')) ? 'web-tree-sitter.js' : 'tree-sitter.js';
  const mod = await import(pathToFileURL(join(dir, entry)).href);
  await mod.Parser.init();
  return {
    version: pkg.version,
    api: 'named',
    newParser: () => new mod.Parser(),
    load: (p) => mod.Language.load(p),
    abi: (l) => l.abiVersion,
    query: (l, src) => new mod.Query(l, src),
  };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function countErrors(node) {
  let n = node.type === 'ERROR' || node.isMissing === true || (typeof node.isMissing === 'function' && node.isMissing()) ? 1 : 0;
  for (let i = 0; i < node.childCount; i++) n += countErrors(node.child(i));
  return n;
}

async function main() {
  const runtimeDir = resolve(arg('runtime') ?? 'node_modules/web-tree-sitter');
  const manifestPath = arg('manifest');
  if (!manifestPath) {
    console.error('usage: grammar-spike.mjs --runtime <web-tree-sitter dir> --manifest <json> [--filter <substring>] [--json]');
    process.exit(2);
  }
  const filter = arg('filter');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')).filter(
    (e) => !filter || `${e.lang} ${e.source}`.includes(filter),
  );
  const rt = await loadRuntime(runtimeDir);
  const rows = [];

  for (const entry of manifest) {
    const sample = SAMPLES[entry.lang];
    const row = {
      runtime: rt.version,
      lang: entry.lang,
      source: entry.source,
      wasmBytes: existsSync(entry.wasm) ? statSync(entry.wasm).size : null,
      load: 'failed',
    };
    rows.push(row);
    if (!sample) { row.error = 'no sample for language'; continue; }
    let language;
    try {
      const t0 = performance.now();
      language = await rt.load(entry.wasm);
      row.loadMs = +(performance.now() - t0).toFixed(1);
      row.abi = rt.abi(language);
      row.load = 'ok';
    } catch (e) {
      row.error = String(e?.message ?? e).split('\n')[0].slice(0, 160);
      continue;
    }
    try {
      const parser = rt.newParser();
      parser.setLanguage(language);
      let tree = parser.parse(sample); // warm-up
      const times = [];
      for (let i = 0; i < 25; i++) {
        const t0 = performance.now();
        tree = parser.parse(sample);
        times.push(performance.now() - t0);
      }
      row.parseMs = +median(times).toFixed(3);
      row.sampleBytes = Buffer.byteLength(sample);
      row.errorNodes = countErrors(tree.rootNode);

      if (entry.tags) {
        try {
          const q = rt.query(language, readFileSync(entry.tags, 'utf8'));
          const defs = [];
          let refs = 0;
          for (const m of q.matches(tree.rootNode)) {
            const tag = m.captures.find((c) => c.name.startsWith('definition.') || c.name.startsWith('reference.'));
            const name = m.captures.find((c) => c.name === 'name');
            if (!tag || !name) continue;
            if (tag.name.startsWith('definition.')) defs.push(`${tag.name.slice(11)}:${name.node.text}`);
            else refs++;
          }
          row.tags = 'ok';
          row.defs = [...new Set(defs)];
          row.refs = refs;
        } catch (e) {
          row.tags = 'query failed';
          row.tagsError = String(e?.message ?? e).split('\n')[0].slice(0, 200);
        }
      } else {
        row.tags = 'no query';
      }
    } catch (e) {
      row.error = `parse: ${String(e?.message ?? e).split('\n')[0].slice(0, 160)}`;
    }
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  console.log(`web-tree-sitter ${rt.version} (${rt.api} API), node ${process.version}`);
  for (const r of rows) {
    const head = `${r.lang.padEnd(7)} ${String(r.source).padEnd(34)} ${String(r.wasmBytes).padStart(8)} B`;
    if (r.load !== 'ok') { console.log(`${head}  LOAD FAILED: ${r.error}`); continue; }
    const tags = r.tags === 'ok' ? `tags ok: ${r.defs.length} defs, ${r.refs} refs [${r.defs.join(', ')}]`
      : r.tags === 'query failed' ? `TAGS FAILED: ${r.tagsError}` : 'tags: no query';
    console.log(`${head}  abi ${r.abi}  load ${r.loadMs} ms  parse ${r.parseMs} ms  errors ${r.errorNodes}  ${r.error ?? tags}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
