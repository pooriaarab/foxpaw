// Waits for the page to be quiet after an action. Sent as source by
// scripting.executeScript, so it uses nothing from module scope.
// Adapted from foxpilot's settle.ts (MIT).

/**
 * Resolves when the DOM has not changed for `quietMs`, or at `capMs`.
 * With `listFor`, it first waits for that field's suggestion list to show
 * options, up to `listMs`. Returns the time it waited, in ms.
 */
export function quiet(options: { listFor?: number; listMs?: number; quietMs?: number; capMs?: number }): Promise<number> {
  const { listFor, listMs = 600, quietMs = 120, capMs = 1500 } = options;
  return new Promise((resolve) => {
    const started = performance.now();
    let last = started;
    const observer = new MutationObserver((records) => {
      // The action outline is not the page.
      if (records.some((r) => ![...r.addedNodes, ...r.removedNodes].some((n) => (n as HTMLElement).dataset?.foxpaw === "mark"))) {
        last = performance.now();
      }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    const field = listFor === undefined ? null : window.__foxpaw?.nodes.get(listFor);
    const hasOptions = () => {
      if (!field) return true;
      const ids = `${field.getAttribute("aria-controls") || ""} ${field.getAttribute("aria-owns") || ""}`.trim().split(/\s+/).filter(Boolean);
      return ids.map((id) => document.getElementById(id)).some((list) => !!list && [...list.querySelectorAll('[role="option"],[role="gridcell"]')]
        .some((o) => o.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })));
    };
    const step = () => {
      const now = performance.now();
      const listed = hasOptions() || now - started >= listMs;
      if ((listed && now - last >= quietMs && now - started >= quietMs) || now - started >= capMs) {
        observer.disconnect();
        resolve(Math.round(now - started));
        return;
      }
      setTimeout(step, 30);
    };
    setTimeout(step, 30);
  });
}
