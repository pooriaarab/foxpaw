// The extension side of the page functions. Each call goes through
// `browser.scripting.executeScript` with a bundled function and JSON args.
// No CDP, no `debugger` permission, no `userScripts`, no code strings.
import { perform } from "./page/act.js";
import { quiet } from "./page/settle.js";
import { readFrame, type FrameRead } from "./page/snapshot.js";
import type { ActRequest, ActResult, Control, FrameState, Snapshot } from "./types.js";

/** The part of the WebExtension `browser` object that foxpaw uses. */
export interface ScriptingApi {
  scripting: {
    executeScript(details: {
      target: { tabId: number; allFrames?: boolean; frameIds?: number[]; documentIds?: string[] };
      func: (...args: never[]) => unknown;
      args?: unknown[];
      world?: "ISOLATED" | "MAIN";
      injectImmediately?: boolean;
    }): Promise<{ frameId: number; result?: unknown; error?: unknown; documentId?: string }[]>;
  };
}

/** The global `browser` object of the extension. */
export function api(): ScriptingApi {
  const found = (globalThis as { browser?: ScriptingApi }).browser;
  if (!found?.scripting) throw new Error("foxpaw needs the WebExtension scripting API. Add \"scripting\" to the manifest permissions.");
  return found;
}

/**
 * An executeScript call into a document that is unloading can stay
 * unanswered. Each call gives up after `ms`, so a run never hangs.
 */
function limit<T>(call: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`the page did not answer in ${ms} ms`)), ms); });
  return Promise.race([call, late]).finally(() => clearTimeout(timer));
}

/** Reads every frame of the tab and joins them into one Snapshot. */
export async function snapshot(tabId: number, browser: ScriptingApi = api()): Promise<Snapshot> {
  const results = await limit(browser.scripting.executeScript({
    target: { tabId, allFrames: true }, func: readFrame, world: "ISOLATED", injectImmediately: true,
  }), 5000);
  const reads = results.filter((r): r is typeof r & { result: FrameRead } => !r.error && !!r.result)
    .toSorted((a, b) => a.frameId - b.frameId);
  const top = reads.find((r) => r.frameId === 0)?.result;
  if (!top) throw new Error("Cannot read this page. It may still be loading, or the extension has no access to it.");
  const controls: Control[] = [];
  const frames: FrameState[] = [];
  for (const { frameId, result, documentId } of reads) {
    frames.push({ frameId, url: result.url, key: result.key, ...(documentId ? { documentId } : {}) });
    for (const c of result.controls) {
      const { popupFor, ...rest } = c;
      controls.push({ ...rest, id: `${frameId}:${c.node}`, frameId, ...(popupFor ? { popupFor: `${frameId}:${popupFor}` } : {}) });
    }
  }
  return {
    url: top.url, title: top.title, text: top.text, headings: top.headings, controls, frames,
    captcha: reads.some((r) => r.result.captcha), more: top.more,
  };
}

/**
 * Acts on one control from `page`, the snapshot the decision was made on.
 * The call targets the exact document that snapshot read (Firefox 153+), so
 * a navigation in between makes Firefox refuse it. In the page, the stale
 * check runs first. A page that goes away mid-action gives `navigated`.
 */
export async function act(tabId: number, control: Control, request: ActRequest, page: Snapshot, browser: ScriptingApi = api()): Promise<ActResult> {
  const frame = page.frames.find((f) => f.frameId === control.frameId);
  if (!frame) return { ok: false, reason: "gone", detail: "the snapshot has no such frame" };
  const target = frame.documentId ? { tabId, documentIds: [frame.documentId] } : { tabId, frameIds: [control.frameId] };
  let results: Awaited<ReturnType<ScriptingApi["scripting"]["executeScript"]>>;
  try {
    results = await limit(browser.scripting.executeScript({
      target, func: perform, args: [control.node, request, { guard: control.guard, key: frame.key }], world: "ISOLATED", injectImmediately: true,
    }), 5000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/permission/i.test(message)) throw error;
    return { ok: false, reason: "navigated", detail: message };
  }
  const first = results[0];
  if (!first || first.error || !first.result) return { ok: false, reason: "navigated", detail: first?.error ? String(first.error) : "no result" };
  return first.result as ActResult;
}

/**
 * Waits for the frame to be quiet: no DOM change for 120 ms, at most 1.5 s.
 * With `listFor` (a field's node), it first waits up to 600 ms for the
 * field's suggestion list. Returns the ms waited. A page that navigates
 * away counts as settled.
 */
export async function settle(tabId: number, options: { frameId?: number; listFor?: number } = {}, browser: ScriptingApi = api()): Promise<number> {
  const started = Date.now();
  try {
    const [first] = await limit(browser.scripting.executeScript({
      target: { tabId, frameIds: [options.frameId ?? 0] }, func: quiet, args: [{ listFor: options.listFor }], world: "ISOLATED",
    }), 3000);
    return typeof first?.result === "number" ? first.result : Date.now() - started;
  } catch {
    return Date.now() - started;
  }
}
