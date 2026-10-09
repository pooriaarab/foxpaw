// P7: the page navigates while an action runs. Firefox rejects the
// executeScript call, or returns no result for the frame. act() must report
// "navigated" and never throw for it. A missing permission is a setup error
// and must still throw.
import { describe, expect, it } from "vitest";
import { act, type ScriptingApi } from "../src/tab.js";
import type { Control, Snapshot } from "../src/types.js";

const control = { id: "0:4", frameId: 0, node: 4, guard: "g" } as Control;
const page = { frames: [{ frameId: 0, url: "http://x/", key: "k", documentId: "doc-1" }] } as unknown as Snapshot;

function fake(run: () => Promise<{ frameId: number; result?: unknown; error?: unknown }[]>) {
  const calls: unknown[] = [];
  const browser: ScriptingApi = { scripting: { executeScript: (details) => { calls.push(details.target); return run(); } } };
  return { browser, calls };
}

describe("act when the page goes away", () => {
  it("reports navigated when executeScript rejects", async () => {
    const { browser } = fake(() => Promise.reject(new Error("Frame with id 0 was removed.")));
    await expect(act(1, control, { op: "click" }, page, browser)).resolves.toMatchObject({ ok: false, reason: "navigated" });
  });

  it("reports navigated when the document id no longer exists", async () => {
    const { browser } = fake(() => Promise.reject(new Error("Invalid document id doc-1")));
    await expect(act(1, control, { op: "click" }, page, browser)).resolves.toMatchObject({ ok: false, reason: "navigated" });
  });

  it("reports navigated when the frame returns no result", async () => {
    const { browser } = fake(() => Promise.resolve([]));
    await expect(act(1, control, { op: "click" }, page, browser)).resolves.toMatchObject({ ok: false, reason: "navigated" });
  });

  it("still throws when the extension lacks permission", async () => {
    const { browser } = fake(() => Promise.reject(new Error("Missing host permission for the tab")));
    await expect(act(1, control, { op: "click" }, page, browser)).rejects.toThrow(/permission/);
  });

  it("targets the exact document the snapshot read", async () => {
    const { browser, calls } = fake(() => Promise.resolve([{ frameId: 0, result: { ok: true } }]));
    await act(1, control, { op: "click" }, page, browser);
    expect(calls[0]).toEqual({ tabId: 1, documentIds: ["doc-1"] });
  });

  it("targets the frame when Firefox gives no document id", async () => {
    const old = { frames: [{ frameId: 3, url: "http://x/", key: "k" }] } as unknown as Snapshot;
    const { browser, calls } = fake(() => Promise.resolve([{ frameId: 3, result: { ok: true } }]));
    await act(1, { ...control, frameId: 3 }, { op: "click" }, old, browser);
    expect(calls[0]).toEqual({ tabId: 1, frameIds: [3] });
  });
});
