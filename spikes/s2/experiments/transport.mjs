import { request as httpRequest } from 'node:http';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const INFERENCE_PORTS = new Set(['11434', '11435', '11436']);

export async function localInferenceFetch(input, options = {}) {
  const url = new URL(input);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Only loopback HTTP is allowed');
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: options.method ?? 'GET', headers: options.headers, signal: options.signal }, response => {
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) { request.destroy(new Error('Inference response exceeds size limit')); return; }
        chunks.push(chunk);
      });
      response.once('error', reject);
      response.once('end', () => {
        const body = Buffer.concat(chunks);
        resolve(new Response(body.length ? body : null, { status: response.statusCode, headers: response.headers }));
      });
    });
    request.once('error', reject);
    request.end(options.body);
  });
}

export function installInferenceTransport({ port } = {}) {
  if (port !== undefined && !INFERENCE_PORTS.has(String(port))) throw new Error('Unsupported inference port');
  const previous = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !INFERENCE_PORTS.has(url.port)) return previous(input, options);
    if (port !== undefined) url.port = String(port);
    return localInferenceFetch(url, options);
  };
}
