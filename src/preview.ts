// What a form fill would do, before it runs: the form, its fields and where
// it sends (docs/failure-modes.md C33). The controller rules run on one
// snapshot and act on nothing, so a human can approve the destination and
// a caller can pin it with an allowHosts URL entry (C32).
import type { Chooser } from "./choosers/chooser.js";
import { ruleChooser } from "./choosers/rule.js";
import { decide, record, sensitive, start } from "./controller.js";
import type { Snapshot } from "./types.js";

export interface PreviewOptions {
  /** Default: ruleChooser(). Use the chooser the run will use. */
  chooser?: Chooser;
  /** "Today" for relative dates. Default: now. */
  today?: Date;
  allowHosts?: string[];
}

/** One field that gets a value. A sensitive value is masked. */
export interface PlannedField {
  label: string;
  value: string;
}

export interface FormPlan {
  /** The goal sends a form. */
  sends: boolean;
  /** The send's action URL. Null when the goal does not send, the run would stop, or the fields sit outside a form. */
  destination: string | null;
  /** The label of the button that sends, when one does. */
  button?: string;
  fields: PlannedField[];
  /** Why the run would stop on this page. */
  blocked?: string;
}

/** "•••• 4242" for a card number, "•••" for any other sensitive value. */
const mask = (value: string) => {
  const digits = value.replace(/[ -]/g, "");
  return /^\d{13,19}$/.test(digits) ? `•••• ${digits.slice(-4)}` : "•••";
};

/** The form fill that `runTask` would start on `page`, without acting (C33). */
export async function preview(page: Snapshot, goal: string, options: PreviewOptions = {}): Promise<FormPlan> {
  const chooser = options.chooser ?? ruleChooser();
  const state = await start(goal, chooser, options.today, { allowHosts: options.allowHosts ?? [] });
  const fields: PlannedField[] = [];
  const plan = (more: Partial<FormPlan> = {}): FormPlan => ({ sends: state.submit, destination: null, fields, ...more });
  for (let i = 0; i < state.maxSteps; i++) {
    const next = await decide(state, page, chooser);
    if (next.kind === "done") return plan();
    if (next.kind === "blocked") return plan({ blocked: next.reason });
    const { control, request, requirement } = next;
    if (next.effect === "send") {
      // Enter sends to the field's action, a button to its own (C26). Outside a form there is none (C29).
      return plan({ destination: control.action ?? null, ...(control.role === "button" || control.submit ? { button: control.label } : {}) });
    }
    if (requirement && next.effect !== "option" && next.effect !== "day" && next.effect !== "page-picker") {
      const shown = request.op === "select" ? control.options?.find((o) => o.value === request.value)?.label ?? request.value
        : request.op === "check" || (request.op === "click" && next.effect === "done") ? "checked" : request.value ?? requirement.date ?? "";
      fields.push({ label: control.label, value: control.secret || sensitive(requirement) ? mask(requirement.value ?? shown ?? "") : shown ?? "" });
    }
    record(state, next, { ok: true }, page);
    // A picker would open on the page; the plan takes the date as set.
    if (next.effect === "open-picker" && state.awaiting) {
      state.status[state.awaiting.index] = "done";
      state.awaiting = null;
    }
  }
  return plan({ blocked: "step limit reached" });
}
