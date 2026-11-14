import assert from "node:assert/strict";
import { test } from "node:test";
import { runLiveProbe } from "./live.mjs";

test("the probe requires an explicitly designated synthetic mailbox", async (context) => {
  const fetch = context.mock.method(globalThis, "fetch", () => assert.fail("unexpected network request"));
  await assert.rejects(runLiveProbe({}, () => {}), { message: "confirm_throwaway_account" });
  assert.equal(fetch.mock.callCount(), 0);
});
