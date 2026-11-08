import { defineConfig } from 'vite';
import { developmentSessionPlugin } from './dev/session-plugin.js';
export default defineConfig({
  plugins: [developmentSessionPlugin(process.env.FULCRUM_DEV_SESSION)],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { assetsInlineLimit: 0, target: 'safari15', sourcemap: false },
});
