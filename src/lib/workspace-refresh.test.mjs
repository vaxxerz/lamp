import assert from "node:assert/strict";
import { test } from "node:test";
import { watchWorkspaceChanges } from "./workspace-refresh.ts";

function setup(t, refresh) {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const window = new EventTarget();
  const restores = [];
  for (const [name, value] of Object.entries({ document, window, navigator: { onLine: true } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restores.push(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const events = new Map();
  let status;
  const channel = {
    on(_type, options, handler) { events.set(options.table, { options, handler }); return channel; },
    subscribe(handler) { status = handler; return channel; },
  };
  const remove = t.mock.fn();
  const client = { channel: () => channel, removeChannel: remove };
  const load = refresh ?? t.mock.fn(async () => {});
  const stop = watchWorkspaceChanges(client, load);
  t.after(() => { stop(); for (const restore of restores) restore(); });
  return { document, window, events, load, remove, stop, status: (value) => status(value) };
}

test("reloads once when a burst includes meeting, membership, or credit changes", async (t) => {
  // Given an open workspace with active subscriptions.
  const s = setup(t);
  // When related rows arrive together, including deletes without filterable columns.
  for (const table of ["meetings", "team_members", "external_doc_credits"]) {
    assert.equal(s.events.get(table).options.filter, undefined);
    s.events.get(table).handler({ eventType: "DELETE" });
  }
  t.mock.timers.tick(350);
  await Promise.resolve();
  // Then one reload handles the entire burst.
  assert.equal(s.load.mock.callCount(), 1);
});

test("reloads when the Realtime connection is restored", async (t) => {
  // Given a workspace with no incoming row event.
  const s = setup(t);
  // When the channel subscribes or reconnects.
  s.status("SUBSCRIBED");
  t.mock.timers.tick(350);
  await Promise.resolve();
  // Then changes missed during disconnection are fetched.
  assert.equal(s.load.mock.callCount(), 1);
});

test("defers work in hidden tabs and reloads when visible", async (t) => {
  // Given a hidden workspace.
  const s = setup(t);
  s.document.visibilityState = "hidden";
  // When a row changes and the user later returns to the tab.
  s.events.get("tasks").handler();
  t.mock.timers.tick(350);
  assert.equal(s.load.mock.callCount(), 0);
  s.document.visibilityState = "visible";
  s.document.dispatchEvent(new Event("visibilitychange"));
  t.mock.timers.tick(350);
  await Promise.resolve();
  // Then only the visible tab reloads.
  assert.equal(s.load.mock.callCount(), 1);
});

test("checks periodically when change notifications are unavailable", async (t) => {
  // Given a workspace whose channel sends no events.
  const s = setup(t);
  // When the recovery interval elapses.
  t.mock.timers.tick(60_000);
  t.mock.timers.tick(350);
  await Promise.resolve();
  // Then the screen still catches up.
  assert.equal(s.load.mock.callCount(), 1);
});

test("queues a follow-up when data changes during an in-flight reload", async (t) => {
  // Given a reload that has not completed.
  let complete;
  let calls = 0;
  const s = setup(t, () => {
    calls++;
    return new Promise((resolve) => { complete = resolve; });
  });
  s.events.get("tasks").handler();
  t.mock.timers.tick(350);
  // When another change arrives during the request.
  s.events.get("tasks").handler();
  t.mock.timers.tick(350);
  assert.equal(calls, 1);
  complete();
  await Promise.resolve();
  t.mock.timers.tick(350);
  // Then it reloads again after completion, without overlapping requests.
  assert.equal(calls, 2);
  complete();
  await Promise.resolve();
});

test("removes timers, channels, and listeners on cleanup", async (t) => {
  // Given a mounted workspace with a scheduled change.
  const s = setup(t);
  s.events.get("tasks").handler();
  // When the workspace unmounts and a stale callback arrives.
  s.stop();
  s.events.get("tasks").handler();
  s.window.dispatchEvent(new Event("focus"));
  t.mock.timers.tick(120_000);
  await Promise.resolve();
  // Then no further data request is started.
  assert.equal(s.load.mock.callCount(), 0);
  assert.equal(s.remove.mock.callCount(), 1);
});
