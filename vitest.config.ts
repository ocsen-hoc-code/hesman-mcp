import { configDefaults, defineConfig } from 'vitest/config';

// Agent worktrees live under .claude/worktrees/ inside the repo; never collect their copies of the tests.
const excludeWorktrees = ['.claude/**'];

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ...excludeWorktrees],
    benchmark: {
      exclude: [...configDefaults.exclude, ...excludeWorktrees],
    },
  },
});
