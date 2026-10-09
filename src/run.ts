// The loop: snapshot -> choose -> stale check -> act -> settle, until the
// controller says done or blocked. Then verify the page. The result has the
// shape of foxpilot's run_task result, so foxbench can score either.
import type { Chooser } from "./choosers/chooser.js";
import { ruleChooser } from "./choosers/rule.js";
import { confirmSend, decide, record, start, type StepRecord } from "./controller.js";
import { groupTab } from "./tabgroup.js";
import { act, api, settle, snapshot, type ScriptingApi } from "./tab.js";
import type { Snapshot } from "./types.js";
import { verify, type Check } from "./verify.js";

export interface RunOptions {
  /** Default: ruleChooser(). */
  chooser?: Chooser;
  /** Default: 40. */
  maxSteps?: number;
  /** "Today" for relative dates. Default: now. */
  today?: Date;
  /** Put the tab in a "foxpaw" tab group that shows the step. Default: false. */
  group?: boolean;
  /** Called after each action. */
  onStep?: (step: StepRecord) => void;
  /** Stops the run before the next action. */
  signal?: AbortSignal;
  /** The WebExtension `browser` object. Default: the global one. */
  browser?: ScriptingApi & { tabs?: { get(tabId: number): Promise<{ status?: string }> } };
}

export interface RunResult {
  goal: string;
  /** The tab's address when the run ended. */
  url: string;
  status: "done" | "blocked" | "stopped" | "error";
  message?: string;
  /** Why the run stopped, when it is blocked. */
  blockedReason?: string;
  /** True only when the status is done and every check passed. */
  verified: boolean;
  checks: Check[];
  problem?: string;
  steps: StepRecord[];
  refusals: { step: number; action: string; reason: string; detail?: string }[];
  /** Parts of the goal no control fitted. */
  unmatched: string[];
  chooser: string;
  totalMs: number;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Reads the tab, waiting up to 10 s for a document that can be read. */
async function readTab(tabId: number, browser: RunOptions["browser"] & ScriptingApi): Promise<Snapshot> {
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await browser.tabs?.get(tabId))?.status !== "loading") return await snapshot(tabId, browser);
    } catch (error) {
      if (attempt >= 50) throw error;
    }
    if (attempt >= 50) return snapshot(tabId, browser);
    await sleep(200);
  }
}

export async function runTask(tabId: number, goal: string, options: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const browser = options.browser ?? api();
  const chooser = options.chooser ?? ruleChooser();
  const state = await start(goal, chooser, options.today, { maxSteps: options.maxSteps });
  const group = options.group ? await groupTab(tabId) : null;
  const result: RunResult = {
    goal, url: "", status: "error", verified: false, checks: [], steps: state.history, refusals: state.refusals,
    unmatched: [], chooser: chooser.name, totalMs: 0,
  };
  let page: Snapshot | null = null;
  let sentFrom: Snapshot | undefined;
  try {
    page = await readTab(tabId, browser);
    for (;;) {
      if (options.signal?.aborted) {
        result.status = "stopped";
        break;
      }
      const next = await decide(state, page, chooser);
      if (next.kind === "done") {
        result.status = "done";
        break;
      }
      if (next.kind === "blocked") {
        result.status = "blocked";
        result.blockedReason = next.reason;
        break;
      }
      if (next.effect === "send") sentFrom = page;
      await group?.title(`foxpaw · step ${state.history.length + 1}`);
      const outcome = await act(tabId, next.control, next.request, page, browser);
      record(state, next, outcome, page);
      options.onStep?.(state.history.at(-1)!);
      // A send may start a navigation: give it a moment to begin.
      if (next.effect === "send" && outcome.ok) await sleep(250);
      await settle(tabId, { frameId: next.control.frameId, ...(next.effect === "list" ? { listFor: next.control.node } : {}) }, browser);
      page = await readTab(tabId, browser);
      if (next.effect === "send" && sentFrom) confirmSend(state, sentFrom, page);
    }
  } catch (error) {
    result.status = "error";
    result.message = error instanceof Error ? error.message : String(error);
  }
  if (page) {
    const verdict = verify(page, state, sentFrom);
    result.url = page.url;
    result.checks = verdict.checks;
    if (verdict.problem) result.problem = verdict.problem;
    result.verified = result.status === "done" && verdict.verified;
  }
  result.unmatched = state.unmatched.map((r) => r.text);
  result.totalMs = Date.now() - started;
  await group?.title(`foxpaw · ${result.status === "done" ? (result.verified ? "done" : "not verified") : result.status}`,
    result.verified ? "green" : result.status === "done" ? "yellow" : "red");
  return result;
}
