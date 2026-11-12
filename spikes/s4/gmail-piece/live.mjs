import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { SqliteIngestionQueue } from "../../../packages/sources/src/queue.ts";
import { refreshGoogle } from "../http.mjs";
import { GmailSourceAdapter } from "./adapter.ts";

const MAX_PAGES = 10;
const MESSAGE_LIMIT = 5;
const BACKFILL_MS = 14 * 24 * 60 * 60 * 1000;
const DEADLINE_MS = 120_000;

async function scan(options, adapter, scope, mode) {
  const queue = await SqliteIngestionQueue.open(options);
  try {
    queue.configure(adapter.id, [scope]);
    const initial = queue.scopes()[0];
    if (mode === "incremental" && (!initial.cursor || initial.next !== null)) {
      throw new Error("missing_checkpoint");
    }

    const now = Date.now();
    const limits = {
      since: new Date(now - BACKFILL_MS).toISOString(),
      limit: MESSAGE_LIMIT,
      signal: AbortSignal.timeout(DEADLINE_MS),
    };
    let cursor = initial.cursor;
    const previousCount = queue.counts().pending;
    queue.begin(adapter.id, scope.id);
    for (let count = 1; count <= MAX_PAGES; count++) {
      const page = await adapter.pull(scope, cursor, limits);
      if (page.next !== null && page.next === cursor) throw new Error("stalled_cursor");
      queue.recordPage(adapter.id, scope.id, page, new Date(now).toISOString());
      if (page.next === null) {
        const messages = queue.counts().pending - previousCount;
        if (messages < 1) throw new Error(mode === "backfill" ? "no_backfill_messages" : "no_incremental_messages");
        return { pages: count, messages };
      }
      cursor = page.next;
    }
    throw new Error("page_budget_exhausted");
  } finally {
    queue.close();
  }
}

export async function runLiveProbe(environment, betweenScans) {
  if (environment.S4_SYNTHETIC_ONLY !== "yes") throw new Error("confirm_throwaway_account");
  const labelId = environment.GMAIL_TEST_LABEL;
  if (!labelId?.trim()) throw new Error("missing_label");

  const probe = await openGmailProbe(labelId, () => refreshGoogle(environment));
  try {
    const backfill = await probe.backfill();
    await betweenScans(backfill);
    return { backfill, incremental: await probe.incremental(), refreshes: 2, reopenedQueue: true };
  } finally {
    await probe.close();
  }
}

export async function openGmailProbe(labelId, refresh) {
  const directory = await mkdtemp(join(tmpdir(), "fulcrum-s4-gmail-"));
  const options = {
    localDirectory: join(directory, "local"),
    workspaceDirectory: join(directory, "workspace"),
    workspaceId: "synthetic-gmail",
  };
  const close = () => rm(directory, { recursive: true, force: true });
  const labels = [{ id: labelId, label: "Synthetic Gmail" }];
  async function run(mode) {
    const token = await refresh();
    const adapter = new GmailSourceAdapter({
      labels, accountKey: "synthetic-gmail", historyExpiry: "fail", accessToken: async () => token, now: Date.now,
    });
    const [scope] = await adapter.scopes();
    return scan(options, adapter, scope, mode);
  }
  try {
    await Promise.all([mkdir(options.localDirectory), mkdir(options.workspaceDirectory)]);
    return { backfill: () => run("backfill"), incremental: () => run("incremental"), close };
  } catch (error) {
    await close();
    throw error;
  }
}

const SAFE_ERRORS = new Set([
  "confirm_throwaway_account", "missing_label", "refresh_configuration_required", "refresh_failed",
  "gmail_history_expired", "gmail_http_401", "gmail_http_403", "gmail_http_429", "missing_checkpoint", "stalled_cursor",
  "no_backfill_messages", "no_incremental_messages", "page_budget_exhausted",
]);

async function main() {
  const input = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const result = await runLiveProbe(process.env, async () => {
      await input.question("Backfill finished. Apply the test label to one more synthetic message, then press Enter. ");
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const code = error instanceof Error && SAFE_ERRORS.has(error.message) ? error.message : "probe_failed";
    console.error(JSON.stringify({ error: code }));
    process.exitCode = 1;
  } finally {
    input.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
