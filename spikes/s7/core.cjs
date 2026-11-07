const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const MAXIMUM_FRAME_BYTES = 65536;
const SOCKET_MODE = 0o600;
const RPC_ERRORS = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601 };

function openDatabase() {
  const runtime = typeof Bun === 'undefined' ? 'node' : 'bun';
  const Database = runtime === 'node' ? require('node:sqlite').DatabaseSync : require('bun:sqlite').Database;
  const database = new Database(':memory:');
  database.exec("CREATE VIRTUAL TABLE sample USING fts5(text); INSERT INTO sample VALUES ('Cedar synthetic sample');");
  return { runtime, database };
}

function health(driver) {
  const matches = driver.database.prepare('SELECT rowid FROM sample WHERE sample MATCH ?').all('Cedar');
  const version = driver.database.prepare('SELECT sqlite_version() AS version').get();
  return { runtime: driver.runtime, sqliteVersion: version.version, fts5: matches.length === 1, matches: matches.length, processId: process.pid };
}

function failure(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

function respond(line, driver) {
  let request;
  try { request = JSON.parse(line); } catch { return failure(null, RPC_ERRORS.parse, 'Parse error'); }
  const validId = typeof request?.id === 'string' || (typeof request?.id === 'number' && Number.isFinite(request.id));
  if (request?.jsonrpc !== '2.0' || !validId || typeof request.method !== 'string') return failure(null, RPC_ERRORS.invalidRequest, 'Invalid request');
  if (request.method !== 'health') return failure(request.id, RPC_ERRORS.methodNotFound, 'Method not found');
  return { jsonrpc: '2.0', id: request.id, result: health(driver) };
}

function serveClient(client, driver) {
  let pending = '';
  client.setEncoding('utf8');
  client.on('error', () => client.destroy());
  client.on('data', chunk => {
    pending += chunk;
    if (Buffer.byteLength(pending) > MAXIMUM_FRAME_BYTES) {
      client.end(`${JSON.stringify(failure(null, RPC_ERRORS.invalidRequest, 'Frame too large'))}\n`);
      return;
    }
    let boundary;
    while ((boundary = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, boundary);
      pending = pending.slice(boundary + 1);
      client.write(`${JSON.stringify(respond(line, driver))}\n`);
    }
  });
}

function startServer(socketPath, driver) {
  if (!path.isAbsolute(socketPath)) throw new Error('Absolute socket path required');
  const parent = fs.statSync(path.dirname(socketPath));
  if ((parent.mode & 0o777) !== 0o700) throw new Error('Private socket directory required');
  const clients = new Set();
  const server = net.createServer(client => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    serveClient(client, driver);
  });
  server.on('error', () => { process.stderr.write('Sidecar socket failed\n'); process.exit(1); });
  server.listen(socketPath, () => { fs.chmodSync(socketPath, SOCKET_MODE); process.stdout.write('READY\n'); });
  const stop = () => {
    for (const client of clients) client.destroy();
    server.close(() => { driver.database.close(); fs.rmSync(socketPath, { force: true }); process.exit(0); });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

function main() {
  const driver = openDatabase();
  if (process.argv.includes('--self-test')) {
    process.stdout.write(`${JSON.stringify(health(driver))}\n`);
    driver.database.close();
    return;
  }
  const index = process.argv.indexOf('--socket');
  if (index < 0 || !process.argv[index + 1]) throw new Error('Socket argument required');
  startServer(process.argv[index + 1], driver);
}

try { main(); } catch { process.stderr.write('Sidecar startup failed\n'); process.exitCode = 1; }
