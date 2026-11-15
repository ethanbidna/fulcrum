import { describe, expect, it } from 'vitest';
import { GoogleClientOwner, type GoogleCredential } from '@fulcrum/sources';
import { KeychainGoogleCredentialStore } from './google-credentials.js';

const CREDENTIAL: GoogleCredential = {
  client: { owner: GoogleClientOwner.User, clientId: 'id.apps.googleusercontent.com', clientSecret: 'GOCSPX-synthetic' },
  accountEmail: 'person@example.test', refreshToken: 'refresh-synthetic',
};

function fakeSecurity() {
  const items = new Map<string, string>();
  const run = async (_file: string, args: string[]) => {
    const account = args[args.indexOf('-a') + 1]!;
    const notFound = Object.assign(new Error('missing'), { code: 44 });
    if (args[0] === 'add-generic-password') { items.set(account, args[args.indexOf('-w') + 1]!); return { stdout: '' }; }
    if (!items.has(account)) throw notFound;
    if (args[0] === 'delete-generic-password') { items.delete(account); return { stdout: '' }; }
    return { stdout: `${items.get(account)}\n` };
  };
  return { run, items };
}

describe('KeychainGoogleCredentialStore', () => {
  it('round-trips, overwrites and removes', async () => {
    const { run, items } = fakeSecurity();
    const store = new KeychainGoogleCredentialStore(run, 'darwin');
    expect(await store.load('a')).toBeNull();
    await store.save('a', CREDENTIAL);
    expect(await store.load('a')).toEqual(CREDENTIAL);
    await store.save('a', { ...CREDENTIAL, refreshToken: 'next' });
    expect((await store.load('a'))?.refreshToken).toBe('next');
    await store.remove('a');
    await store.remove('a');
    expect(items.size).toBe(0);
  });

  it('fails closed off macOS and on Keychain errors', async () => {
    await expect(new KeychainGoogleCredentialStore(fakeSecurity().run, 'linux').load('a')).rejects.toThrow('KEYCHAIN_UNAVAILABLE');
    const broken = new KeychainGoogleCredentialStore(async () => { throw Object.assign(new Error('x'), { code: 1 }); }, 'darwin');
    await expect(broken.load('a')).rejects.toThrow('KEYCHAIN_UNAVAILABLE');
    await expect(broken.save('a', CREDENTIAL)).rejects.toThrow('KEYCHAIN_UNAVAILABLE');
  });
});
