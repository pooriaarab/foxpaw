// The E2E test: install the demo extension (dist-ext/) in a real Firefox,
// open the fixture pages in e2e/site, drive them through window.foxpaw in the
// extension's sidebar page, and write artifacts/e2e-<date>.json.
// Usage: pnpm e2e [--headed]. Env: FIREFOX (the Firefox binary).
import { launch, serve, writeArtifact } from "create-foxkit/e2e";

const record = { startedAt: new Date().toISOString(), checks: [] };
const check = (name, expected, actual) => record.checks.push({ name, expected, actual, ok: JSON.stringify(actual) === JSON.stringify(expected) });

const site = await serve("e2e/site");
let fox;
try {
  fox = await launch({ extension: "dist-ext", headless: !process.argv.includes("--headed") });
  record.firefox = await fox.browser.version();
  const ext = await fox.openExtensionPage("sidebar.html");
  /** Runs window.foxpaw[name](tabId of the page at `path`, ...args) in the sidebar page. */
  const call = (path, fn, ...rest) => ext.evaluate(async (url, f, a) => {
    const tabId = await window.foxpaw.tabFor(url);
    return window.foxpaw[f](tabId, ...a);
  }, `${site.url}/${path}`, fn, rest);
  const open = (path) => fox.open(`${site.url}/${path}`);

  // Read
  await open("read.html");
  const read = await call("read.html", "snapshot");
  const by = (label) => read.controls.find((c) => c.label === label);
  record.documentIds = read.frames.every((f) => typeof f.documentId === "string");
  check("hidden duplicates are not read", ["Email"], read.controls.filter((c) => /email/i.test(c.label)).map((c) => c.label));
  check("controls are read in page order", ["Email", "Plan", "I accept the terms", "Create account"], read.controls.map((c) => c.label));
  check("select options are read", ["Free", "Team"], by("Plan")?.options?.map((o) => o.label));
  check("checkbox state is read", false, by("I accept the terms")?.checked);
  check("disabled submit is marked", { submit: true, disabled: true }, { submit: by("Create account")?.submit, disabled: by("Create account")?.disabled });
} catch (error) {
  record.error = error instanceof Error ? error.stack ?? error.message : String(error);
} finally {
  await fox?.close();
  await site.close();
}
record.passed = !record.error && record.checks.length > 0 && record.checks.every((c) => c.ok);
const path = writeArtifact("artifacts", "e2e", record);
for (const c of record.checks) console.log(`${c.ok ? "ok " : "BAD"} ${c.name}: ${JSON.stringify(c.actual)}`);
console.log(`${record.passed ? "PASS" : "FAIL"}${record.error ? `: ${record.error}` : ""} | ${path}`);
process.exitCode = record.passed ? 0 : 1;
