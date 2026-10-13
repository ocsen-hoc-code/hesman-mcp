import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

// Agent worktrees live under .claude/worktrees/ inside the repo; never collect their copies of the tests.
const excludeWorktrees = ['.claude/**'];

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ...excludeWorktrees],
    // Tests never use the network or the user's grammar cache: on-demand grammar downloads are
    // off and the cache is an empty temporary directory. A test that needs a cached grammar
    // installs the committed fixture into a directory of its own. Servers started by the e2e
    // helpers inherit both variables.
    env: {
      HESMAN_GRAMMARS_OFFLINE: '1',
      HESMAN_CACHE_DIR: join(tmpdir(), `hesman-test-grammar-cache-${process.pid}`),
    },
    benchmark: {
      exclude: [...configDefaults.exclude, ...excludeWorktrees],
    },
  },
});
