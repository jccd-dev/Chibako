import assert from "node:assert/strict";
import { test } from "node:test";
import { requestOrganizationChange } from "../src/features/organization/organization-client";

test("organization waits for the editor, then writes and notifies once", async t => {
  const browser = new EventTarget();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { value: browser, configurable: true });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    globalThis.fetch = originalFetch;
  });
  const events: string[] = [];
  let releaseSave!: () => void;
  const saved = new Promise<void>(resolve => { releaseSave = resolve; });
  browser.addEventListener("chibako:before-organize", event => {
    events.push("save");
    if (event instanceof CustomEvent) event.detail.push(saved);
  });
  browser.addEventListener("chibako:notes-changed", () => events.push("changed"));
  browser.addEventListener("chibako:organized", () => events.push("organized"));
  globalThis.fetch = async (_url, options) => {
    events.push("write");
    assert.deepEqual(JSON.parse(String(options?.body)), { action: "delete", ids: ["a", "b"] });
    return Response.json({ ok: true });
  };
  const operation = requestOrganizationChange("/api/notes/batch", "POST", { action: "delete", ids: ["a", "b"] });
  await Promise.resolve();
  assert.deepEqual(events, ["save"]);
  releaseSave();
  await operation;
  assert.deepEqual(events, ["save", "write", "changed", "organized"]);
  events.length = 0;
  globalThis.fetch = async () => Response.json({ error: "Batch conflict" }, { status: 409 });
  await assert.rejects(requestOrganizationChange("/api/notes/batch", "POST", {}), /Batch conflict/);
  assert.deepEqual(events, ["save"]);
});

test("failed editor saves block organization writes and refresh notifications", async t => {
  const browser = new EventTarget();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { value: browser, configurable: true });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    globalThis.fetch = originalFetch;
  });
  browser.addEventListener("chibako:before-organize", event => {
    if (event instanceof CustomEvent) event.detail.push(Promise.reject(new Error("Save failed")));
  });
  browser.addEventListener("chibako:organized", () => assert.fail("must not refresh"));
  globalThis.fetch = async () => { assert.fail("must not write"); };
  await assert.rejects(requestOrganizationChange("/api/notes/batch", "POST", {}), /Save failed/);
});
