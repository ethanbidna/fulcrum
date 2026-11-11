import assert from "node:assert/strict";
import { test } from "node:test";
import { runLiveProbe } from "./live.mjs";

const environment = {
  S4_SYNTHETIC_ONLY: "yes",
  GMAIL_TEST_LABEL: "Label_synthetic",
  GMAIL_TEST_CLIENT_ID: "fixture-client",
  GMAIL_TEST_CLIENT_SECRET: "fixture-secret",
  GMAIL_TEST_REFRESH_TOKEN: "fixture-refresh",
};

test("the live probe refreshes for each scan and reports counts only", async (context) => {
  let refreshes = 0;
  let changedLabel = false;
  context.mock.method(globalThis, "fetch", async (input, request) => {
    const url = new URL(input);
    if (url.href === "https://oauth2.googleapis.com/token") {
      assert.equal(request.body.get("grant_type"), "refresh_token");
      return Response.json({ access_token: `fixture-access-${++refreshes}` });
    }

    assert.equal(url.origin, "https://gmail.googleapis.com");
    assert.equal(request.headers.Authorization, `Bearer fixture-access-${refreshes}`);
    const route = url.pathname.split("/me/")[1];
    if (route === "profile") return Response.json({ historyId: "100" });
    if (route === "messages") return Response.json({ messages: [{ id: "initial" }] });
    if (route === "history") {
      assert.equal(url.searchParams.get("startHistoryId"), "100");
      assert.equal(url.searchParams.get("labelId"), environment.GMAIL_TEST_LABEL);
      assert.ok(changedLabel);
      return Response.json({ historyId: "200", history: [{ messages: [{ id: "new" }] }] });
    }

    const id = route.split("/")[1];
    return Response.json({
      id, labelIds: [environment.GMAIL_TEST_LABEL], internalDate: String(Date.now()),
      payload: { headers: [{ name: "From", value: "fixture@example.invalid" }] },
      snippet: "Synthetic mail",
    });
  });

  const report = await runLiveProbe(environment, () => { changedLabel = true; });
  assert.deepEqual(report, {
    backfill: { pages: 1, messages: 1 }, incremental: { pages: 1, messages: 1 },
    refreshes: 2, reopenedQueue: true,
  });
  assert.equal(refreshes, 2);
});

test("the probe requires an explicitly designated synthetic mailbox", async (context) => {
  const fetch = context.mock.method(globalThis, "fetch", () => assert.fail("unexpected network request"));
  await assert.rejects(runLiveProbe({}, () => {}), { message: "confirm_throwaway_account" });
  assert.equal(fetch.mock.callCount(), 0);
});
