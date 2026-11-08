import tseslint from 'typescript-eslint';
import layers from './tools/workspace/layers.mjs';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/dist-dev/**', 'packages/schema/src/generated.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['apps/**/*.{ts,tsx,js,mjs}', 'packages/**/*.{ts,tsx,js,mjs}'],
    plugins: { fulcrum: { rules: { layers } } },
    rules: { 'fulcrum/layers': 'error' },
  },
  {
    files: ['packages/{domain,schema,ingest}/src/**/*.{ts,tsx,js,mjs}'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'process', 'global', 'window', 'document', 'navigator', 'globalThis'],
    },
  },
  { files: ['**/*.mjs'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
];
