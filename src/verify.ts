// The result checklist. "Done" from the controller only means nothing was
// left to do. verify() checks the page: each value is in a field, each
// setting is on, the form the run filled was sent, and the page is not an
// error, empty or captcha page. Page text such as a success banner never
// counts as proof that the form was sent.
import { words } from "./choosers/rule.js";
import type { RunState } from "./controller.js";
import { firstDate, readDate } from "./dates.js";
import { nearlyNames } from "./match.js";
import type { Control, Snapshot } from "./types.js";

export interface Check {
  part: string;
  ok: boolean;
  evidence: string;
}

export interface Verdict {
  verified: boolean;
  checks: Check[];
  /** "error page", "empty page" or "captcha". */
  problem?: string;
}

const ERROR = /\b(?:error|40[0-9]|50[0-9]|not found|something went wrong|access denied|forbidden|unavailable|try again later)\b/i;

/** Where a control shows its state: its value, its selected options, its label. */
function shown(c: Control): string[] {
  return [c.value, ...(c.options?.filter((o) => o.selected).map((o) => o.label) ?? []), c.label].filter(Boolean);
}

/** What is wrong with the page itself, if anything. */
export function problemOf(page: Snapshot): string | undefined {
  if (page.captcha) return "captcha";
  if (!page.text.trim() && !page.controls.length) return "empty page";
  if (ERROR.test(page.title) || ERROR.test(page.headings[0] ?? "") || (page.text.length < 120 && ERROR.test(page.text) && !page.controls.length)) {
    return "error page";
  }
  return undefined;
}

/**
 * Checks `page`, the page at the end of the run. When the run sent a form,
 * pass `sentFrom`, the snapshot taken right before the send: the values are
 * checked there, because the next page may not show the form at all.
 */
export function verify(page: Snapshot, state: RunState, sentFrom?: Snapshot): Verdict {
  const evidence = state.sent && sentFrom ? sentFrom : page;
  const checks: Check[] = [];
  for (const [index, r] of state.requirements.entries()) {
    const unmatched = state.status[index] === "unmatched";
    if (r.kind === "setting") {
      if (unmatched) continue;
      const want = words(r.key);
      const on = evidence.controls.find((c) => c.checked === true && want.every((w) => words(c.label).includes(w))) ??
        evidence.controls.find((c) => c.options?.some((o) => o.selected && words(o.label).length > 0 && words(o.label).every((w) => want.includes(w))) &&
          words(c.label).some((w) => want.includes(w)));
      const clicked = state.history.find((h) => h.ok && h.requirement === r.text && h.operation === "CLICK");
      // A clicked control that reports a state must be on after the run.
      const after = clicked && evidence.controls.find((c) => c.id === clicked.controlId);
      checks.push(on ? { part: r.text, ok: true, evidence: shown(on).slice(1).join(" ") || on.label }
        : after && after.checked === false ? { part: r.text, ok: false, evidence: `"${after.label}" is off after the click` }
        : clicked ? { part: r.text, ok: true, evidence: `clicked "${clicked.action}"` }
          : { part: r.text, ok: false, evidence: `nothing on the page shows "${r.key}" is on` });
      continue;
    }
    if (r.kind === "date") {
      const field = evidence.controls.find((c) => readDate(c.value, c.dateFormat, state.today) === r.date || firstDate(c.label, state.today) === r.date && c.checked);
      checks.push(field ? { part: r.text, ok: true, evidence: `${field.label}: ${field.value}` } : { part: r.text, ok: false, evidence: `no field shows ${r.date}` });
      continue;
    }
    const field = evidence.controls.find((c) => shown(c).slice(0, -1).some((t) => nearlyNames(t, r.value!))) ??
      evidence.controls.find((c) => c.checked === true && nearlyNames(c.label, r.value!));
    checks.push(field ? { part: r.text, ok: true, evidence: `${field.label}: ${shown(field)[0]}` }
      : { part: r.text, ok: false, evidence: unmatched ? "no field on the page fits it" : `no field shows "${r.value}"` });
  }
  if (state.filled.size || state.tried.size) {
    const unsent = state.tried.size ? "the run tried to send the form, but no submit event fired and the page did not change"
      : "the form the run filled was never sent";
    checks.push(state.submit
      ? { part: "Form sent", ok: state.sent, evidence: state.sent ? "the run sent the form it filled" : unsent }
      : { part: "Form not sent, as asked", ok: !state.sent, evidence: state.sent ? "the run sent the form" : "the form was left unsent" });
  }
  const problem = problemOf(page);
  return { verified: !problem && checks.length > 0 && checks.every((c) => c.ok), checks, ...(problem ? { problem } : {}) };
}
