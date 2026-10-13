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
  const hiddenPay = await act("Voucher", { op: "enter" });
  check("enter refuses a hidden submit button", { reason: "hidden", url: true }, { reason: hiddenPay.reason, url: page.url().endsWith("/act.html") });
  await act("City", { op: "type", value: "Paris" });
  const city = (await call("act.html", "snapshot")).controls.find((c) => c.label === "City");
  const listWait = await call("act.html", "settle", { listFor: city.node, frameId: city.frameId });
  check("settle returns when no list opens", true, listWait >= 500 && listWait < 1600);
  await page.evaluate("window.tick()");
  const busyWait = await call("act.html", "settle", {});
  check("settle returns on a page that never stops", true, busyWait >= 1400 && busyWait < 1700);

  const rows = await open("rows.html");
  const listed = await call("rows.html", "snapshot");
  const archiveA = listed.controls.find((c) => c.label === "Archive");
  await rows.evaluate("window.dropFirst()");
  const reused = await call("rows.html", "act", archiveA, { op: "click" }, listed);
  check("stale check sees a reused row", { reason: "stale", archived: "none" },
    { reason: reused.reason, archived: await rows.evaluate(() => document.getElementById("archived").textContent) });

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

  // Pickers and the fold (P13-P17): an autocomplete, a text date field with a calendar, tall and far buttons.
  const picker = await open("picker.html");
  const onPicker = async (label, request) => {
    const snap = await call("picker.html", "snapshot");
    const target = snap.controls.find((c) => c.label === label);
    const result = await call("picker.html", "act", target, request, snap);
    await call("picker.html", "settle", { frameId: target.frameId }).catch(() => 0);
    return result;
  };
  const out = (id) => picker.evaluate((i) => document.getElementById(i).textContent, id);
  const twoLondons = await onPicker("From", { op: "select", value: "London" });
  check("select on an ambiguous suggestion list picks nothing", { ok: false, reason: "unsupported", detail: "2 suggestions hold the value", picked: "", value: "London" },
    { ok: twoLondons.ok, reason: twoLondons.reason, detail: twoLondons.detail, picked: await out("picked"), value: await picker.evaluate(() => document.getElementById("from").value) });
  const picked = await onPicker("From", { op: "select", value: "lhr" });
  check("select picks the suggestion that holds the value", { ok: true, picked: "LHR", value: "London Heathrow (LHR)" },
    { ok: picked.ok, picked: await out("picked"), value: await picker.evaluate(() => document.getElementById("from").value) });
  await onPicker("From", { op: "type", value: "London" });
  const fromOpen = await onPicker("From", { op: "select", value: "London Gatwick (LGW)" });
  check("select picks a suggestion that is open already, by its whole text", { ok: true, picked: "LGW" }, { ok: fromOpen.ok, picked: await out("picked") });
  const byCode = await onPicker("From", { op: "select", value: "London Heathrow (LHR)" });
  check("select types the code when the whole text finds no suggestion", { ok: true, picked: "LHR" }, { ok: byCode.ok, picked: await out("picked") });
  const wrongCode = await onPicker("From", { op: "select", value: "London (CDG)" });
  check("select needs the name and the code", { ok: false, reason: "unsupported" }, { ok: wrongCode.ok, reason: wrongCode.reason });
  // A good pick closes the list again, so it does not cover the next field.
  const otherWords = await onPicker("From", { op: "select", value: "London (LHR)" });
  check("select matches a name and a code in other words", { ok: true, picked: "LHR" }, { ok: otherWords.ok, picked: await out("picked") });
  const dated = await onPicker("Depart", { op: "date", value: "12/01/2026" });
  const calendarAfter = await call("picker.html", "snapshot");
  check("date in a text field closes the calendar it opened", { ok: true, value: "12/01/2026", days: 0, hidden: true },
    { ok: dated.ok, value: await picker.evaluate(() => document.getElementById("depart").value), days: calendarAfter.controls.filter((c) => c.label.startsWith("Day ")).length, hidden: await picker.evaluate(() => document.getElementById("calendar").hidden) });
  await picker.evaluate(() => { const d = document.getElementById("depart"); d.blur(); d.focus(); });
  const redrawn = await onPicker("Next month", { op: "click" });
  check("a click that redraws its own button in a form is not a destination change", { ok: true, month: "1", url: true },
    { ok: redrawn.ok, month: await out("month"), url: picker.url().endsWith("/picker.html") });
  await picker.evaluate(() => { document.getElementById("calendar").hidden = true; scrollTo(0, 0); });
  const tall = await onPicker("Tall button", { op: "click" });
  check("a control with its centre below the window is clicked", { ok: true, last: "tall" }, { ok: tall.ok, last: await out("last") });
  await picker.evaluate(() => scrollTo(0, 0));
  await onPicker("Far button", { op: "scroll" });
  check("scroll with no value brings the control into view", true,
    await picker.evaluate(() => { const r = document.getElementById("far").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));

  // Native date and time fields (P19), and a read-only field with a jQuery UI style calendar (P20).
  const dates = await open("dates.html");
  const onDates = async (label, request) => {
    const snap = await call("dates.html", "snapshot");
    return call("dates.html", "act", snap.controls.find((c) => c.label === label), request, snap);
  };
  const fieldValue = (id) => dates.evaluate((i) => document.getElementById(i).value, id);
  const usDate = await onDates("Birthday", { op: "type", value: "11/08/2019" });
  check("a native date field takes a US date", { ok: true, value: "2019-11-08" }, { ok: usDate.ok, value: await fieldValue("birthday") });
  const morning = await onDates("Alarm", { op: "type", value: "10:57 a.m." });
  const evening = await onDates("Alarm", { op: "date", value: "2:05 PM" });
  check("a native time field takes a.m./p.m. time", { ok: [true, true], value: "14:05" }, { ok: [morning.ok, evening.ok], value: await fieldValue("alarm") });
  const notDate = await onDates("Birthday", { op: "type", value: "next Tuesday" });
  check("a value a native field refuses fails", { ok: false, reason: "unsupported", value: "2019-11-08" }, { ok: notDate.ok, reason: notDate.reason, value: await fieldValue("birthday") });
  const dayPicked = await onDates("Date", { op: "date", value: "2016-07-30" });
  check("date on a read-only field picks the day in its calendar", { ok: true, value: "07/30/2016", open: false },
    { ok: dayPicked.ok, value: await fieldValue("dp"), open: await dates.evaluate(() => document.getElementById("ui-datepicker-div")?.style.display === "block") });
  const earlier = await onDates("Date", { op: "type", value: "03/02/2016" });
  check("the calendar pages back to an earlier month", { ok: true, value: "03/02/2016" }, { ok: earlier.ok, value: await fieldValue("dp") });

  // Text a script makes clickable (P21).
  const clicks = await open("clicks.html");
  const clickSnap = await call("clicks.html", "snapshot");
  const clickLabels = clickSnap.controls.map((c) => `${c.role} ${c.label}`);
  const est = clickSnap.controls.find((c) => c.label === "Est");
  const estClick = est ? await call("clicks.html", "act", est, { op: "click" }, clickSnap) : { ok: false };
  check("a clickable span is read as a button and clicked", { labels: ["button Est", "button dictum", "button Lyda", "button Vina"], ok: true, clicked: "Est" },
    { labels: clickLabels.filter((l) => /Est|dictum|Lyda|Vina|Sergio/.test(l)), ok: estClick.ok, clicked: await clicks.evaluate(() => document.getElementById("clicked").textContent) });
  check("clickable text needs its own short text and no control inside", [], clickLabels.filter((l) => /Plain|Card words|paragraph|^button Remember/.test(l)));

  // A fill never sends (C34): select and check refuse a control that sends a form or opens a page (a menu item and a
  // toggle button are refused before that, as controls a fill does not set: C35).
  const sendsPage = await open("sends.html");
  const onSends = async (label, request) => {
    const snap = await call("sends.html", "snapshot");
    return call("sends.html", "act", snap.controls.find((c) => c.label === label), request, snap);
  };
  const refusals = [];
  for (const [label, op] of [["Send as menu item", "select"], ["Send as option", "select"], ["Send as day", "select"], ["Send as toggle", "check"],
    ["Link option", "select"], ["Sneaky option", "select"], ["Sneaky box", "check"]]) refusals.push((await onSends(label, { op })).reason);
  check("a fill refuses a control that sends a form or opens a page", { reasons: ["unsupported", "submit", "submit", "unsupported", "submit", "submit", "submit"], sent: "0", url: true },
    { reasons: refusals, sent: await sendsPage.evaluate(() => document.getElementById("sent").textContent), url: sendsPage.url().endsWith("/sends.html") });
  // C35: form.submit() fires no submit event, so a fill op must never click a button, a menu item or clickable text.
  const quiet = [];
  for (const [label, op] of [["Quiet send", "check"], ["Quiet text", "check"], ["Quiet send", "select"], ["Quiet text", "type"], ["Send as toggle", "uncheck"], ["Team plan", "select"]]) {
    const r = await onSends(label, { op, value: "x" }).catch(() => ({ ok: false, reason: "page gone" }));
    quiet.push(`${label}/${op}:${r.ok ? "ok" : r.reason}`);
  }
  const quietUrl = sendsPage.url().endsWith("/sends.html");
  if (!quietUrl) await sendsPage.goto(`${site.url}/sends.html`);
  check("a fill never clicks a button or clickable text, even one that sends with form.submit()",
    { results: ["Quiet send/check:unsupported", "Quiet text/check:unsupported", "Quiet send/select:unsupported", "Quiet text/type:unsupported", "Send as toggle/uncheck:unsupported", "Team plan/select:unsupported"], url: true, picked: "none" },
    { results: quiet, url: quietUrl, picked: await sendsPage.evaluate(() => document.getElementById("picked").textContent) });
  // C36: a settable control's own handler that sends with form.submit(), a link click or a timer is blocked.
  const owned = [];
  const findBy = async (starts) => (await call("sends.html", "snapshot")).controls.find((c) => c.label.startsWith(starts) && c.role !== "button");
  for (const [label, op, value] of [["Auto plan", "select", "b"], ["Auto box", "check"], ["Covered box", "check"], ["Link box", "check"], ["Later box", "check"]]) {
    const snap = await call("sends.html", "snapshot").catch(() => null);
    const target = snap && (await findBy(label));
    const r = target ? await call("sends.html", "act", target, { op, ...(value ? { value } : {}) }, await call("sends.html", "snapshot")).catch(() => ({ ok: false, reason: "page gone" })) : { ok: false, reason: "not found" };
    owned.push(`${label}:${r.ok ? "ok" : r.reason}`);
    await new Promise((done) => setTimeout(done, 300));
  }
  const ownedUrl = sendsPage.url().endsWith("/sends.html");
  if (!ownedUrl) await sendsPage.goto(`${site.url}/sends.html`);
  check("a fill blocks form.submit(), requestSubmit() and a link click from a control's own handler",
    { url: true, sent: true, results: ["Auto plan:submit", "Auto box:submit", "Covered box:ok", "Link box:submit"] },
    { url: ownedUrl, sent: true, results: owned.slice(0, 4) });
  // C37: a deferred click on a submit button after a fill op, and a send from a native date field's change handler.
  const deferred = [];
  for (const [label, op, value] of [["Timer box", "check"], ["Send date", "date", "2026-10-20"]]) {
    const snap = await call("sends.html", "snapshot").catch(() => null);
    const target = snap?.controls.find((c) => c.label.startsWith(label));
    const r = target ? await call("sends.html", "act", target, { op, ...(value ? { value } : {}) }, snap).catch(() => ({ ok: false, reason: "page gone" })) : { ok: false, reason: "not found" };
    deferred.push(`${label}:${r.ok ? "ok" : r.reason}`);
    await new Promise((done) => setTimeout(done, 400));
  }
  const deferredUrl = sendsPage.url().endsWith("/sends.html");
  const deferredSent = deferredUrl ? await sendsPage.evaluate(() => document.getElementById("sent").textContent) : "navigated";
  if (!deferredUrl) await sendsPage.goto(`${site.url}/sends.html`);
  check("a fill blocks a deferred click on a submit button and a send from a native date field",
    { results: ["Timer box:ok", "Send date:submit"], url: true, sent: "0" }, { results: deferred, url: deferredUrl, sent: deferredSent });
  const outside = await onSends("Outside option", { op: "select" });
  check("a fill still picks an option that sends nothing", { outside: true, picked: "outside" },
    { outside: outside.ok, picked: await sendsPage.evaluate(() => document.getElementById("picked").textContent) });

  // Page text for a planner: the trim, and the diff after an action (T1-T7, D1-D5).
  const textOf = (fn, ...a) => ext.evaluate((f, args) => window.foxpaw[f](...args), fn, a);
  await open("menu.html");
  const store = await call("menu.html", "snapshot");
  const storeText = await textOf("pageText", store);
  const realIds = new Set(store.controls.map((c) => c.id));
  const foldIds = [...(/\(5 links: (.*)\)/.exec(storeText)?.[1] ?? "").matchAll(/=(\d+:\d+)/g)].map((m) => m[1]);
  check("trim folds the menu and keeps the field inside it", { fold: 5, ids: true, search: true, submit: true },
    { fold: foldIds.length, ids: foldIds.every((id) => realIds.has(id)), search: storeText.includes('searchbox "Search the store"'), submit: storeText.includes('"Sign in" (sends the form)') });
  check("trim keeps hidden text out", false, storeText.includes("evil.example"));
  const password = store.controls.find((c) => c.label === "Password");
  await call("menu.html", "act", password, { op: "type", value: "hunter2-secret" }, store);
  const typed2 = await call("menu.html", "snapshot");
  const typedDiff = await textOf("changeText", store, typed2, { target: password.id });
  check("diff shows a password as masked, never as empty or plain", { full: false, masked: true, plain: false },
    { full: typedDiff.full, masked: typedDiff.text.includes('"Password" value="•••"'), plain: typedDiff.text.includes("hunter2") });
  await call("menu.html", "act", typed2.controls.find((c) => c.label === "Sign in"), { op: "click" }, typed2);
  const failedSignIn = await call("menu.html", "snapshot");
  const errorDiff = await textOf("changeText", typed2, failedSignIn);
  check("diff shows a new error message", { full: false, error: true, short: true },
    { full: errorDiff.full, error: errorDiff.text.includes("Wrong email or password."), short: errorDiff.text.length < storeText.length / 2 });
  const petsId = /"Pets"=(\d+:\d+)/.exec(storeText)?.[1];
  const pets = failedSignIn.controls.find((c) => c.id === petsId);
  await call("menu.html", "act", pets, { op: "click" }, failedSignIn);
  await call("menu.html", "settle", {}).catch(() => 0);
  await new Promise((done) => setTimeout(done, 500));
  const moved = await call("thanks.html", "snapshot");
  const movedDiff = await textOf("changeText", failedSignIn, moved);
  check("a folded link works by the id in the text, and a navigation gives the whole page", { full: true, url: true, folded: true }, { full: movedDiff.full, url: moved.url.includes("thanks.html?c=7"), folded: !storeText.includes('link "Pets"') });

  // Run: snapshot -> choose -> stale check -> act -> settle -> verify, with ruleChooser.
  const runs = (record.runs = {});
  const run = async (path, goal, options) => {
    await open(path);
    const result = await call(path, "run", goal, options);
    runs[path] = result;
    return result;
  };
  const booked = await run("form.html", "Name: Sam Lee, email: sam@example.com, from San Francisco, depart December 3, 2026, cabin Business, accept the terms");
  check("form run is verified", { status: "done", verified: true }, { status: booked.status, verified: booked.verified });
  const sent = new URL(booked.url).searchParams;
  check("form run sent every value", ["Sam Lee", "sam@example.com", "San Francisco, CA", "Thu, Dec 3, 2026", "Business", "on"],
    [sent.get("name"), sent.getAll("email").join(""), sent.get("from"), sent.get("depart"), sent.get("cabin"), sent.get("terms")]);
  check("hidden duplicates stay empty", ["", ""], [sent.getAll("email")[0], sent.get("email-copy")]);
  check("driven tab is in a foxpaw tab group", true, (booked.group ?? "").startsWith("foxpaw · "));
  const failed = await run("signup.html", "email: sam@example.com");
  check("error page is not verified", { status: "done", verified: false, problem: "error page" }, { status: failed.status, verified: failed.verified, problem: failed.problem });
  const nowhere = await run("search.html", "search: tab groups");
  check("a send with no effect is not verified", { status: "blocked", reason: "the form did not send", verified: false },
    { status: nowhere.status, reason: nowhere.blockedReason, verified: nowhere.verified });
  const away = await run("away.html", "email: sam@example.com");
  check("run does not send a form that posts to another site", { status: "blocked", reason: `the form sends to localhost:${new URL(site.url).port}, which is not the origin of this page`, acted: [] },
    { status: away.status, reason: away.blockedReason, acted: away.steps.map((s) => s.action) });
  const lookalike = await run("lookalike.html", "full name: Sam Park, email: sam.park@example.com, card number: 4242 4242 4242 4242, expiry: 12/29, CVC: 123, pay");
  const paid = new URL(lookalike.url);
  check("run fills and sends only the form that fits the goal", { status: "done", page: "/thanks.html", card: "4242 4242 4242 4242", express: false },
    { status: lookalike.status, page: paid.pathname, card: paid.searchParams.get("card"), express: lookalike.steps.some((s) => s.action === "Pay with Express") });
  const twin = await run("twin.html", 'email: sam@example.com, card number: 4242 4242 4242 4242, then click "Pay $40.00"');
  check("two forms that fit the same are not guessed", { status: "blocked", ambiguous: true, steps: 0 },
    { status: twin.status, ambiguous: (twin.blockedReason ?? "").startsWith("two forms fit the goal"), steps: twin.steps.length });
  for (const on of ["pointerdown", "submit"]) {
    const shifted = await run(`moved.html?on=${on}`, "email: sam@example.com");
    const left = (await fox.browser.pages()).some((p) => p.url().includes("attacker.test"));
    check(`a send whose action changes on ${on} is refused`, { status: "blocked", reason: "the form's destination changed as foxpaw sent it", left: false },
      { status: shifted.status, reason: shifted.blockedReason, left });
  }
  const linked = await run("away.html", "open partner profile, name: Sam Lee");
  check("run does not act after a link to another site", { status: "blocked", reason: "the page moved to another site", acted: ["Partner profile"] },
    { status: linked.status, reason: linked.blockedReason, acted: linked.steps.map((s) => s.action) });
  const allowed = await run("away.html", "open partner profile, name: Sam Lee", { allowHosts: ["localhost"] });
  check("allowHosts lets the run go on", { status: "done", acted: ["Partner profile", "Name", "Save"] }, { status: allowed.status, acted: allowed.steps.map((s) => s.action) });
  const captcha = await run("captcha.html", "email: sam@example.com");
  check("captcha page is blocked", { status: "blocked", reason: "captcha", steps: 0 }, { status: captcha.status, reason: captcha.blockedReason, steps: captcha.steps.length });
  const newsRun = await run("frames.html", "Newsletter email: sam@example.com");
  const shown = await ext.evaluate(() => ({ steps: document.querySelectorAll("#steps li").length, checks: document.querySelectorAll("#checks li.ok").length, status: document.getElementById("status").textContent }));
  check("sidebar shows the steps and the checklist", { steps: 2, checks: 2, status: true }, { ...shown, status: shown.status.startsWith("Done and verified") });
  check("iframe form run is verified", { status: "done", verified: true, sent: true }, { status: newsRun.status, verified: newsRun.verified, sent: newsRun.steps.some((s) => s.submitted) });
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
