# S3 local Graphiti comparison

Optional feasibility harness, not a product dependency. It never writes a real
workspace. It compares the production native ContextIndex and Graphiti against
the same 48 synthetic canonical episodes and seven scenario-6 alias queries.
The extra two queries require abstention for unknown names/external IDs.

Use Node 22/pnpm 10 and Python 3.12 with uv. Do not run beside S2 measurements.
From the repository root:

```sh
pnpm install --frozen-lockfile
python3 -m unittest discover -s spikes/s3 -p 'test_*.py'
uv sync --project spikes/s3 --frozen
uv run --project spikes/s3 python spikes/s3/check_clients.py
mkdir -p spikes/s3/out
uv run --project spikes/s3 python spikes/s3/store_probe.py spikes/s3/out/store.json
```

Create `spikes/s3/out` first. Reports require new filenames; nothing is overwritten.
The store probe forbids model HTTP calls. On the current Intel Mac the pinned
FalkorDBLite wheel fails with OS error 86 (bad CPU type). Stop there on Intel;
do not infer an inference result or disable operating-system security. Apple
Silicon must run the same probe. macOS also needs the upstream OpenMP runtime
(`libomp`); record any missing-library/install friction instead of guessing a pass.

Native-only baseline (no model or graph service):

```sh
mkdir -p spikes/s3/out
python3 spikes/s3/run.py --native-only --output spikes/s3/out/native.json
```

After a successful store probe and the S2 trial, use a separate explicit owned
Ollama server. Do not kill/reconfigure another server. Accept licenses and install
chosen models beforehand; the harness never pulls weights. For example, with
an official local Ollama executable and already installed weights:

```sh
OLLAMA_HOST=127.0.0.1:11435 OLLAMA_NO_CLOUD=1 OLLAMA_NUM_PARALLEL=1 ollama serve
```

In a second terminal obtain that process's PID from Activity Monitor. Replace
`<PID>` and the two model names below with that owned process and the exact
installed tags; the sample names are candidates, not accepted profiles:

```sh
uv run --project spikes/s3 python spikes/s3/run.py \
  --endpoint http://127.0.0.1:11435/v1 \
  --model llama3.2:3b --embedding-model nomic-embed-text \
  --embedding-dimensions 768 --ollama-pid <PID> \
  --ack-experimental-store --output spikes/s3/out/intel-3b-1.json
```

Repeat five times per candidate/tier, with new output names, on Intel only after
a supported store exists and on Apple Silicon after the store probe passes.
Record cold/warm state, RAM, OS, power mode, competing work, responsiveness and
versions in observations.md using synthetic labels. Keep the local endpoint,
not a hosted proxy. Graphiti telemetry is disabled before imports; LLM,
embeddings and reranking clients are all explicit. HTTP guards reject non-loopback,
other ports, redirects and routes; proxy environment variables are ignored.

The model must extract canonical IDs/aliases/types/external IDs into graph node
attributes. Retrieval uses Graphiti's public node RRF search; an explicit local
structured resolver handles abstention/ambiguity over retrieved records. It
never sees expected answers. This measures that proposed adapter, not an
unmodified Graphiti entity-resolution API. Native uses explicit canonical aliases;
the difference and all extraction failures are part of the comparison.

Reports include identical fixture hashes, model digests/runtime versions,
initial/rebuild setup/ingest/query time, episodes/minute, chat requests per episode,
embedding requests and exact identity/ambiguity/abstention accuracy. Requests
count attempts, including retries. Rebuild uses a fresh graph from the same
workspace snapshot. Python/graph child RSS and external Ollama process-tree RSS
are sampled separately every 100 ms; summed RSS includes shared pages and is not
physical memory or a guaranteed peak. Native reports the Node process peak.
Python/native timing is sequential, not a controlled hardware benchmark by itself.
Raw model text, source bodies, endpoint paths, PID and device/user names are not
written to reports. Failure reports keep the exception class, not provider text.

Review before copying count-only reports to docs/spikes/S3-results. Never commit
`.venv`, databases, weights, credentials, raw logs or personal paths. Record failed
runs as failures. Update docs/spikes/S3.md and ADR-0004 only from measured evidence,
then tick only step 8's Owner box. A passing smoke test never accepts Graphiti.
