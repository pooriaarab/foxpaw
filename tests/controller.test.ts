// C3-C13: the controller's rules, on hand-built snapshots, with ruleChooser.
import { describe, expect, it } from "vitest";
import { ruleChooser } from "../src/choosers/rule.js";
import { decide, record, start, type Next, type RunState } from "../src/controller.js";
import type { ActResult, Control, Snapshot } from "../src/types.js";

const TODAY = new Date(2026, 8, 25);
const chooser = ruleChooser();
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
  url: "http://fixture/", title: "Fixture", text: "", headings: [], controls, captcha: false, more: false,
  frames: [{ frameId: 0, url: "http://fixture/", key: "k", documentId: "doc" }], ...more,
});
const ok: ActResult = { ok: true };
const target = (next: Next) => (next.kind === "act" ? next.control.label : next.kind === "blocked" ? `blocked: ${next.reason}` : next.kind);
/** Runs decide and records `result` for the action, as runTask does. */
async function step(state: RunState, snap: Snapshot, result: ActResult = ok): Promise<Next> {
  const next = await decide(state, snap, chooser);
  if (next.kind === "act") record(state, next, result, snap);
  return next;
}

describe("controller", () => {
  it("serves requirements in goal order, one control each (C3)", async () => {
    const email = c("Email");
    const work = c("Work email");
    const state = await start("email: a@b.co, work email: c@d.co", chooser, TODAY);
    expect(target(await step(state, page([email, work])))).toBe("Email");
    expect(target(await step(state, page([email, work])))).toBe("Work email");
  });

  it("lets an earlier requirement keep a control a later one wants (C3)", async () => {
    const email = c("Email");
    const state = await start("contact email: a@b.co, email: c@d.co, do not submit", chooser, TODAY);
    const first = await step(state, page([email]));
    expect(first.kind === "act" && first.requirement?.key).toBe("contact email");
    expect((await step(state, page([email]))).kind).toBe("done");
    expect(state.unmatched.map((r) => r.key)).toEqual(["email"]);
  });

  it("keeps dates and other values out of each other's fields (C4)", async () => {
    const fromDate = c("From date", { type: "date", dateFormat: "YYYY-MM-DD" });
    const from = c("From");
    const state = await start("from: Boston, depart December 3, 2026", chooser, TODAY);
    const first = await step(state, page([fromDate, from]));
    expect(target(first)).toBe("From");
    const second = await step(state, page([fromDate, from]));
    expect(second.kind === "act" && [second.control.label, second.request]).toEqual(["From date", { op: "date", value: "2026-12-03" }]);
  });

  it("picks the autocomplete option that names the value, typos forgiven (C5)", async () => {
    const from = c("From", { role: "combobox", autocomplete: true });
    const state = await start("from San Fransisco", chooser, TODAY);
    expect(target(await step(state, page([from])))).toBe("From");
    const options = [c("San Diego, CA", { role: "option", popupFor: from.id, dialog: true }), c("San Francisco, CA", { role: "option", popupFor: from.id, dialog: true })];
    expect(target(await step(state, page([{ ...from, value: "San Fransisco" }, ...options])))).toBe("San Francisco, CA");
  });

  it("does not click an option that does not name the value (C6)", async () => {
    const from = c("From", { role: "combobox", autocomplete: true });
    const name = c("Name");
    const state = await start("from Paris, name: Sam", chooser, TODAY);
    await step(state, page([from, name]));
    const option = c("Boston, MA", { role: "option", popupFor: from.id, dialog: true });
    expect(target(await step(state, page([{ ...from, value: "Paris" }, option, name])))).toBe("Name");
  });

  it("opens a date picker and pages to the month (C7)", async () => {
    const depart = c("Depart", { readOnly: true, picker: true });
    const state = await start("depart December 3, 2026", chooser, TODAY);
    expect(target(await step(state, page([depart])))).toBe("Depart");
    const next = c("Next month", { role: "button", dialog: true, form: undefined });
    const october = c("Thursday, October 1, 2026", { role: "gridcell", dialog: true, form: undefined });
    expect(target(await step(state, page([depart, next, october])))).toBe("Next month");
    const day = c("Thursday, December 3, 2026", { role: "gridcell", dialog: true, form: undefined });
    expect(target(await step(state, page([depart, next, day])))).toBe("Thursday, December 3, 2026");
  });

  it("stops after 24 pages of a picker that never shows the day (C7)", async () => {
    const depart = c("Depart", { readOnly: true, picker: true });
    const next = c("Next month", { role: "button", dialog: true, form: undefined });
    const state = await start("depart December 3, 2026, do not submit", chooser, TODAY);
    await step(state, page([depart]));
    let last: Next = { kind: "done" };
    for (let i = 0; i < 30 && last.kind !== "blocked"; i++) last = await step(state, page([depart, next]));
    expect(target(last)).toMatch(/^blocked: .*2026-12-03/);
    expect(state.history.filter((h) => h.action === "Next month")).toHaveLength(24);
  });

  it("types a date in the field's own format (C8)", async () => {
    const date = c("Date of birth", { dateFormat: "DD/MM/YYYY" });
    const state = await start("date of birth 3 décembre 1990", chooser, TODAY);
    const next = await step(state, page([date]));
    expect(next.kind === "act" && next.request).toEqual({ op: "type", value: "03/12/1990" });
  });

  it("stops when the submit button is disabled (C9)", async () => {
    const email = c("Email", { type: "email" });
    const send = c("Create account", { role: "button", submit: true, disabled: true });
    const state = await start("email: a@b.co", chooser, TODAY);
    await step(state, page([email, send]));
    expect(target(await step(state, page([{ ...email, value: "a@b.co" }, send])))).toBe("blocked: the submit button is disabled");
  });

  it("sends a filled form, then ends done", async () => {
    const email = c("Email", { type: "email" });
    const send = c("Create account", { role: "button", submit: true });
    const state = await start("email: a@b.co", chooser, TODAY);
    await step(state, page([email, send]));
    expect(target(await step(state, page([email, send]), { ok: true, submitted: true }))).toBe("Create account");
    expect((await step(state, page([], { url: "http://fixture/thanks" }))).kind).toBe("done");
    expect(state.sent).toBe(true);
  });

  it("never sends when the goal says not to (C10)", async () => {
    const email = c("Email", { type: "email" });
    const send = c("Create account", { role: "button", submit: true });
    const state = await start("email: a@b.co, but do not submit", chooser, TODAY);
    await step(state, page([email, send]));
    expect((await step(state, page([email, send]))).kind).toBe("done");
  });

  it("ends blocked after 3 stale refusals in a row, or at the step cap (C11)", async () => {
    const email = c("Email");
    const state = await start("email: a@b.co", chooser, TODAY);
    for (let i = 0; i < 3; i++) await step(state, page([email]), { ok: false, reason: "stale" });
    expect(target(await decide(state, page([email]), chooser))).toBe("blocked: the page keeps changing");
    const capped = await start("email: a@b.co", chooser, TODAY, { maxSteps: 0 });
    expect(target(await decide(capped, page([email]), chooser))).toBe("blocked: step limit reached");
  });

  it("stops on a captcha before any action (C12)", async () => {
    const state = await start("email: a@b.co", chooser, TODAY);
    expect(target(await decide(state, page([c("Email")], { captcha: true }), chooser))).toBe("blocked: captcha");
  });

  it("never picks a delete, buy or pay control the goal does not name (C13)", async () => {
    const remove = c("Delete account", { role: "button", form: undefined });
    const details = c("Account details", { role: "button", form: undefined });
    const state = await start("open account", chooser, TODAY);
    expect(target(await step(state, page([remove, details])))).toBe("Account details");
    const named = await start("delete account", chooser, TODAY);
    expect(target(await step(named, page([remove, details])))).toBe("Delete account");
  });

  it("does not press an order or payment button for an unrelated goal (C14)", async () => {
    for (const label of ["Place your order", "Confirm payment", "Check out"]) {
      const email = c("Email", { type: "email" });
      const risky = c(label, { role: "button", submit: true });
      const state = await start("email: a@b.co", chooser, TODAY);
      await step(state, page([email, risky]));
      expect(target(await step(state, page([{ ...email, value: "a@b.co" }, risky])))).toBe(`blocked: sending presses "${label}", which the goal does not ask for`);
      expect(state.history.map((h) => h.action)).toEqual(["Email"]);
    }
  });

  it("stops before a risky submit button the goal does not name (C16)", async () => {
    const email = c("Email", { type: "email" });
    const pay = c("Pay now", { role: "button", submit: true });
    const state = await start("email: me@paypal.com", chooser, TODAY);
    await step(state, page([email, pay]));
    expect(target(await step(state, page([email, pay])))).toBe('blocked: sending presses "Pay now", which the goal does not ask for');
  });
});
