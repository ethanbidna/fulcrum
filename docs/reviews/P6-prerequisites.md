# P6 implementation prerequisite review

Step 36 cannot meet the accepted design's platform validation gates in the
current environment. It is blocked; encryption remains unimplemented. Issue
[#35](https://github.com/ethanbidna/fulcrum/issues/35) stays open. The completed-step
counter remains at 4 and no Owner checkbox changes.

## Evidence

- Step 35's design is approved through merged
  [#71](https://github.com/ethanbidna/fulcrum/pull/71).
  [ADR-0021](../decisions/0021-workspace-encryption.md) makes
  [ENCRYPTION.md](../ENCRYPTION.md) the implementation contract.
- The design's **Step 36 acceptance gates** require "actual signed-helper
  tests on Intel/Apple Silicon", covering Keychain denial/lock, first unlock,
  entitlement identity, recovery re-entry and second-Mac import. Mocks or
  successful TypeScript tests cannot establish these behaviors.
- On 2026-11-10, `uname -m` returned `x86_64` and
  `security find-identity -v -p codesigning` returned
  `0 valid identities found`. `xcrun --find codesign` succeeded: the signing
  executable exists, but this check found no signing identity. No Keychain
  secret or certificate was created, imported or exported.
- Apple Silicon signed-helper execution was not performed. The checked-in
  step 1 status also still awaits the disposable two-Mac Dropbox/Drive results.
  The design explicitly gates encrypted sync trials on those S1 prerequisites.
- The current core socket-secret driver uses the `security` command-line tool.
  The encryption design explicitly excludes that creation path for workspace
  keys. The desktop currently proxies an independently started core; its
  configuration does not provide the proposed workspace-key helper, its
  Keychain entitlements or its inherited private-pipe launcher.

This is a completion/validation blocker, not evidence that encryption or
Keychain cannot work. Codec and helper development are technically possible
before hardware validation. The plan's instruction to mark a blocked step and
stop is followed here; no reduced acceptance gate or substitute key-storage
path is introduced. No full P5 signing/notarization completion dependency is
added to step 36.

## Unblock

1. Arrange a signing identity and the intended native helper's Keychain
   entitlement/access-group provisioning on the test Macs. Keep certificates,
   private keys, account/team identifiers and credentials out of the repository.
   Recheck locally:

   ```sh
   security find-identity -v -p codesigning
   uname -m
   xcrun --find codesign
   ```

   Record only availability and architecture, not the identity listing.
2. Arrange Intel and Apple Silicon test targets for the actual helper. Record
   access or blockers in this review. The helper and launcher still need to be
   implemented; availability alone is not a Keychain pass. P5 remains responsible
   for final distribution signing/notarization.
3. Complete the existing [S1 procedure](../spikes/S1-procedure.md) with synthetic
   data on two Macs, record reviewed results, then tick only step 1's Owner box
   in `backlog/PROGRESS.md`. Do not mark encryption tests as run from S1 results.
4. Once test access is available and S1 permits the sync trials, return step 36
   to `todo`. Implement and verify every gate in ENCRYPTION.md: versioned codec,
   authenticated full-history replay, native key lifecycle/recovery, durable
   copy migration/backup/restore and encrypted two-Mac trials. Record actual
   outcomes and limitations before marking step 36 done.

No runtime code, schema, dependency, workspace, key or migration changed in this
review. No cryptographic, native, recovery, migration or sync pass is claimed.
