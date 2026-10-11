// The deterministic rules between a Chooser and the page. The Chooser only
// says which observed control serves a requirement. These rules decide the
// order, keep the matching one-to-one, handle autocomplete lists and date
// pickers, send the form, and decide when the run ends.
// The rules follow foxpilot's controller (MIT), in a smaller form.
import type { Chooser } from "./choosers/chooser.js";
import { words } from "./choosers/rule.js";
import { firstDate, formatDate, readDate } from "./dates.js";
import { parseGoal, type Requirement } from "./goal.js";
import { nearlyNames } from "./match.js";
import { allowedBy, risky } from "./safety.js";
import { refuseDestination } from "./site.js";
import type { ActRequest, ActResult, Control, Snapshot } from "./types.js";

/** Scores below this are not acted on. */
export const FLOOR = 0.4;
/** Pages of a date picker to turn before giving up. */
export const PICKER_TURNS = 24;
/** Stale or navigated refusals in a row before the run gives up. */
export const STALE_LIMIT = 3;

const SEND = /^(submit|send|search|go|continue|next|sign up|register|book|save|apply|subscribe|create account|done)\b/i;
const TYPABLE = new Set(["textbox", "searchbox", "spinbutton"]);
/** A send button that leads to a further step (C28). */
const STEP = /^(?:continue|next|proceed)\b/i;
const SENSITIVE = /\b(?:card|cc|cvc2?|cvv2?|csc|security\s+code|expir\w*|iban|account\s+number|routing|sort\s+code|password|passcode|pin|ssn|social\s+security|tax\s+id)\b/i;

type Effect = "done" | "list" | "option" | "open-picker" | "page-picker" | "day" | "send";

export interface StepRecord {
  step: number;
  operation: string;
  /** The control's label. */
  action: string;
  controlId: string;
  requirement: string | null;
  text: string | null;
  ok: boolean;
  reason?: string;
  submitted?: boolean;
}

export type Next =
  | { kind: "act"; control: Control; request: ActRequest; operation: string; requirement: Requirement | null; index: number | null; effect: Effect; form?: string }
  | { kind: "done" }
  | { kind: "blocked"; reason: string };

export interface RunState {
  goal: string;
  requirements: Requirement[];
  submit: boolean;
  today: Date;
  maxSteps: number;
  status: ("pending" | "done" | "unmatched")[];
  unmatched: Requirement[];
  taken: Map<string, number>;
  refused: Set<string>;
  awaiting: { kind: "list" | "picker"; index: number; controlId: string } | null;
  pickerTurns: number;
  filled: Set<string>;
  tried: Set<string>;
  sentForms: Set<string>;
  /** A send that fired no submit event; confirmSend decides from the page after it. */
  pendingSend: string | null;
  sent: boolean;
  stale: number;
  history: StepRecord[];
  refusals: { step: number; action: string; reason: string; detail?: string }[];
  /** The one form this run fills (C19), or null before it is chosen or on a page with one form. */
  form: string | null;
  /** More sites a form may send to (C22), as runTask's `allowHosts`. */
  allowHosts: string[];
  /** Requirements that wait for the step after this send (C28). */
  later: number[];
}

