import { readFile, lstat } from 'node:fs/promises';
import type { Plugin } from 'vite';
const DEVELOPMENT_HOST = '127.0.0.1:5173';
export function developmentSessionPlugin(sessionFile: string | undefined): Plugin {
  return {
    name: 'fulcrum-development-session', apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fulcrum/session', async (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        if (request.method !== 'GET' || request.headers.host !== DEVELOPMENT_HOST || request.headers['sec-fetch-site'] !== 'same-origin' || !sessionFile) {
          response.writeHead(403).end(); return;
        }
        try {
          const entry = await lstat(sessionFile);
          if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o777) !== 0o600 || entry.uid !== process.getuid?.()) throw new Error('PRIVATE_SESSION_REQUIRED');
          const session = JSON.parse(await readFile(sessionFile, 'utf8')) as { url: string; token: string };
          const url = new URL(session.url);
          if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || !/^[a-f0-9]{64}$/.test(session.token)) throw new Error('INVALID_SESSION');
          response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(session));
        } catch { response.writeHead(503).end(); }
      });
    },
  };
}
