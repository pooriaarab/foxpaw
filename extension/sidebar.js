// The demo sidebar. It runs foxpaw on a tab. The E2E test calls the same
// functions through window.foxpaw.
import { act, runTask, settle, snapshot } from "../src/index.ts";

/** The id of the newest tab whose address starts with `prefix`. */
async function tabFor(prefix) {
  const tabs = await browser.tabs.query({});
  const tab = tabs.findLast((t) => t.url?.startsWith(prefix));
  if (!tab) throw new Error(`No tab at ${prefix}`);
  return tab.id;
}

/** Runs a goal on a tab with ruleChooser and reports the tab group title. */
async function run(tabId, goal) {
  const result = await runTask(tabId, goal, { group: true });
  const tab = await browser.tabs.get(tabId);
  const group = tab.groupId >= 0 ? (await browser.tabGroups.get(tab.groupId)).title : null;
  return { ...result, group };
}

window.foxpaw = { snapshot, act, settle, run, tabFor };