/** Parses the goal and asks the Chooser for values the rules did not find ("as Sam Lee"). */
export async function start(goal: string, chooser: Chooser, today = new Date(), options: { maxSteps?: number; allowHosts?: string[] } = {}): Promise<RunState> {
  const parsed = parseGoal(goal, today);
  const spans = Object.values(await chooser.extract(goal, ["person", "location", "organization", "email", "phone", "number"])).flat();
  const requirements = parsed.requirements.map((r) => {
    if (r.kind !== "setting") return r;
    const span = spans.find((s) => s.length > 1 && r.text.toLowerCase().includes(s.toLowerCase()));
    if (!span) return r;
    const key = r.key.replace(new RegExp(span.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").replace(/\s+(?:as|with|is|to)\s*$/i, "").trim();
    return { ...r, key: key || r.key, value: span, kind: "value" as const };
  });
  return {
    goal, requirements, submit: parsed.submit, today, maxSteps: options.maxSteps ?? 40,
    status: requirements.map(() => "pending"), unmatched: [], taken: new Map(), refused: new Set(), awaiting: null,
    pickerTurns: 0, filled: new Set(), tried: new Set(), sentForms: new Set(), pendingSend: null, sent: false, stale: 0, history: [], refusals: [],
    form: null, allowHosts: options.allowHosts ?? [], later: [],
  };
}

const docOf = (page: Snapshot, frameId: number) => {
  const frame = page.frames.find((f) => f.frameId === frameId);
  return frame?.documentId ?? frame?.key.slice(0, 24) ?? "";
};
const keyOf = (page: Snapshot, c: Control) => `${docOf(page, c.frameId)}#${c.id}`;
const formOf = (page: Snapshot, c: Control) => (c.form === undefined ? keyOf(page, c) : `${docOf(page, c.frameId)}#${c.frameId}:form${c.form}`);
const typable = (c: Control) => TYPABLE.has(c.role) || (c.role === "combobox" && c.tag === "input");
const dated = (c: Control) => typable(c) && (c.picker || !!c.dateFormat || c.type === "date");
const unsafe = (c: Control, goal: string) => !allowedBy(c.label, goal);
/** A requirement that names a button to press: `click "Pay $40.00"` (C21). */
const presses = (r: Requirement) => !!r.value && /^(?:then\s+)?(?:click|press|tap|hit)$/i.test(r.key.trim());
/** A card number, CVC, IBAN, password and the like (C24). */
const sensitive = (r: Requirement) => SENSITIVE.test(r.key) || /^(?:\d[ -]?){13,19}$/.test(r.value ?? "");
const blocked = (reason: string): Next => ({ kind: "blocked", reason });
const originOf = (url = "") => (URL.canParse(url) ? new URL(url).origin : "null");
/** In the top frame, or in a frame of the top page's origin (C27). */
const local = (page: Snapshot, c: Control) => c.frameId === 0 || originOf(page.frames.find((f) => f.frameId === c.frameId)?.url) === originOf(page.url);

/**
 * The form whose labels fit the most requirements (C19), among forms whose
 * destination may get what they fit (C24). Blocked when a refused form fits
 * more, or when two forms fit about the same (C23): never page order.
 */
function chooseForm(state: RunState, page: Snapshot, usable: Control[]): string | null | { blocked: string } {
  const forms = new Map<string, { seen: Set<string>; to?: string }>();
  for (const c of usable) {
    if (c.form === undefined || c.submit) continue;
    const form = forms.get(formOf(page, c)) ?? { seen: new Set<string>(), to: c.action };
    for (const w of words(`${c.label} ${c.name.replace(/[_-]/g, " ")} ${c.placeholder}`)) form.seen.add(w);
    forms.set(formOf(page, c), form);
  }
  const scored = [...forms].map(([key, { seen, to }]) => {
    const fit = state.requirements.filter((r) => !presses(r) && words(r.key || r.text).some((w) => seen.has(w)));
    return { key, fits: fit.length, refused: refuseDestination(page.url, to, state.allowHosts, fit.some(sensitive)) };
  }).filter((f) => f.fits > 0).toSorted((a, b) => b.fits - a.fits || Number(!!a.refused) - Number(!!b.refused));
  if (scored[0]?.refused) return { blocked: scored[0].refused };
  const [best, next] = scored.filter((f) => !f.refused);
  if (best && next && next.fits * 4 >= best.fits * 3) {
    return { blocked: `two forms fit the goal about the same (${best.fits} and ${next.fits} of its parts), so foxpaw did not guess` };
  }
  return best?.key ?? null;
}

export async function decide(state: RunState, page: Snapshot, chooser: Chooser): Promise<Next> {
  if (state.history.length >= state.maxSteps) return { kind: "blocked", reason: "step limit reached" };
  if (state.stale >= STALE_LIMIT) return { kind: "blocked", reason: "the page keeps changing" };
  if (page.captcha) return { kind: "blocked", reason: "captcha" };
  const usable = page.controls.filter((c) => !c.disabled && !state.refused.has(keyOf(page, c)));
  const act = (control: Control, request: ActRequest, operation: string, index: number | null, effect: Effect): Next =>
    ({ kind: "act", control, request, operation, requirement: index === null ? null : state.requirements[index]!, index, effect, form: formOf(page, control) });

  const waiting = state.awaiting;
  if (waiting) {
    const r = state.requirements[waiting.index]!;
    if (waiting.kind === "list") {
      const pick = usable.find((c) => c.popupFor === waiting.controlId && r.value && nearlyNames(c.label, r.value));
      if (pick) return act(pick, { op: "click" }, "CLICK", waiting.index, "option");
      // No option names the value: keep the typed text.
      state.status[waiting.index] = "done";
      state.awaiting = null;
    } else {
      const field = page.controls.find((c) => c.id === waiting.controlId);
      const inside = usable.filter((c) => c.dialog);
      const day = inside.find((c) => firstDate(c.label, state.today) === r.date);
      if (field && readDate(field.value, field.dateFormat, state.today) === r.date) {
        state.status[waiting.index] = "done";
        state.awaiting = null;
      } else if (day) {
        return act(day, { op: "click" }, "CLICK", waiting.index, "day");
      } else {
        if (state.pickerTurns >= PICKER_TURNS) return { kind: "blocked", reason: `the date picker never showed ${r.date}` };
        const shown = inside.map((c) => firstDate(c.label, state.today)).filter((d): d is string => !!d).toSorted();
        const back = shown.length > 0 && shown[0]! > r.date!;
        const pager = inside.find((c) => (back ? /\b(?:prev|previous|back|earlier)\b|[‹«←]/i : /\b(?:next|forward|later)\b|[›»→]/i).test(c.label));
        if (pager) return act(pager, { op: "click" }, "CLICK", waiting.index, "page-picker");
        if (field && !field.readOnly) return act(field, { op: "type", value: formatDate(r.date!, field.dateFormat) }, "TYPE_TEXT", waiting.index, "done");
        return { kind: "blocked", reason: `the date picker has no day ${r.date}` };
      }
    }
  }

  // One goal fills one form (C19). Choose it again when it is gone, as after a new page.
  if (!state.form || !usable.some((c) => formOf(page, c) === state.form)) {
    const chosen = chooseForm(state, page, usable.filter((c) => local(page, c)));
    if (chosen && typeof chosen === "object") return { kind: "blocked", reason: chosen.blocked };
    state.form = chosen;
  }

  for (const [index, r] of state.requirements.entries()) {
    if (state.status[index] !== "pending") continue;
    const next = await serve(state, page, usable, chooser, index, r, act);
    if (next) return next;
  }

  if (!state.submit) return { kind: "done" };
  const open = state.requirements.flatMap((r, i) => (state.status[i] === "unmatched" && r.kind !== "setting" ? [i] : []));
  const wanted = open.map((i) => state.requirements[i]!).filter(presses).map((r) => r.value!);
  const missing = open.map((i) => state.requirements[i]!).filter((r) => !presses(r));
  for (const form of state.filled) {
    if (state.sentForms.has(form)) continue;
    const inForm = page.controls.filter((c) => formOf(page, c) === form || keyOf(page, c) === form);
    if (!inForm.length) continue;
    if (state.tried.has(form)) return blocked(state.refusals.at(-1)?.reason === "destination" ? "the form's destination changed as foxpaw sent it" : "the form did not send");
    const shifted = inForm.find((c) => c.firstAction !== undefined);
    if (shifted) return blocked(`the form's destination changed from ${shifted.firstAction} to ${shifted.action}`);
    const carries = inForm.some((c) => c.secret || (state.taken.has(keyOf(page, c)) && sensitive(state.requirements[state.taken.get(keyOf(page, c))!]!)));
    const names = (c: Control) => wanted.some((w) => nearlyNames(c.label, w));
    // Fields outside a form send to an unknown place: only the button the goal names sends them (C29).
    const loose = inForm[0]!.form === undefined;
    const button = loose ? usable.find((c) => c.form === undefined && c.role === "button" && names(c))
      : inForm.find((c) => c.submit && names(c)) ?? inForm.find((c) => c.submit) ?? inForm.find((c) => c.role === "button" && SEND.test(c.label));
    if (loose && carries && !button) return blocked("fields outside a form send to an unknown place, so foxpaw sends a sensitive value only with the button the goal names");
    if (button?.disabled) return blocked("the submit button is disabled");
    if (button && unsafe(button, state.goal) && !names(button)) return blocked(`sending presses "${button.label}", which the goal does not ask for`);
    const final = !!button && names(button);
    // A value with no field waits for the next step only when nothing sensitive goes now (C28).
    const later = !carries && !final && !!button && STEP.test(button.label) && !risky(button.label);
    // A half-filled form is a guess, and its data goes wherever it posts (C20).
    if (missing.length && !later) return blocked(`${missing.map((r) => `"${r.text}"`).join(", ")} fit no field in the form, so foxpaw did not send it`);
    // The goal named the button to press: no other button sends (C21).
    if (wanted.length && !final && !later) return blocked(`sending presses "${button?.label ?? "Enter"}", but the goal names "${wanted[0]}"`);
    const field = button ? undefined : inForm.findLast((c) => typable(c) && state.taken.has(keyOf(page, c)));
    // Where the data goes (C22, C24, C26): a field's action is where Enter sends.
    const refused = refuseDestination(page.url, (button ?? field)?.action, state.allowHosts, carries);
    if (refused) return blocked(refused);
    if (final) for (const [i, r] of state.requirements.entries()) if (state.status[i] === "unmatched" && presses(r)) state.status[i] = "done";
    if (final) state.unmatched = state.unmatched.filter((r) => !presses(r));
    state.later = later ? open : [];
    if (button) return act(button, { op: "click" }, "CLICK", null, "send");
    if (field) return act(field, { op: "enter" }, "PRESS_ENTER", null, "send");
  }
  return { kind: "done" };
}

/** The action for one pending requirement, or null after marking it done or unmatched. */
async function serve(
  state: RunState, page: Snapshot, usable: Control[], chooser: Chooser, index: number, r: Requirement,
  act: (control: Control, request: ActRequest, operation: string, index: number | null, effect: Effect) => Next,
): Promise<Next | null> {
  const free = usable.filter((c) => !state.taken.has(keyOf(page, c)) && !c.popupFor && !c.submit && !unsafe(c, state.goal) &&
    (c.form === undefined || !state.form || formOf(page, c) === state.form) && (r.kind === "setting" || local(page, c)) &&
    (!c.secret || /password|passcode|\bpin\b/i.test(r.key)));
  const named = (c: Control) => !!r.value && (c.tag === "select" ? !!c.options?.some((o) => nearlyNames(o.label, r.value!)) :
    ["option", "radio", "tab"].includes(c.role) && nearlyNames(c.label, r.value));
  let candidates: Control[];
  if (r.kind === "date") candidates = free.filter(dated).length ? free.filter(dated) : free.filter(typable);
  else if (r.kind === "value") candidates = free.filter((c) => (typable(c) && !dated(c)) || named(c));
  // In a goal with a sensitive value, a setting never presses a button: only the send rules do (C29).
  else candidates = free.filter((c) => !typable(c) && !(c.role === "button" && state.requirements.some(sensitive)));
  // One date field and one date: no model needed.
  const choice = r.kind === "date" && candidates.length === 1 ? { controlId: candidates[0]!.id, score: 1 } : await chooser.choose(r, candidates);
  const control = choice && choice.score >= FLOOR ? candidates.find((c) => c.id === choice.controlId) : undefined;
  const settle = (status: "done" | "unmatched") => {
    state.status[index] = status;
    if (status === "unmatched") state.unmatched.push(r);
    else if (control) state.taken.set(keyOf(page, control), index);
    return null;
  };
  if (!control) return settle("unmatched");
  if (r.kind === "date") {
    if (control.type === "date") return act(control, { op: "date", value: r.date! }, "SET_DATE", index, "done");
    if (control.picker && control.readOnly) return act(control, { op: "click" }, "CLICK", index, "open-picker");
    return act(control, { op: "type", value: formatDate(r.date!, control.dateFormat) }, "TYPE_TEXT", index, "done");
  }
  if (control.tag === "select") {
    const want = words(r.key);
    const option = control.options?.find((o) => (r.value ? nearlyNames(o.label, r.value) : words(o.label).length > 0 && words(o.label).every((w) => want.includes(w))));
    if (!option) return settle("unmatched");
    if (option.selected) return settle("done");
    return act(control, { op: "select", value: option.value }, "SELECT", index, "done");
  }
  if (typable(control)) {
    if (control.value === r.value) return settle("done");
    return act(control, { op: "type", value: r.value ?? "" }, "TYPE_TEXT", index, control.autocomplete ? "list" : "done");
  }
  if (["checkbox", "radio", "switch"].includes(control.role)) {
    if (control.checked) return settle("done");
    return act(control, { op: "check" }, "CHECK", index, "done");
  }
  return act(control, { op: "click" }, "CLICK", index, "done");
}

/** Updates the run after `act` returned `result` for `next`. */
export function record(state: RunState, next: Extract<Next, { kind: "act" }>, result: ActResult, page: Snapshot): void {
  const { control, request, index, effect } = next;
  const step = state.history.length + 1;
  state.history.push({
    step, operation: next.operation, action: control.label, controlId: control.id, requirement: next.requirement?.text ?? null,
    text: request.value === undefined ? null : control.secret ? "•••" : request.value, ok: result.ok,
    ...(result.reason ? { reason: result.reason } : {}), ...(result.submitted ? { submitted: true } : {}),
  });
  if (!result.ok) {
    state.refusals.push({ step, action: control.label, reason: result.reason ?? "refused", ...(result.detail ? { detail: result.detail } : {}) });
    if (result.reason === "stale" || result.reason === "navigated") state.stale += 1;
    else {
      state.stale = 0;
      state.refused.add(keyOf(page, control));
      if (effect === "send") state.tried.add(next.form!);
    }
    return;
  }
  state.stale = 0;
  if (effect === "send") {
    state.tried.add(next.form!);
    // Values that wait for this step are served again on the next one (C28).
    for (const i of state.later) state.status[i] = "pending";
    state.unmatched = state.unmatched.filter((r) => !state.later.some((i) => state.requirements[i] === r));
    state.later = [];
    if (result.submitted) {
      state.sentForms.add(next.form!);
      state.sent = true;
    } else state.pendingSend = next.form!;
    return;
  }
  if (effect === "page-picker") {
    state.pickerTurns += 1;
    return;
  }
  if (effect === "option" || effect === "day") {
    state.status[state.awaiting!.index] = "done";
    state.awaiting = null;
    return;
  }
  state.taken.set(keyOf(page, control), index!);
  if (["type", "select", "check", "date"].includes(request.op) || effect === "open-picker") state.filled.add(next.form!);
  if (effect === "list") state.awaiting = { kind: "list", index: index!, controlId: control.id };
  else if (effect === "open-picker") {
    state.awaiting = { kind: "picker", index: index!, controlId: control.id };
    state.pickerTurns = 0;
  } else state.status[index!] = "done";
}

const topFrame = (page: Snapshot) => page.frames.find((f) => f.frameId === 0);

/**
 * After a send with no submit event: it counts as sent only when the top
 * frame's address or document changed between `before` and `after`.
 */
export function confirmSend(state: RunState, before: Snapshot, after: Snapshot): void {
  const form = state.pendingSend;
  state.pendingSend = null;
  if (!form) return;
  const [was, now] = [topFrame(before), topFrame(after)];
  if (before.url !== after.url || was?.documentId !== now?.documentId || was?.key.slice(0, 24) !== now?.key.slice(0, 24)) {
    state.sentForms.add(form);
    state.sent = true;
  }
}
