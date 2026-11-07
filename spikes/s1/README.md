# S1 workspace harness

Node 22+, `npm ci` from the repository root. No sync client is bundled.

```sh
node spikes/s1/cli.mjs init "$WS"
node spikes/s1/cli.mjs device "$WS" --label 'Synthetic A'
node spikes/s1/cli.mjs write "$WS" --count 20 --interval-ms 100
node spikes/s1/cli.mjs write "$WS" --count 1 --interval-ms 0 --field-conflict "$INITIATIVE_ID"
node spikes/s1/cli.mjs checkpoint "$WS"
node spikes/s1/cli.mjs fold "$WS" --json
node spikes/s1/cli.mjs watch "$WS"
```

Set `WS` to a disposable workspace folder. Initialize once, then register each
Mac separately. `FULCRUM_SPIKE_HOME` overrides the default `~/.fulcrum-spike`
machine-local identity directory; use distinct homes to simulate two devices.
Never place the identity directory under a synced folder. `write` without
`--field-conflict` creates synthetic initiatives and prints their IDs; the flag
cycles the chosen initiative through the four MoSCoW values.

All output is newline-delimited JSON. `fold --json` includes state and events;
plain `fold` prints diagnostics, conflicts, frontier, hash and checkpoint
eligibility. Incomplete reads or ID collisions withhold a hash and exit nonzero.
Watch timestamps are local observations; compare frontiers to write acknowledgments
for approximate latency. Stop watch with Ctrl-C.

`npm test` includes simulations and one explicitly marked failing TODO for a
reference-reader gap. See [findings](../../docs/spikes/S1-findings.md) and the
[two-Mac procedure](../../docs/spikes/S1-procedure.md). Real provider behavior
remains unvalidated.

Watch also polls remote log metadata every 500 ms to catch missed notifications.
`WATCH_POLLING_FALLBACK` reports filesystem watcher failures. Include this interval
and fallback status in latency results; transient changes between polls may be missed.
