import path from 'node:path';
import { spawn } from 'node:child_process';
const BACKGROUND_NICE = '10';
export function startBackgroundOllama(options: { executable: string; port: number }, launch = spawn) {
  if (process.platform !== 'darwin' || !path.isAbsolute(options.executable) || !Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error('INVALID_BACKGROUND_RUNTIME');
  return launch('/usr/sbin/taskpolicy', ['-b', '/usr/bin/nice', '-n', BACKGROUND_NICE, options.executable, 'serve'], {
    env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${options.port}`, OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_KEEP_ALIVE: '5m', OLLAMA_NO_CLOUD: '1' },
    stdio: 'ignore',
  });
}
