// The demo sidebar. It runs foxpaw on a tab. The E2E test calls the same
// functions through window.foxpaw.
import { snapshot } from "../src/index.ts";

/** The id of the first tab whose address starts with `prefix`. */
async function tabFor(prefix) {
  const tabs = await browser.tabs.query({});
  const tab = tabs.find((t) => t.url?.startsWith(prefix));
  if (!tab) throw new Error(`No tab at ${prefix}`);
  return tab.id;
}

window.foxpaw = { snapshot, tabFor };
