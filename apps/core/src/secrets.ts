import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const KEYCHAIN_SERVICE = 'Fulcrum.Core';
const KEYCHAIN_ACCOUNT = 'local-client';
export interface SecretStore { getOrCreate(): Promise<string> }
export class KeychainSecretStore implements SecretStore {
  constructor(private readonly run = execute, private readonly platform = process.platform) {}
  async getOrCreate(): Promise<string> {
    if (this.platform !== 'darwin') throw new Error('KEYCHAIN_UNAVAILABLE');
    try {
      const result = await this.run('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w']);
      const secret = String(result.stdout).trim();
      if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('KEYCHAIN_SECRET_INVALID');
      return secret;
    } catch (error) {
      if ((error as { code?: unknown }).code !== 44) throw new Error('KEYCHAIN_UNAVAILABLE');
    }
    const secret = randomBytes(32).toString('hex');
    try { await this.run('/usr/bin/security', ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w', secret]); }
    catch { throw new Error('KEYCHAIN_UNAVAILABLE'); }
    return secret;
  }
}
