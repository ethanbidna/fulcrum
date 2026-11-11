import { defineConfig } from 'vitest/config';

const MAX_TEST_WORKERS = 2;

export default defineConfig({
  test: {
    name: 'unit',
    maxWorkers: MAX_TEST_WORKERS,
    include: ['apps/**/*.test.ts', 'apps/**/*.test.tsx', 'packages/**/*.test.ts', 'tools/workspace/**/*.test.mjs'],
  },
});
