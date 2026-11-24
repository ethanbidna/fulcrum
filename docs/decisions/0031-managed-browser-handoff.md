# ADR-0031: Hand managed sign-in back to the local core

- **Status:** Accepted for the connection UI; runtime adoption pending
- **Date:** 2026-11-24
- **Refines:** [ADR-0030](0030-managed-connection-driver.md), [ADR-0014](0014-core-transports.md)

## Decision

Run managed OAuth from the native core through a temporary system-browser page.
The desktop webview uses authenticated administration and receives only source
status. It never receives the runtime login, session token or authorization
code. Granola remains a separate, acknowledged API-key form.

The core starts connection work asynchronously and returns to the desktop
immediately. Its browser coordinator uses the existing settings service for
admission, exchange, cancellation and receipt recovery. It does not create
flows, execute source actions or enable ingestion.

A temporary IPv4 loopback listener serves one Fulcrum helper page under an
unguessable per-attempt path. A user gesture opens the pinned provider URL in
a popup so the hosted relay can reply to its opener. Accept a popup message
only from the exact hosted origin and the exact popup. Decode its bounded
code once and post it to the helper's private completion route.

The listener checks Host, origin, method, content type, path and body shape.
It has bounded bodies, request timeouts and a five-minute lifetime. Responses
are not cached; referrers and framing are disabled; scripts use a CSP nonce.
There is no CORS grant, credential-returning route or general HTTP proxy.
The first terminal reply consumes the attempt. Cancel, timeout, failed browser
launch and core shutdown close the listener and its connections.

This is a narrow exception to the production core's no-TCP-listener rule,
like the existing direct Gmail OAuth callback. It is not a permanent backend
or a replacement for authenticated Unix-socket administration.

## Desktop behavior

Sources & Integrations, the focused source page and first-run setup share the
same six-source controls. Permission/custody acknowledgement is inline before
sign-in. Importing and scope selection are clearly unavailable in this preview.
Saved receipts are not presented as active syncing or proof of source access.
No Activepieces dashboard, signup page or flow builder opens.

Existing direct Gmail credentials remain separate. Show their existing
selection/sync/disconnect controls, but do not offer that custom-client route
for a new connection. Do not silently migrate or erase its selected scopes.

## Evidence and limits

Synthetic callback tests cover routing, reply bounds, origin/popup matching,
replay rejection, cancellation, timeout and listener cleanup. Storybook tests
cover consent, masked key entry, cancellation, keyboard focus, saved/unavailable
states, device handover and the shared Settings/onboarding flows.

A browser UI check does not prove live OAuth, actual grants, Keychain approval,
runtime installation or ingestion. The November 21 Gmail proof remains the
live managed-sign-in evidence. Keep the runtime-installation and retention gates
in [the integration record](../integrations/ACTIVEPIECES.md) open.
