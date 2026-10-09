// V1-V8: the result checklist, on hand-built snapshots.
import { describe, expect, it } from "vitest";
import { ruleChooser } from "../src/choosers/rule.js";
import { start, type RunState } from "../src/controller.js";
import type { Control, Snapshot } from "../src/types.js";
import { verify } from "../src/verify.js";

const TODAY = new Date(2026, 8, 25);
let n = 0;
const c = (label: string, more: Partial<Control> = {}): Control => {
  n += 1;
  return {
    id: `0:${n}`, frameId: 0, node: n, role: "textbox", tag: "input", type: "text", label, name: "", placeholder: "", section: "",
    value: "", disabled: false, readOnly: false, required: false, offscreen: false, form: 1, submit: false, dialog: false,
    autocomplete: false, picker: false, secret: false, guard: "", ...more,
  };
};
const page = (controls: Control[], more: Partial<Snapshot> = {}): Snapshot => ({
  url: "http://fixture/", title: "Sign up", text: "Sign up\nEmail", headings: ["Sign up"], controls, captcha: false, more: false,
  frames: [{ frameId: 0, url: "http://fixture/", key: "k", documentId: "doc" }], ...more,
});
/** A run that filled the form and, with `sent`, sent it. */
async function run(goal: string, sent: boolean): Promise<RunState> {
  const state = await start(goal, ruleChooser(), TODAY);
  state.status = state.requirements.map(() => "done");
  state.filled.add("doc#0:form1");
  state.sent = sent;
  return state;
}
const ok = (checks: { part: string; ok: boolean }[]) => Object.fromEntries(checks.map((k) => [k.part, k.ok]));

describe("verify", () => {
  it("needs a field that shows each value (V1)", async () => {
    const state = await run("email: sam@example.com, name: Sam Lee", true);
    const good = await verify(page([c("Email", { value: "sam@example.com" }), c("Name", { value: "Sam Lee" })]), state);
    expect(good.verified).toBe(true);
    const bad = await verify(page([c("Email", { value: "sam@example.org" }), c("Name", { value: "" })]), state);
    expect(ok(bad.checks)).toMatchObject({ "email: sam@example.com": false, "name: Sam Lee": false });
    expect(bad.verified).toBe(false);
  });

  it("does not count a success banner next to an unrelated form (V2)", async () => {
    const state = await run("email: sam@example.com", false);
    const banner = page([c("Email", { value: "sam@example.com" }), c("Newsletter email", { form: 2 })], { text: "Sign up\nThanks for subscribing!" });
    const verdict = await verify(banner, state);
    expect(ok(verdict.checks)["Form sent"]).toBe(false);
    expect(verdict.verified).toBe(false);
  });

  it("fails an error page after the send (V3)", async () => {
    const state = await run("email: sam@example.com", true);
    const before = page([c("Email", { value: "sam@example.com" })]);
    const verdict = await verify(page([], { title: "Error 500", headings: ["Something went wrong"], text: "Something went wrong\nPlease try again later." }), state, before);
    expect(verdict.problem).toBe("error page");
    expect(verdict.verified).toBe(false);
  });

  it("fails a captcha page (V4)", async () => {
    const state = await run("email: sam@example.com", true);
    const verdict = await verify(page([c("Email", { value: "sam@example.com" })], { captcha: true }), state);
    expect(verdict.problem).toBe("captcha");
  });

  it("fails an empty page (V5)", async () => {
    const state = await run("email: sam@example.com", true);
    const verdict = await verify(page([], { title: "", headings: [], text: "" }), state, page([c("Email", { value: "sam@example.com" })]));
    expect(verdict.problem).toBe("empty page");
  });

  it("checks values on the page as it was sent, when the send navigated (V6)", async () => {
    const state = await run("email: sam@example.com, depart December 3, 2026", true);
    const before = page([c("Email", { value: "sam@example.com" }), c("Depart", { value: "Thu, Dec 3, 2026", picker: true, readOnly: true })]);
    const thanks = page([], { title: "Booking received", headings: ["Booking received"], text: "Booking received\nWe sent the details." });
    const verdict = await verify(thanks, state, before);
    expect(verdict.checks).toEqual([
      { part: "email: sam@example.com", ok: true, evidence: "Email: sam@example.com" },
      { part: "depart December 3, 2026", ok: true, evidence: "Depart: Thu, Dec 3, 2026" },
      { part: "Form sent", ok: true, evidence: "the run sent the form it filled" },
    ]);
    expect(verdict.verified).toBe(true);
  });

  it("needs a setting to be on (V7)", async () => {
    const state = await run("accept the terms, cabin Business", true);
    const on = page([c("I accept the terms", { role: "checkbox", type: "checkbox", checked: true }),
      c("Cabin", { role: "combobox", tag: "select", type: "", options: [{ value: "b", label: "Business", selected: true }] })]);
    expect((await verify(on, state)).verified).toBe(true);
    const off = page([c("I accept the terms", { role: "checkbox", type: "checkbox", checked: false }),
      c("Cabin", { role: "combobox", tag: "select", type: "", options: [{ value: "b", label: "Business", selected: false }] })]);
    expect(ok((await verify(off, state)).checks)).toMatchObject({ "accept the terms": false, "cabin Business": false });
  });

  it("does not read a form hint with 'error' in it as an error page (V8)", async () => {
    const state = await run("email: sam@example.com", true);
    const hinted = page([c("Email", { value: "sam@example.com" })], { text: "Sign up\nError: use your work email\nEmail" });
    expect((await verify(hinted, state)).problem).toBeUndefined();
  });

  it("does not check a setting no control matched, but does check an unmatched value", async () => {
    const state = await run("Find a flight, to: Boston", true);
    state.status = ["unmatched", "unmatched"];
    state.unmatched = [...state.requirements];
    const verdict = await verify(page([c("Email")]), state);
    expect(verdict.checks.map((k) => [k.part, k.ok])).toEqual([["to: Boston", false], ["Form sent", true]]);
  });

  it("fails Form sent when the run tried but nothing was sent (V9)", async () => {
    const state = await run("email: sam@example.com", false);
    state.tried.add("doc#0:form1");
    const verdict = await verify(page([c("Email", { value: "sam@example.com" })]), state);
    expect(verdict.checks.at(-1)).toEqual({ part: "Form sent", ok: false, evidence: "the run tried to send the form, but no submit event fired and the page did not change" });
    expect(verdict.verified).toBe(false);
  });

  it("reads a clicked toggle's state after the run (V10)", async () => {
    const state = await run("dark mode", true);
    const toggle = c("Dark mode", { role: "switch", form: undefined, checked: false });
    state.history.push({ step: 1, operation: "CLICK", action: "Dark mode", controlId: toggle.id, requirement: "dark mode", text: null, ok: true });
    expect(ok((await verify(page([toggle]), state)).checks)["dark mode"]).toBe(false);
    const plain = c("Open settings", { role: "button", form: undefined });
    const opened = await run("open settings", true);
    opened.history.push({ step: 1, operation: "CLICK", action: "Open settings", controlId: plain.id, requirement: "open settings", text: null, ok: true });
    expect(ok((await verify(page([plain]), opened)).checks)["open settings"]).toBe(true);
  });
});
