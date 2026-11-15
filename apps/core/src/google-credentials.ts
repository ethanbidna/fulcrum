import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GoogleCredential, GoogleCredentialStore } from '@fulcrum/sources';

const execute = promisify(execFile);
const SECURITY_BIN = '/usr/bin/security';
const KEYCHAIN_SERVICE = 'Fulcrum.Google';
const ITEM_NOT_FOUND_EXIT_CODE = 44;

type Run = (file: string, args: string[]) => Promise<{ stdout: string | Buffer }>;

/**
 * Stores the credential JSON as one generic password per account key.
 * `security` takes the value as an argument, so it is briefly visible to
 * same-user processes; a native Keychain binding would remove that.
 */
export class KeychainGoogleCredentialStore implements GoogleCredentialStore {
  constructor(private readonly run: Run = execute, private readonly platform = process.platform) {}

  async load(accountKey: string): Promise<GoogleCredential | null> {
    this.requireMac();
    try {
      const result = await this.run(SECURITY_BIN, ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', accountKey, '-w']);
      return JSON.parse(String(result.stdout).trim()) as GoogleCredential;
    } catch (error) {
      if ((error as { code?: unknown }).code === ITEM_NOT_FOUND_EXIT_CODE) return null;
      throw new Error('KEYCHAIN_UNAVAILABLE');
    }
  }

  async save(accountKey: string, credential: GoogleCredential): Promise<void> {
    this.requireMac();
    try {
      await this.run(SECURITY_BIN, ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', accountKey, '-w', JSON.stringify(credential)]);
    } catch { throw new Error('KEYCHAIN_UNAVAILABLE'); }
  }

  async remove(accountKey: string): Promise<void> {
    this.requireMac();
    try {
      await this.run(SECURITY_BIN, ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', accountKey]);
    } catch (error) {
      if ((error as { code?: unknown }).code !== ITEM_NOT_FOUND_EXIT_CODE) throw new Error('KEYCHAIN_UNAVAILABLE');
    }
  }

  private requireMac(): void {
    if (this.platform !== 'darwin') throw new Error('KEYCHAIN_UNAVAILABLE');
  }
}
