import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { IngestionScheduler } from "../../../packages/ingest/src/scheduler.ts";
import { SqliteIngestionQueue } from "../../../packages/sources/src/queue.ts";
import { GmailSourceAdapter } from "./adapter.ts";

const LABEL = "Label_selected";
const NOW = "2026-01-08T12:00:00Z";
const BODY = "I will review the synthetic proposal.";
const ANCHOR = "9007199254740993";
const CHECKPOINT = "9007199254740997";

function adapter(now = () => NOW, accountKey = "synthetic-account") {
  return new GmailSourceAdapter({
    accountKey, labels: [{ id: LABEL, label: "Selected label" }],
    now: () => Date.parse(now()), accessToken: async () => "synthetic",
  });
}

function fullMessage(id, labels = [LABEL]) {
  return {
    id, labelIds: labels, threadId: "synthetic-thread", internalDate: String(Date.parse(NOW)),
    payload: {
      mimeType: "multipart/alternative",
      headers: [{ name: "From", value: "Fixture <fixture@example.invalid>" }],
      parts: [
        { mimeType: "text/plain", body: { data: Buffer.from(BODY).toString("base64url") } },
        { mimeType: "text/html", body: { data: Buffer.from("<p>Ignored alternative</p>").toString("base64url") } },
      ],
    },
  };
}

test("the scheduler resumes Gmail through the existing SQLite queue", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fulcrum-gmail-"));
  const options = { localDirectory: join(directory, "local"), workspaceDirectory: join(directory, "workspace"), workspaceId: "synthetic" };
  await Promise.all([mkdir(options.localDirectory), mkdir(options.workspaceDirectory)]);
  let now = NOW;
  let queue = await SqliteIngestionQueue.open(options);
  let scheduler;
  context.after(async () => {
    await scheduler?.close();
    queue.close();
    await rm(directory, { recursive: true, force: true });
  });
  const processed = [];
  const makeScheduler = () => new IngestionScheduler({
    queue, adapters: [adapter(() => now)], deviceId: "device", ingestionDeviceId: () => "device",
    now: () => now, relevance: () => ({ userId: "fixture@example.invalid", terms: [], linkedThreadIds: [], excludedAuthorIds: [] }),
    process: async item => { processed.push(item); },
  });

  const requests = [];
  const windows = [];
  let unavailable = true;
  context.mock.method(globalThis, "fetch", async (url, request) => {
    assert.equal(url.origin, "https://gmail.googleapis.com");
    assert.equal(request.headers.Authorization, "Bearer synthetic");
    const route = url.pathname.split("/me/")[1];
    const query = url.searchParams;
    requests.push([route, query.get("format")]);
    if (route === "profile") return Response.json({ historyId: ANCHOR });
    if (route === "messages") {
      assert.equal(query.get("labelIds"), LABEL);
      windows.push(query.get("q"));
      if (query.get("pageToken") === "continue") {
        return unavailable ? Response.json({}, { status: 503 }) : Response.json({ messages: [{ id: "m2" }] });
      }
      return Response.json({ messages: [{ id: "m1" }, { id: "removed" }], nextPageToken: "continue" });
    }
    if (route === "history") {
      assert.equal(query.get("labelId"), LABEL);
      assert.equal(query.get("startHistoryId"), ANCHOR);
      return Response.json({ historyId: CHECKPOINT, history: [{ labelsAdded: [{ message: { id: "m3" } }] }] });
    }

    const id = route.split("/")[1];
    if (id === "removed") {
      assert.equal(query.get("format"), "minimal");
      return Response.json({ id, labelIds: ["Label_other"] });
    }
    return Response.json(query.get("format") === "minimal" ? { id, labelIds: [LABEL] } : fullMessage(id));
  });

  const [scope] = await adapter().scopes();
  scheduler = makeScheduler();
  await scheduler.configure("gmail", [scope.id]);
  await scheduler.tick();
  assert.equal(queue.scopes()[0].cursor, null);
  assert.equal(queue.pending().length, 1);
  assert.equal(processed.length, 0);
  assert.ok(queue.scopes()[0].next.includes("continue"));

  await scheduler.close();
  queue.close();
  queue = await SqliteIngestionQueue.open(options);
  scheduler = makeScheduler();
  now = "2026-01-08T12:01:00Z";
  unavailable = false;
  await scheduler.tick();
  assert.equal(new Set(windows).size, 1, "the restart preserves the original backfill window");
  assert.equal(requests.filter(([route]) => route === "profile").length, 1);
  assert.equal(queue.scopes()[0].next, null);
  assert.ok(queue.scopes()[0].cursor.includes(ANCHOR));
  assert.equal(processed.length, 2);
  assert.ok(processed.every(item => item.text === BODY && item.threadRemoteId === "synthetic-thread"));

  now = "2026-01-08T12:03:00Z";
  await scheduler.tick();
  assert.ok(queue.scopes()[0].cursor.includes(CHECKPOINT));
  assert.equal(processed.length, 3);
  const database = await readFile(join(options.localDirectory, "ingestion.sqlite"));
  assert.equal(database.includes(BODY), false);
});

test("a label removed between the metadata check and full read prevents ingestion", async (context) => {
  const source = adapter();
  const [scope] = await source.scopes();
  const signal = new AbortController().signal;
  const ref = { connector: "gmail", scopeId: scope.id, remoteId: '"synthetic-account":m1' };
  const fetch = context.mock.method(globalThis, "fetch", async url => Response.json(
    url.searchParams.get("format") === "minimal" ? { id: "m1", labelIds: [LABEL] } : fullMessage("m1", []),
  ));
  assert.equal(await source.read(ref, signal), null);
  assert.equal(await adapter(() => NOW, "other-account").read(ref, signal), null);
  assert.equal(fetch.mock.callCount(), 2);
});

test("history splits large change batches without committing their checkpoint early", async (context) => {
  const source = adapter();
  const [scope] = await source.scopes();
  const limits = { limit: 1, since: "2026-01-01T00:00:00Z", signal: new AbortController().signal };
  context.mock.method(globalThis, "fetch", async url => {
    const route = url.pathname.split("/me/")[1];
    if (route === "profile") return Response.json({ historyId: ANCHOR });
    if (route === "messages") return Response.json({});
    if (route === "history") return Response.json({
      historyId: CHECKPOINT, history: [{ messages: [{ id: "m1" }, { id: "m2" }, { id: "m1" }] }],
    });
    const id = route.split("/")[1];
    return Response.json(fullMessage(id));
  });
  const backfill = await source.pull(scope, null, limits);
  const first = await source.pull(scope, backfill.checkpoint, limits);
  assert.equal(first.items.length, 1);
  assert.ok(first.next);
  const last = await source.pull(scope, first.next, limits);
  assert.equal(last.items.length, 1);
  assert.notEqual(first.items[0].remoteId, last.items[0].remoteId);
  assert.equal(last.next, null);
  assert.ok(last.checkpoint.includes(CHECKPOINT));
});
