import assert from "node:assert/strict";
import { test } from "node:test";
import { gmailReadOnly } from "./piece.ts";

const mailbox = "https://gmail.googleapis.com/gmail/v1/users/me/";
const auth = { type: "OAUTH2", access_token: "synthetic" };
const paging = { labelId: "Label_synthetic", pageSize: 1 };

function run(name, propsValue = {}) {
  return gmailReadOnly.getAction(name).run({ auth, propsValue });
}

function intercept(context, exchanges) {
  const fetch = context.mock.method(globalThis, "fetch", (url, options) => {
    const [expected, body, status = 200] = exchanges[fetch.mock.callCount()];
    assert.equal(url.origin + url.pathname, mailbox + expected.route);
    assert.deepEqual(Object.fromEntries(url.searchParams), expected.query ?? {});
    assert.equal(options.method ?? "GET", "GET");
    assert.equal(options.headers.Authorization, "Bearer synthetic");
    assert.equal(options.redirect, "error");
    return Promise.resolve(Response.json(body, { status }));
  });
  return fetch;
}

test("backfill resumes the same selected label and time window", async (context) => {
  const inputs = { ...paging, after: 100, before: 200 };
  const query = { labelIds: paging.labelId, maxResults: "1", q: "after:100 before:200" };
  const message = { id: "message-two", threadId: "thread-one" };
  const fetch = intercept(context, [
    [{ route: "profile" }, { historyId: "9007199254740993" }],
    [{ route: "messages", query }, { nextPageToken: "next+/=" }],
    [{ route: "messages", query: { ...query, pageToken: "next+/=" } }, { messages: [message] }],
  ]);

  assert.deepEqual(await run("get_history_anchor"), { historyId: "9007199254740993" });
  const first = await run("list_backfill_page", inputs);
  assert.deepEqual(first, { messages: [], nextPageToken: "next+/=" });
  assert.deepEqual(await run("list_backfill_page", { ...inputs, pageToken: first.nextPageToken }), {
    messages: [message], nextPageToken: null,
  });
  assert.equal(fetch.mock.callCount(), 3);
});

test("history keeps the original anchor until the final page", async (context) => {
  const startHistoryId = "9007199254740993";
  const query = { labelId: paging.labelId, maxResults: "1", startHistoryId };
  const lastId = "9007199254740999";
  const fetch = intercept(context, [
    [{ route: "history", query }, { nextPageToken: "page-two", historyId: lastId }],
    [{ route: "history", query: { ...query, pageToken: "page-two" } }, {
      history: [{ id: lastId }], historyId: lastId,
    }],
  ]);

  const first = await run("list_history_page", { ...paging, startHistoryId });
  assert.deepEqual(first, { changes: [], nextPageToken: "page-two", checkpoint: null });
  assert.deepEqual(await run("list_history_page", {
    ...paging, startHistoryId, pageToken: first.nextPageToken,
  }), { changes: [{ id: lastId }], nextPageToken: null, checkpoint: lastId });
  assert.equal(fetch.mock.callCount(), 2);
});

test("expired history requires recovery and invalid scope makes no request", async (context) => {
  const query = { labelId: paging.labelId, maxResults: "1", startHistoryId: "100" };
  const fetch = intercept(context, [[{ route: "history", query }, { error: "synthetic" }, 404]]);
  await assert.rejects(run("list_history_page", { ...paging, startHistoryId: "100" }), {
    message: "gmail_history_expired",
  });
  await assert.rejects(run("list_history_page", { ...paging, labelId: "", startHistoryId: "100" }), {
    message: "gmail_label_required",
  });
  assert.equal(fetch.mock.callCount(), 1);
});
