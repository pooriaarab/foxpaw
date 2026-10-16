// The demo's background script (an event page in Firefox MV3). The toolbar
// button opens the sidebar, where the demo runs.
import { perform } from "../src/page/act.ts";
import { quiet } from "../src/page/settle.ts";
import { readFrame } from "../src/page/snapshot.ts";

browser.action.onClicked.addListener(() => {
  browser.sidebarAction.open();
});

// E2E build only. The test frames the sidebar in a remote browser, and a frame
// cannot send a function to scripting.executeScript or reach tabGroups. The
// sidebar sends the call here, by the function's name, and this page runs it.
if (__E2E__) {
  const pageFunctions = { readFrame, perform, quiet };
  browser.runtime.onMessage.addListener((message) => {
    const call = message?.foxpawCall;
    if (!call) return undefined;
    if (call.api === "tabGroups") return browser.tabGroups[call.method](...call.args);
    const { func, ...details } = call.args[0];
    return browser.scripting.executeScript({ ...details, func: pageFunctions[func] });
  });
}
