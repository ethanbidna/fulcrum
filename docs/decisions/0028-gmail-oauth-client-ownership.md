# ADR-0028: Gmail OAuth client ownership

- **Status:** Proposed
- **Date:** 2026-11-15
- **Refines:** [ADR-0027](0027-gmail-piece-execution.md)

## Decision

The default is a Desktop OAuth client the user creates in their own free
Google Cloud project, published to production, with `gmail.readonly` only
([setup spec](../GMAIL_OAUTH_SETUP.md)). A Fulcrum-owned client is an
optional fallback for the first 100 users and is absent from builds that do
not ship one. Fulcrum will not create several projects to multiply the cap,
buy verification or CASA, or add an OAuth relay.

The core runs the system-browser PKCE loopback flow, keeps the refresh token
(with the client id and secret) in Keychain behind `GoogleCredentialStore`,
and gives the piece a `RefreshingAccessTokenProvider`. Only the access token
leaves that boundary.

## Why

Google limits unverified apps to 100 users per project and verification of a
restricted scope needs a paid security assessment, which the owner excluded.
Per-user projects keep each user's cap and consent screen separate.

## Not verified

Written from Google's documentation and the S4 addendum. The unverified
warning, the 100-user cap, and the 7-day expiry of testing-mode tokens were
not exercised. The flow code ran only against synthetic fakes; no live
Google run, and Keychain behavior was tested through an injected command
runner, not the real `security` tool. The Fulcrum-owned client id is not
created; shipping it needs an owner decision on where its id and secret are
injected at build time.
