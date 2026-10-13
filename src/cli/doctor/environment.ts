import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES } from '../../parsers/languages.js';
import { probeServer } from './probe.js';
import type { DoctorEnvironment } from './types.js';

/**
 * The real machine for `hesman doctor`: this installation's `package.json` and `parsers/`, real
 * processes for the probe and a real (short, optional) request to the npm registry.
 */
export function realDoctorEnvironment(): DoctorEnvironment {
  // The package root is three levels above this file, in `dist/cli/doctor/` and in `src/cli/doctor/`.
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as { engines?: { node?: string } };
  return {
    nodeVersion: process.versions.node,
    enginesNode: pkg.engines?.node ?? '',
    parsersDir: join(root, 'parsers'),
    grammars: [...new Set(LANGUAGES.map((language) => language.grammar))],
    exists: existsSync,
    probe: probeServer,
    fetchStatus: async (url, timeoutMs) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/vnd.npm.install-v1+json' } });
      await response.body?.cancel();
      return response.status;
    },
  };
}
