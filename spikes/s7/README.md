# S7 packaging experiment

Run native builds and controlled measurements **after S2 finishes**. The
committed Node SEA sample is only a concurrent-workload smoke check.
See [the report](../../docs/spikes/S7.md) for what is and is not verified.

## Prerequisites

On the Intel Mac, and later on Apple Silicon if available:

1. Install Node 22 LTS, Xcode Command Line Tools (`xcode-select --install`),
   stable Rust/Cargo from [rustup](https://rustup.rs/), and Bun from its
   [official installation guide](https://bun.sh/docs/installation).
2. From the repo root, run:

   ```sh
   corepack enable
   pnpm install --frozen-lockfile
   pnpm check
   node --version
   bun --version
   rustc --version
   cargo --version
   ```

3. Use `plan/step-4-sidecar-packaging` before merge, or `main` afterward.
   Record versions, hardware class/RAM and power/thermal conditions without
   personal names, serial numbers or paths. Toolchain downloads/build logs
   can contain paths; do not commit raw logs.

## Build and measure both candidates

The commands below run from the repository root. Build downloads use pinned
postject/CLI packages; Cargo resolves its dependency graph on the first run.
Keep the generated `spikes/s7/src-tauri/Cargo.lock` and commit it with results.

```sh
node spikes/s7/build.mjs node sidecar
node spikes/s7/build.mjs bun sidecar
```

Both commands run the compiled executable's FTS5 self-test and fail if it does
not return the expected synthetic row. On Intel, measure those actual binaries:

```sh
node spikes/s7/measure.mjs sidecar node "$PWD/spikes/s7/out/node/fulcrum-core-x86_64-apple-darwin"
node spikes/s7/measure.mjs sidecar bun "$PWD/spikes/s7/out/bun/fulcrum-core-x86_64-apple-darwin"
```

On Apple Silicon replace `x86_64` with `aarch64`. Then build each hello-world app:

```sh
node spikes/s7/build.mjs node app
cargo test --manifest-path spikes/s7/src-tauri/Cargo.toml
node spikes/s7/build.mjs bun app
```

The build script copies the selected candidate to Tauri's external binary
location and keeps separate Cargo output roots. Run the Rust tests after the
first sidecar/app build so Tauri's build script can find the external binary.
Record any Rust compile/config/link failures as blockers; Node tests alone do
not validate the Rust launcher.

Intel app measurements:

```sh
node spikes/s7/measure.mjs app node "$PWD/spikes/s7/out/node/tauri-target/x86_64-apple-darwin/release/bundle/macos/Fulcrum S7.app"
node spikes/s7/measure.mjs app bun "$PWD/spikes/s7/out/bun/tauri-target/x86_64-apple-darwin/release/bundle/macos/Fulcrum S7.app"
```

Use `aarch64-apple-darwin` paths on Apple Silicon. Repeat each measurement at
least five times after the previous process exits. Reports receive distinct
timestamped filenames under `spikes/s7/out/<runtime>/`. Check the window appears,
shows a matching runtime and FTS5 result, and that Check connection works. Record
visible-window delay separately, plus Activity Monitor's total shell, sidecar
and WebKit memory (some WebKit processes can be outside the sampled tree).
Quit normally once and verify the sidecar exits and its private socket is removed.

If either candidate fails FTS5, signing or launch, preserve the error category
without copying personal paths into the report. Do not silently substitute a
separate SQLite server or add a native addon to make the experiment pass.

## Universal build

First build the **same runtime and version** on both architectures. Transfer
only the two synthetic sidecar executables to these ignored input locations:

```text
spikes/s7/out/universal/fulcrum-core-x86_64-apple-darwin
spikes/s7/out/universal/fulcrum-core-aarch64-apple-darwin
```

On a Mac with both Rust targets and the selected thin sidecars available:

```sh
rustup target add x86_64-apple-darwin aarch64-apple-darwin
mkdir -p spikes/s7/src-tauri/binaries
lipo -create spikes/s7/out/universal/fulcrum-core-x86_64-apple-darwin \
  spikes/s7/out/universal/fulcrum-core-aarch64-apple-darwin \
  -output spikes/s7/src-tauri/binaries/fulcrum-core-universal-apple-darwin
codesign --force --sign - spikes/s7/src-tauri/binaries/fulcrum-core-universal-apple-darwin
lipo -archs spikes/s7/src-tauri/binaries/fulcrum-core-universal-apple-darwin
cd spikes/s7
CARGO_TARGET_DIR=out/universal/tauri-target npx --yes @tauri-apps/cli@2.12.4 build --target universal-apple-darwin --bundles app
cd ../..
```

Keep the two thin sidecars in `src-tauri/binaries/` as well if the current CLI's
per-target build stages require them. Do not assume lipo success proves SEA
loading for both slices: run `--self-test`, the app and the measurement script
on both real architectures. The Node SEA blob must match its slice's Node
version/architecture. A cross-build without an execution test remains unverified.

## Signing and notarization

This Mac currently has no Developer ID Application identity. If that remains
true, record **no Developer ID**; do not claim a notarization dry run passed.
Ad-hoc signing is sufficient only for the local spike's launch checks.

If you have a Developer ID later, follow Tauri's signing guide with your own
Keychain identity. The app entitlements file permits JIT and unsigned executable
memory for the experiment; validate those permissions on each **bundled
sidecar**, as well as the outer app. Hardened-runtime behavior is not proven by
the current ad-hoc SEA check. Use environment variables/Keychain for signing
configuration, never committed credentials or literal account names.

For an already Developer-ID-signed app, a manual notarization trial uses an
existing notarytool Keychain profile. Set these values through prompts in zsh:

```sh
read -r 'S7_APP?Paste the signed .app path: '
export S7_APP
read -rs 'S7_NOTARY_PROFILE?Paste the existing notarytool Keychain profile name: '
export S7_NOTARY_PROFILE
ditto -c -k --keepParent "$S7_APP" spikes/s7/out/notary-test.zip
xcrun notarytool submit spikes/s7/out/notary-test.zip --keychain-profile "$S7_NOTARY_PROFILE" --wait --output-format json
xcrun stapler staple "$S7_APP"
spctl --assess --type execute "$S7_APP"
```

Only staple/assess after an Accepted submission. Record acceptance/failure,
required entitlements and any blockers without Apple account/team identifiers,
submission IDs or raw log paths. No public release is part of S7.

## Publish results

Review count/measurement JSON and build-info files, remove process IDs and any
personal data, and commit selected reports under `docs/spikes/S7-results/`.
Never commit executables, bundles, toolchains, credentials or raw build logs.
Fill the comparison rows in `docs/spikes/S7.md`, record startup trials and
complete RSS observations, and commit Cargo.lock with the toolchain versions.
Open a results PR referencing #7, then tick the Owner box for step 4 in
`backlog/PROGRESS.md`. Keep ADR-0001/0009 packaging status provisional until the
decision checkpoint reviews the measured comparison.
