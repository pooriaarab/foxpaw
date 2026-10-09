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
  const tabPage = async (path) => (await fox.browser.pages()).find((p) => p.url().startsWith(`${site.url}/${path}`));

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

  // Act
  const page = await open("act.html");
  const act = async (label, request, before) => {
    const snap = await call("act.html", "snapshot");
    const target = snap.controls.find((c) => c.label === label);
    if (before) await page.evaluate(before);
    return call("act.html", "act", target, request, snap);
  };
  const text = (id) => page.evaluate((i) => document.getElementById(i).textContent, id);
  await act("Display name", { op: "type", value: "Sam Lee" });
  await act("Save changes", { op: "click" });
  check("react state holds the typed value", "Sam Lee", await text("mirror"));
  const stale = await act("Delete account", { op: "click" }, "window.swap(); document.getElementById('last').textContent = 'none'");
  check("stale check refuses a changed page", { reason: "stale", last: "none" }, { reason: stale.reason, last: await text("last") });
  check("covered control is refused", "covered", (await act("Covered button", { op: "click" })).reason);
  check("disabled submit is refused", "disabled", (await act("Apply", { op: "click" })).reason);
  await act("City", { op: "type", value: "Paris" });
  const city = (await call("act.html", "snapshot")).controls.find((c) => c.label === "City");
  const listWait = await call("act.html", "settle", { listFor: city.node, frameId: city.frameId });
  check("settle returns when no list opens", true, listWait >= 500 && listWait < 1600);
  await page.evaluate("window.tick()");
  const busyWait = await call("act.html", "settle", {});
  check("settle returns on a page that never stops", true, busyWait >= 1400 && busyWait < 1700);

  await open("frames.html");
  const embedded = await call("frames.html", "snapshot");
  const search = embedded.controls.find((c) => c.label === "Search the docs");
  await call("frames.html", "act", search, { op: "type", value: "tab groups" }, embedded);
  const go = (await call("frames.html", "snapshot")).controls.find((c) => c.label === "Search");
  await call("frames.html", "act", go, { op: "click" }, await call("frames.html", "snapshot"));
  check("shadow DOM field is read and filled", "tab groups", await (await tabPage("frames.html")).evaluate(() => document.getElementById("query").textContent));
  const news = embedded.controls.find((c) => c.label === "Newsletter email");
  const typed = await call("frames.html", "act", news, { op: "type", value: "sam@example.com" }, await call("frames.html", "snapshot"));
  check("iframe form is read and filled", { frame: true, value: "sam@example.com" }, { frame: news.frameId !== 0, value: typed.value });

  // Run: snapshot -> choose -> stale check -> act -> settle -> verify, with ruleChooser.
  const runs = (record.runs = {});
  const run = async (path, goal) => {
    await open(path);
    const result = await call(path, "run", goal);
    runs[path] = result;
    return result;
  };
  const booked = await run("form.html", "Name: Sam Lee, email: sam@example.com, from San Francisco, depart December 3, 2026, cabin Business, accept the terms");
  check("form run is verified", { status: "done", verified: true }, { status: booked.status, verified: booked.verified });
  const sent = new URL(booked.url).searchParams;
  check("form run sent every value", ["Sam Lee", "sam@example.com", "San Francisco, CA", "Thu, Dec 3, 2026", "Business", "on"],
    [sent.get("name"), sent.getAll("email").join(""), sent.get("from"), sent.get("depart"), sent.get("cabin"), sent.get("terms")]);
  check("hidden duplicates stay empty", ["", ""], [sent.getAll("email")[0], sent.get("email-copy")]);
  check("driven tab is in a foxpaw tab group", true, /^foxpaw · /.test(booked.group ?? ""));
  const failed = await run("signup.html", "email: sam@example.com");
  check("error page is not verified", { status: "done", verified: false, problem: "error page" }, { status: failed.status, verified: failed.verified, problem: failed.problem });
  const captcha = await run("captcha.html", "email: sam@example.com");
  check("captcha page is blocked", { status: "blocked", reason: "captcha", steps: 0 }, { status: captcha.status, reason: captcha.blockedReason, steps: captcha.steps.length });
  const news = await run("frames.html", "Newsletter email: sam@example.com");
  check("iframe form run is verified", { status: "done", verified: true }, { status: news.status, verified: news.verified });
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
