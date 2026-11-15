export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/** Who owns the Google Cloud project behind the OAuth client. */
export enum GoogleClientOwner {
  User = 'user',
  Fulcrum = 'fulcrum',
}

export interface GoogleOAuthClient {
  owner: GoogleClientOwner;
  clientId: string;
  /** Desktop clients carry a secret that Google does not treat as confidential. */
  clientSecret: string;
}

/** What is persisted per connected account. The access token is never stored. */
export interface GoogleCredential {
  client: GoogleOAuthClient;
  accountEmail: string;
  refreshToken: string;
}

/** Driver boundary for credential persistence (Keychain in production). */
export interface GoogleCredentialStore {
  load(accountKey: string): Promise<GoogleCredential | null>;
  save(accountKey: string, credential: GoogleCredential): Promise<void>;
  remove(accountKey: string): Promise<void>;
}

export interface AccessTokenProvider {
  /** Returns a token valid for at least the safety margin. */
  accessToken(signal?: AbortSignal): Promise<string>;
}

export type GoogleAuthErrorCode =
  | 'client_id_invalid'
  | 'client_secret_missing'
  | 'fulcrum_client_unavailable'
  | 'sign_in_cancelled'
  | 'sign_in_expired'
  | 'readonly_grant_required'
  | 'wrong_google_account'
  | 'refresh_token_revoked'
  | 'google_request_failed';

export class GoogleAuthError extends Error {
  constructor(readonly code: GoogleAuthErrorCode) {
    super(code);
    this.name = 'GoogleAuthError';
  }
}
