import type { ManagedRuntimeIdentity, ManagedRuntimeSecrets } from '@fulcrum/sources';
import { validRuntimeKeys, type RuntimeKeys, type RuntimeKeyStore } from '@fulcrum/sources/runtime';
import type { LocalPreferences } from '@fulcrum/store';
import { NativeProviderSecrets } from './provider-secrets.js';

interface OptionalSecrets { getOptional(): Promise<string | null>; set(value: string): Promise<void> }
const MAX_IDENTITY_FIELD_LENGTH = 512;

function validOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port
      && url.origin === value;
  } catch { return false; }
}
function validIdentity(value: unknown): value is ManagedRuntimeIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  return Object.keys(identity).length === 4 && validOrigin(identity.origin)
    && typeof identity.email === 'string' && /^[^\s@]+@example\.invalid$/.test(identity.email)
    && identity.email.length <= MAX_IDENTITY_FIELD_LENGTH
    && typeof identity.password === 'string' && !!identity.password
    && identity.password.length <= MAX_IDENTITY_FIELD_LENGTH
    && typeof identity.provisioned === 'boolean';
}

export class KeychainManagedRuntimeSecrets implements ManagedRuntimeSecrets {
  constructor(private readonly secrets: OptionalSecrets) {}
  async read(): Promise<ManagedRuntimeIdentity | null> {
    const encoded = await this.secrets.getOptional();
    if (encoded === null) return null;
    let identity: unknown;
    try { identity = JSON.parse(encoded); } catch { throw new Error('invalid_runtime_identity'); }
    if (!validIdentity(identity)) throw new Error('invalid_runtime_identity');
    return identity;
  }
  async write(identity: ManagedRuntimeIdentity): Promise<void> {
    if (!validIdentity(identity)) throw new Error('invalid_runtime_identity');
    await this.secrets.set(JSON.stringify(identity));
  }
}

export function nativeManagedRuntimeSecrets(helper: string): ManagedRuntimeSecrets {
  return new KeychainManagedRuntimeSecrets(new NativeProviderSecrets(helper, 'activepieces'));
}

export async function configuredManagedRuntime(preferences: LocalPreferences): Promise<{ origin: string } | undefined> {
  try {
    const value = await preferences.read('managedRuntime');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const config = value as Record<string, unknown>;
    if (Object.keys(config).length === 1 && validOrigin(config.origin)) return { origin: config.origin };
  } catch { /* Missing or unsafe local configuration leaves connections unavailable. */ }
}

export class KeychainRuntimeKeys implements RuntimeKeyStore {
  constructor(private readonly secrets: OptionalSecrets) {}
  async read(): Promise<RuntimeKeys | null> {
    const encoded = await this.secrets.getOptional();
    if (encoded === null) return null;
    let value: unknown;
    try { value = JSON.parse(encoded); } catch { throw new Error('invalid_runtime_keys'); }
    if (!validRuntimeKeys(value)) throw new Error('invalid_runtime_keys');
    return value;
  }
  async write(keys: RuntimeKeys): Promise<void> {
    if (!validRuntimeKeys(keys)) throw new Error('invalid_runtime_keys');
    await this.secrets.set(JSON.stringify(keys));
  }
}
export function nativeRuntimeKeys(helper: string): RuntimeKeyStore {
  return new KeychainRuntimeKeys(new NativeProviderSecrets(helper, 'activepieces-runtime'));
}
