import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  viteFinal: async config => ({ ...config, resolve: { ...config.resolve, alias: { ...config.resolve?.alias, '@fulcrum/domain': new URL('../packages/domain/src/index.ts', import.meta.url).pathname } } }),
  framework: '@storybook/react-vite',
  stories: ['../apps/desktop/src/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-vitest'],
  core: { disableTelemetry: true, enableCrashReports: false },
};

export default config;
