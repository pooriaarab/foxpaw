// The extension side of the page functions. Each call goes through
// `browser.scripting.executeScript` with a bundled function and JSON args.
// No CDP, no `debugger` permission, no `userScripts`, no code strings.
import { readFrame, type FrameRead } from "./page/snapshot.js";
import type { Control, FrameState, Snapshot } from "./types.js";

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

/** Reads every frame of the tab and joins them into one Snapshot. */
export async function snapshot(tabId: number, browser: ScriptingApi = api()): Promise<Snapshot> {
  const results = await browser.scripting.executeScript({
    target: { tabId, allFrames: true }, func: readFrame, world: "ISOLATED", injectImmediately: true,
  });
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
