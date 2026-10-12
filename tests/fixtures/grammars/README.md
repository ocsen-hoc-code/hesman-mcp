# Grammar fixtures

`tree-sitter-r.wasm` is the unmodified `.wasm` asset of the
[r-lib/tree-sitter-r](https://github.com/r-lib/tree-sitter-r) release `v1.3.0`
(commit `346d3707b8c9301f1051e8f6e32666e67529f7d2`), the file that
`grammars.json` pins for R (sha256
`3e406e27cec05a60ba3281e2da021187200b83d152d9eb0dcf0a731cbfbcc28d`, 487,039
bytes). It lets the on-demand grammar path (download, verification, cache,
parsing in worker threads) be tested with a real grammar and without the
network. It is not part of the npm package.

A unit test (`tests/unit/parsers/grammar-manifest.test.ts`) fails when this
file and the manifest entry differ; replace both together.

License of the grammar: MIT, Copyright (c) 2025 tree-sitter-r authors.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
