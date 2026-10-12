import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALLOWED_LICENSES,
  LICENSES_FILE,
  generate,
  productionPackages,
  renderThirdPartyLicenses,
} from '../../scripts/generate-third-party-licenses';

const ROOT = join(__dirname, '..', '..');
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf-8');

describe('third-party licenses', () => {
  const packages = productionPackages(read('package-lock.json'));

  it('lists the production packages of the lockfile, without dev dependencies', () => {
    const names = packages.map((p) => p.name);
    expect(names).toContain('web-tree-sitter');
    expect(names).toContain('@xenova/transformers');
    expect(names).not.toContain('vitest');
    expect(names).not.toContain('typescript');
  });

  it('accepts only licenses that can be combined with the MIT license of Hesman', () => {
    const rejected = packages.filter((p) => !ALLOWED_LICENSES.includes(p.license));
    expect(
      rejected.map((p) => `${p.name}@${p.version}: ${p.license}`),
      'a production dependency has a license that is not in ALLOWED_LICENSES (scripts/generate-third-party-licenses.ts)',
    ).toEqual([]);
  });

  it('keeps THIRD-PARTY-LICENSES.md in sync with package-lock.json', () => {
    expect(
      readFileSync(LICENSES_FILE, 'utf-8'),
      'run `npx tsx scripts/generate-third-party-licenses.ts`',
    ).toBe(generate());
  });

  it('groups packages by license and reads only the lockfile', () => {
    const lock = JSON.stringify({
      packages: {
        '': { name: 'root', license: 'MIT' },
        'node_modules/b': { version: '2.0.0', license: 'Apache-2.0' },
        'node_modules/a': { version: '1.0.0', license: 'MIT' },
        'node_modules/a/node_modules/c': { version: '0.1.0', license: 'MIT' },
        'node_modules/d': { version: '3.0.0', license: 'MIT', dev: true },
        'node_modules/flatbuffers': { version: '1.12.0', license: 'SEE LICENSE IN LICENSE.txt' },
        'node_modules/e': { version: '1.0.0' },
      },
    });
    const found = productionPackages(lock);
    expect(found).toEqual([
      { name: 'a', version: '1.0.0', license: 'MIT' },
      { name: 'b', version: '2.0.0', license: 'Apache-2.0' },
      { name: 'c', version: '0.1.0', license: 'MIT' },
      { name: 'e', version: '1.0.0', license: 'UNKNOWN' },
      { name: 'flatbuffers', version: '1.12.0', license: 'Apache-2.0' },
    ]);
    const text = renderThirdPartyLicenses(found);
    expect(text).toContain('| Apache-2.0 | 2 |');
    expect(text).toContain('## MIT\n\n- a 1.0.0\n- c 0.1.0\n');
    expect(text).toContain('## UNKNOWN\n\n- e 1.0.0\n');
  });
});

describe('license files shipped in the package', () => {
  const shipped = JSON.parse(read('package.json')) as { files: string[]; license: string };

  it('declares MIT and ships LICENSE, NOTICE and THIRD-PARTY-LICENSES.md', () => {
    expect(shipped.license).toBe('MIT');
    for (const file of ['LICENSE', 'NOTICE', 'THIRD-PARTY-LICENSES.md']) {
      expect(shipped.files, `${file} must be in package.json "files"`).toContain(file);
      expect(existsSync(join(ROOT, file)), `${file} must exist`).toBe(true);
    }
  });

  it('names in NOTICE the components that are not MIT or are fetched at run time', () => {
    const notice = read('NOTICE');
    // Dependencies under Apache-2.0 that Hesman uses directly.
    expect(notice).toContain('@xenova/transformers');
    expect(notice).toContain('@zvec/zvec');
    // Downloaded at run time, not part of the package.
    expect(notice).toContain('Xenova/all-MiniLM-L6-v2');
    expect(notice).toContain('libvips');
    expect(notice).toContain('LGPL-3.0-or-later');
    expect(notice).toContain('grammars.json');
    expect(notice).toContain('THIRD-PARTY-LICENSES.md');
  });

  it('lists in NOTICE every on-demand grammar that is not MIT', () => {
    const manifest = JSON.parse(read('grammars.json')) as {
      grammars: Record<string, { bundled: boolean; source: { repo: string; license: string } }>;
    };
    const notice = read('NOTICE');
    const notMit = Object.entries(manifest.grammars).filter(([, g]) => !g.bundled && g.source.license !== 'MIT');
    expect(notMit.length).toBeGreaterThan(0);
    for (const [id, grammar] of notMit) {
      expect(notice, `${id} (${grammar.source.license}) must be named in NOTICE`).toContain(
        `${grammar.source.repo} (${grammar.source.license})`,
      );
    }
  });
});
