import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ManagedGmailSession } from './client.mjs';

const PORT = 18081;
const HOST = `localhost:${PORT}`;
const ORIGIN = `http://${HOST}`;
const BODY_LIMIT = 16_384;
const HTML = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fulcrum Gmail proof</title><link rel="stylesheet" href="/proof.css"><div id="root"></div><script type="module" src="/proof.js"></script></html>';

export function allowedMutation(request) {
  return Boolean(request.method === 'POST' && request.headers.host === HOST && request.headers.origin === ORIGIN
    && request.headers['content-type']?.split(';')[0] === 'application/json');
}

async function readBody(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (Buffer.byteLength(text) > BODY_LIMIT) throw new Error('invalid_request');
  }
  return JSON.parse(text);
}

export function proofHandler({ session, assets }) {
  let busy = false;
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    if (request.headers.host !== HOST) return response.writeHead(403).end();
    if (request.method === 'GET' && request.url === '/') return response.writeHead(200, { 'Content-Type': 'text/html' }).end(HTML);
    if (request.method === 'GET' && assets[request.url]) {
      return response.writeHead(200, { 'Content-Type': request.url.endsWith('.css') ? 'text/css' : 'text/javascript' }).end(assets[request.url]);
    }
    response.setHeader('Content-Type', 'application/json');
    if (!allowedMutation(request)) return response.writeHead(403).end('{}');
    if (!['/api/begin', '/api/complete', '/api/read'].includes(request.url)) return response.writeHead(404).end('{}');
    if (busy) return response.writeHead(409).end('{}');
    busy = true;
    try {
      const body = await readBody(request);
      const result = request.url === '/api/begin' ? await session.begin()
        : request.url === '/api/complete' ? await session.complete({ attemptId: body.attemptId, code: body.code })
        : await session.read(body.labelId);
      response.end(JSON.stringify(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = /^(activepieces_request_failed_\d{3}|shared_oauth_unavailable|local_identity_unavailable|unexpected_oauth_request|google_sign_in_expired|invalid_oauth_reply|labels_unavailable|choose_test_label|test_read_failed|test_read_timed_out|invalid_read_result)$/.test(message)
        ? message : 'managed_test_failed';
      console.error(`Managed OAuth proof: ${code}`);
      response.writeHead(400).end(JSON.stringify({ error: code }));
    } finally {
      busy = false;
    }
  };
}

async function main() {
  const entry = fileURLToPath(new URL('./entry.tsx', import.meta.url));
  const result = await build({ entryPoints: [entry], outfile: 'proof.js', write: false, bundle: true, format: 'esm', jsx: 'automatic' });
  const assets = Object.fromEntries(result.outputFiles.map(file => [file.path.endsWith('.css') ? '/proof.css' : '/proof.js', file.contents]));
  const server = createServer(proofHandler({ session: new ManagedGmailSession(), assets }));
  server.listen(PORT, '127.0.0.1', () => console.log(`Fulcrum connection proof: ${ORIGIN}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
