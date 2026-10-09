// The demo sidebar. You type a goal for the current tab, and it shows each
// step and the result checklist. It uses ruleChooser: this build bundles no
// model. The E2E test drives the same code through window.foxpaw.
import { act, runTask, settle, snapshot } from "../src/index.ts";

const $ = (id) => document.getElementById(id);

/** The id of the newest tab whose address starts with `prefix`. */
async function tabFor(prefix) {
  const tabs = await browser.tabs.query({});
  const tab = tabs.findLast((t) => t.url?.startsWith(prefix));
  if (!tab) throw new Error(`No tab at ${prefix}`);
  return tab.id;
}

function item(list, text, className) {
  const li = document.createElement("li");
  li.textContent = text;
  if (className) li.className = className;
  list.append(li);
}

/** Runs a goal on a tab, shows the steps and the checklist, and returns the run result. */
async function run(tabId, goal, options = {}) {
  $("run").disabled = true;
  $("steps").replaceChildren();
  $("checks").replaceChildren();
  $("status").className = "";
  $("status").textContent = "Running…";
  try {
    const result = await runTask(tabId, goal, {
      ...options,
      group: true,
      onStep: (s) => item($("steps"), `${s.operation} "${s.action}"${s.text ? ` = ${s.text}` : ""}${s.ok ? "" : ` (refused: ${s.reason})`}`, s.ok ? "" : "refused"),
    });
    for (const c of result.checks) item($("checks"), `${c.part}: ${c.evidence}`, c.ok ? "ok" : "bad");
    if (result.problem) item($("checks"), `The page looks like: ${result.problem}`, "bad");
    $("status").textContent = result.verified ? `Done and verified in ${(result.totalMs / 1000).toFixed(1)} s.`
      : result.status === "blocked" ? `Blocked: ${result.blockedReason}.` : result.message ?? "Done, but not verified.";
    $("status").className = result.verified ? "done" : "bad";
    const tab = await browser.tabs.get(tabId);
    const group = tab.groupId >= 0 ? (await browser.tabGroups.get(tab.groupId)).title : null;
    return { ...result, group };
  } finally {
    $("run").disabled = false;
  }
}

$("goal-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  await run(tab.id, $("goal").value).catch((error) => { $("status").textContent = error.message; });
});

window.foxpaw = { snapshot, act, settle, run, tabFor };
