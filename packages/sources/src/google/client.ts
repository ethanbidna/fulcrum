import { GoogleAuthError, GoogleClientOwner, type GoogleOAuthClient } from './types.js';

const CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const CLIENT_SECRET_PREFIX = 'GOCSPX-';

/** Validates pasted values and trims whitespace from copy/paste. */
export function userClientFromInput(input: { clientId: string; clientSecret: string }): GoogleOAuthClient {
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  if (!CLIENT_ID_PATTERN.test(clientId)) throw new GoogleAuthError('client_id_invalid');
  if (!clientSecret.startsWith(CLIENT_SECRET_PREFIX) || clientSecret.length <= CLIENT_SECRET_PREFIX.length) {
    throw new GoogleAuthError('client_secret_missing');
  }
  return { owner: GoogleClientOwner.User, clientId, clientSecret };
}

/**
 * The shared client is shipped by the release build and may be absent
 * (development builds, or once its 100-user cap is reached).
 */
export function fulcrumClientFrom(config: { clientId: string; clientSecret: string } | null): GoogleOAuthClient {
  if (!config) throw new GoogleAuthError('fulcrum_client_unavailable');
  return { owner: GoogleClientOwner.Fulcrum, clientId: config.clientId, clientSecret: config.clientSecret };
}
