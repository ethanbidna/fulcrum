import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { maxWorkers: 2, projects: ['./vitest.unit.config.ts', './vitest.storybook.config.ts'] } });
