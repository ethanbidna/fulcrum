# S2 local extraction benchmark

See [the procedure](../../docs/spikes/S2.md) for installation, hardware runs,
manual resource checks, result publication, and scoring limits.

Run from the repository root:

```sh
npm ci
npm test
node spikes/s2/benchmark.mjs --output spikes/s2/out/results.json
```

After the C1 scaffold merges, use `corepack enable` and
`pnpm install --frozen-lockfile` instead of `npm ci`.

Requires a user-started local Ollama server with the three documented Q4 models
already downloaded. No model downloads, workspace writes, domain commands, or
hosted inference occur in this script. The only HTTP destination is
`http://127.0.0.1:11434`, and redirects are refused.

`--model` selects one documented model; otherwise all three run sequentially.
`--output` selects the results file. Ctrl-C aborts the active request, attempts
to unload the model, writes an interrupted report, and exits with failure.
Stopping HTTP alone does not prove the server stopped computing.
