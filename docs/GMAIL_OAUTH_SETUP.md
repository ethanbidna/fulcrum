# Gmail sign-in setup (guided flow spec)

Copy and behavior for I2's "Connect Gmail" setup. Decision:
[ADR-0028](decisions/0028-gmail-oauth-client-ownership.md). Google's console
wording and layout change; **none of these steps has been run against live
Google.** Verify each step and screenshot-free wording before release.

## Choice screen

> **How do you want to sign in to Gmail?**
>
> **Use my own Google project (recommended)** — about 10 minutes, once. Free.
> Nothing is shared with other Fulcrum users and there is no sign-in limit.
>
> **Use Fulcrum's sign-in** — one click. Shows a Google warning ("Google
> hasn't verified this app") and is limited to the first 100 people. Not
> available once the limit is reached.

Both options request the same single permission, **read-only access to your
Gmail**. Fulcrum cannot send, delete or change mail. Google grants this to
the whole mailbox; Fulcrum only reads the label you pick next.

## Own-project steps

Each step is one screen in Fulcrum with an "Open this page" button (opens the
system browser) and a "Done" button. Fulcrum never asks for your Google
password.

1. **Create a project.** Open Google Cloud Console → project picker → *New
   project*. Name it "Fulcrum Gmail". Leave organization empty. No billing is
   needed; if Google asks for a card, you are on the wrong page.
2. **Turn on the Gmail API.** *APIs & Services → Library → Gmail API →
   Enable*.
3. **Set up the consent screen.** *APIs & Services → OAuth consent screen →
   Get started*. App name "Fulcrum", your email as support and contact
   email, Audience **External**.
4. **Add the read-only permission only.** *Data Access → Add or remove
   scopes* → tick `.../auth/gmail.readonly` and nothing else → Save. If any
   other permission is listed, remove it.
5. **Publish to production.** *Audience → Publish app → Confirm.* Do not
   leave it in "Testing": Google expires sign-ins of testing apps after 7
   days, and Fulcrum would stop syncing weekly. No Google review is needed
   for a personal app; you will see an "unverified app" warning once.
6. **Create the sign-in credentials.** *Clients → Create client →
   Application type **Desktop app*** → name "Fulcrum" → Create. Copy the
   **Client ID** and **Client secret**.
7. **Paste them into Fulcrum.** Two fields. Fulcrum checks the format
   (`…apps.googleusercontent.com`, `GOCSPX-…`) and says which field looks
   wrong.
8. **Sign in.** Fulcrum opens your browser. Choose your account. On the
   "Google hasn't verified this app" page choose *Advanced → Go to Fulcrum
   (unsafe)* — it is your own project. Approve **View your email
   messages and settings**. Return to Fulcrum.
9. **Pick a label.** Fulcrum lists your labels; choose the one to ingest.

## Messages

| Code | Shown text |
|---|---|
| `client_id_invalid` | That doesn't look like a Client ID. It ends in `.apps.googleusercontent.com`. |
| `client_secret_missing` | That doesn't look like a Client secret. It starts with `GOCSPX-`. |
| `sign_in_cancelled` | Sign-in was cancelled. Try again when ready. |
| `sign_in_expired` | Sign-in took too long. Try again. |
| `readonly_grant_required` | Google didn't grant read-only access. Check the consent screen lists only the Gmail read-only permission, then sign in again. |
| `refresh_token_revoked` | Google ended this sign-in. If your project is still in "Testing", publish it (step 5), then reconnect. |
| `fulcrum_client_unavailable` | Fulcrum's shared sign-in isn't available. Use your own Google project. |

## Data handling

- The Client ID, secret and refresh token live in macOS Keychain
  (service `Fulcrum.Google`), never in the workspace, logs or the repo.
- The core refreshes access tokens in memory and passes them to the
  read-only Gmail piece. Disconnecting deletes the Keychain item; revoke
  access in the Google account page as well.
- The Desktop client secret is not confidential per Google's documentation;
  it is still treated as a credential.
