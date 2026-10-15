// The page as text for a planner model, and what an action changed. Each
// token costs a local planner time, so the text leaves out what a planner
// does not need. Every string here comes from the page: a caller passes all
// of it as untrusted data, inside its data fence. This file reads no page;
// it formats Snapshots (docs/failure-modes.md T1-T7, D1-D5).
import type { Control, Snapshot } from "./types.js";

/**
 * `maxControls`: the most controls; a folded link counts as a quarter. Default: 40.
 * `focus`: a text, such as the goal. Instead of the first `maxControls`, the page keeps its
 * submit buttons and fields, the 20 controls that share the most words with the focus, and
 * the 10 text lines that do. Default: off (T15).
 */
export interface PageTextOptions { maxControls?: number; focus?: string }
/** `target`: the id of the control the action used. Its line is always in the diff. */
export interface ChangeOptions extends PageTextOptions { target?: string }

/** What `changeText` returns. `full` is true when `text` is the whole page, not a diff. */
export interface Change { full: boolean; text: string }

// A run of FOLD_RUN short links folds. SHORT is the most characters of a short
// label or text line. A diff holds at most DIFF_TEXT characters of new text (D1).
const MAX_CONTROLS = 40, FOLD_RUN = 5, SHORT = 40, DIFF_TEXT = 1200, FOCUS_CONTROLS = 20, FOCUS_TEXT = 10;
const FIELDS = new Set(["textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "spinbutton"]);
/** Text that reads as an error or an alert is never deduped or dropped (T6). */
const ALERT = /\b(?:error|errors|invalid|required|must|incorrect|wrong|failed|denied|declined|not valid|please|warning|alert)\b/i;
/** The wrapper that a scanner such as foxshield puts around flagged page text (T7). */
const OPEN = /^\s*<untrusted-data[\s>]/, CLOSE = /^\s*<\/untrusted-data>\s*$/;

type Item = { control: Control } | { fold: Control[] };

/** Page text as one JSON-quoted line, with wrapper markers escaped (T8). */
// foxshield's INVISIBLE set (sanitize.ts), mirrored: foxpaw does not depend on foxshield.
const INVISIBLE = /[\u200b-\u200d\u2060\u180e\ufeff\u202a-\u202e\u2066-\u2069\u{E0000}-\u{E007F}]/gu;
const escape = (text: string) => text.replace(INVISIBLE, "").replace(/<(\s*\/?\s*untrusted-data)/gi, "&lt;$1");
const quote = (text: string) => JSON.stringify(escape(text).replace(/[\s\u0085]+/g, " ").trim());
/** A text unit as the planner sees it: each page line starts with "| "; only a wrapper's own marker lines do not. */
const show = (unit: string) => unit.split("\n").map((l, i, all) => (wrapped(unit) && (i === 0 || (i === all.length - 1 && CLOSE.test(l))) ? l : `| ${escape(l)}`)).join("\n");

/** A secret control's value as the planner sees it: "•••" when it holds one, else nothing (T10). */
const MASK = "•••";

/** One control as one line, for example `[0:6] textbox "Email" value="sam@example.com" (required)`. */
function line(c: Control): string {
  // A closed folder reads collapsed; an ARIA control that is closed reads as before, so menus cost no tokens (T14).
  const open = c.expanded ? "expanded" : c.list && c.expanded === false && "collapsed";
  const flags = [c.required && "required", c.disabled && "disabled", c.checked && "checked", open,
    c.submit && "sends the form"].filter(Boolean);
  const options = c.options?.length ? ` options=[${c.options.map((o) => quote(o.value)).join(",")}]` : "";
  // A checkbox or a radio is checked by its id; its form value is noise (T11).
  const value = c.secret ? (c.value ? ` value="${MASK}"` : "") : c.value && c.value !== c.label && c.role !== "checkbox" && c.role !== "radio" ? ` value=${quote(c.value)}` : "";
  const near = c.near ? ` near ${quote(c.near)}` : "";
  return `[${c.id}] ${c.role} ${quote(c.label)}${near}${value}${options}${flags.length ? ` (${flags.join(", ")})` : ""}`;
}

const foldLine = (run: Control[]) => `(${run.length} links: ${run.map((c) => `${quote(c.label)}=${c.id}`).join(", ")})`;

/**
 * The page text split into units: one trimmed line, or one whole wrapped
 * block from its opening line to its closing line. A block that never closes
 * runs to the end. A unit with a line break is a wrapped block.
 */
function units(text: string): string[] {
  const out: string[] = [];
  let block: string[] | undefined;
  for (const raw of text.split(/\r\n|[\r\n\u2028\u2029\u0085]/)) {
    if (block) {
      block.push(raw);
      if (CLOSE.test(raw)) { out.push(block.join("\n")); block = undefined; }
    } else if (OPEN.test(raw)) block = [raw];
    else if (raw.trim()) out.push(raw.trim());
  }
  if (block) out.push(block.join("\n"));
  return out;
}
const wrapped = (unit: string) => unit.includes("\n") || OPEN.test(unit);

/** The controls in page order, duplicate links left out, and runs of short links folded. */
function items(page: Snapshot): Item[] {
  const out: Item[] = [];
  const seen = new Set<string>();
  let run: Control[] = [];
  const flush = () => {
    if (run.length >= FOLD_RUN) out.push({ fold: run });
    else for (const c of run) out.push({ control: c });
    run = [];
  };
  for (const c of page.controls) {
    if (c.role === "link" && c.href && !/^\s*(?:#|javascript:)/i.test(c.href)) {
      const key = JSON.stringify([c.frameId, c.label, c.href]);
      if (seen.has(key)) continue;
      seen.add(key);
    }
    if (c.role !== "link" || c.form !== undefined || c.dialog || c.label.length > SHORT) {
      flush();
      out.push({ control: c });
      continue;
    }
    const last = run.at(-1);
    // Links that share a row are one row of content, not a menu (T4).
    if (last && ((c.row && c.row === last.row) || c.section !== last.section || c.frameId !== last.frameId)) flush();
    run.push(c);
  }
  flush();
  return out;
}

/** Submit buttons first; then fields and open dialogs; then what is on screen; then folds; then the rest (T1, T2, T9). */
const rank = (item: Item): number => "fold" in item ? 2 : item.control.submit ? -1
  : FIELDS.has(item.control.role) || item.control.dialog ? 0 : item.control.offscreen ? 3 : 1;

/** A submit button, a field or an open dialog: a focus never drops it. */
const sure = (item: Item) => "control" in item && (item.control.submit || FIELDS.has(item.control.role) || item.control.dialog);

/** The stemmed words of a text: lower case, with a trailing es, s, ing or ed cut off (T15). */
const stems = (text: string): string[] => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  .map((w) => w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, "") : w.length > 3 ? w.replace(/s$/, "") : w);

/** The words a control answers to: label, near, section, name, placeholder and options. */
const words = (item: Item): Set<string> => new Set((("fold" in item ? item.fold : [item.control]))
  .flatMap((c) => stems([c.label, c.near, c.section, c.name, c.placeholder, ...(c.options ?? []).map((o) => o.label)].join(" "))));

/**
 * A scorer for the focus: the idf-weighted count of the focus words that a text shares.
 * Idf counts the controls of this page, so a word that most controls share weighs little.
 */
function scorer(focus: string, controls: Set<string>[]): (text: Set<string>) => number {
  const want = new Set(stems(focus));
  const idf = new Map([...want].map((w) => [w, Math.log(1 + controls.length / (1 + controls.filter((c) => c.has(w)).length))]));
  return (text) => [...want].reduce((sum, w) => sum + (text.has(w) ? idf.get(w)! : 0), 0);
}

/** The best `n` of `list` by score, then by `tie`, then by page order; returned as a set (T15). */
const best = <T>(list: T[], n: number, score: (t: T) => number, tie: (t: T) => number = () => 0): Set<T> =>
  new Set(list.map((t, i) => [t, i] as const).toSorted((a, b) => score(b[0]) - score(a[0]) || tie(a[0]) - tie(b[0]) || a[1] - b[1]).slice(0, n).map(([t]) => t));

/**
 * The page as text for a planner: the title, the address, up to 40 controls
 * and the visible text. A menu folds to one line that names each link and
 * its id. Duplicate links go, and text that only repeats a shown label goes.
 * The kept control lines stay in page order. A secret control's value
 * shows as "•••", so a caller does not have to mask it first.
 */
export function pageText(page: Snapshot, options: PageTextOptions = {}): string {
  const max = options.maxControls ?? MAX_CONTROLS;
  const all = items(page);
  const focus = options.focus?.trim();
  const score = focus ? scorer(focus, all.map(words)) : undefined;
  let room = max;
  const ranked = score && best(all.filter((item) => !sure(item)), FOCUS_CONTROLS, (item) => score(words(item)), rank);
  const first = () => all.map((item, i) => [item, i] as const).toSorted((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([item]) => item).filter((item) => {
      const cost = "fold" in item ? Math.ceil(item.fold.length / 4) : 1;
      if (cost > room) return false;
      room -= cost;
      return true;
    });
  const picked = new Set(ranked ? all.filter((item) => sure(item) || ranked.has(item)) : first());
  const kept = all.filter((item) => picked.has(item));
  const left = all.filter((item) => !picked.has(item)).reduce((n, item) => n + ("fold" in item ? item.fold.length : 1), 0);
  const lines = kept.map((item) => ("fold" in item ? foldLine(item.fold) : line(item.control)));
  if (left > 0) lines.push(`... ${left} more controls`);

  const keptControls = kept.flatMap((item) => ("fold" in item ? item.fold : [item.control]));
  const shown = new Set(keptControls.map((c) => c.label.trim()).filter(Boolean));
  // Long values a control line shows (T12), and the labels with no spaces, to find menu text run together (T13).
  const values = keptControls.filter((c) => !c.secret && c.value.length >= 20).map((c) => c.value.replace(/\s+/g, " "));
  const bare = [...shown].map((l) => l.replace(/\s+/g, "")).filter(Boolean);
  const onlyLabels = (unit: string) => {
    const s = unit.replace(/\s+/g, "");
    if (s.length > 200) return false;
    const can = [true];
    for (let i = 0; i < s.length; i++) if (can[i]) for (const l of bare) if (s.startsWith(l, i)) can[i + l.length] = true;
    return can[s.length] === true;
  };
  const seen = new Set<string>();
  const candidates = units(page.text).filter((unit) => {
    if (wrapped(unit) || ALERT.test(unit)) return true;
    if (!/[\p{L}\p{N}]/u.test(unit)) return false;
    if (shown.has(unit)) return false;
    if (unit.length >= 20 && values.some((v) => v.includes(unit))) return false;
    if (onlyLabels(unit)) return false;
    if (unit.length > SHORT || /\d/.test(unit)) return true;
    if (seen.has(unit)) return false;
    seen.add(unit);
    return true;
  });
  // With a focus, a wrapped or alert unit stays; of the rest, only the best FOCUS_TEXT (T15).
  const chosen = score && best(candidates.filter((unit) => !wrapped(unit) && !ALERT.test(unit)), FOCUS_TEXT, (unit) => score(new Set(stems(unit))));
  const text = chosen ? candidates.filter((unit) => wrapped(unit) || ALERT.test(unit) || chosen.has(unit)) : candidates;
  return [`Title: ${quote(page.title)}`, `Address: ${page.url}`, "Controls:", ...lines, "Text:", ...text.map(show)].join("\n");
}

/** When the frame's document loaded: the first item of readFrame's key. */
const loaded = (key: string) => {
  try { return (JSON.parse(key) as unknown[])[0]; } catch { return key; }
};

/** The same document in every frame: no navigation and no reload (D2). */
function sameFrames(a: Snapshot, b: Snapshot): boolean {
  if (a.url !== b.url || a.frames.length !== b.frames.length) return false;
  return a.frames.every((f, i) => {
    const g = b.frames[i];
    return !!g && g.frameId === f.frameId && g.url === f.url && g.documentId === f.documentId && loaded(g.key) === loaded(f.key);
  });
}

/** Compares real values, so a secret that changed shows as changed though both mask to "•••" (D7). */
const state = (c: Control) => JSON.stringify([line(c), c.readOnly, c.value]);

/** A changed control. A secret one says only that it changed, never a value (D7). */
function changedLine(c: Control, was: Control): string {
  if (!c.secret || c.value === was.value) return line(c);
  return `${line(c)}: ${!c.value ? "cleared" : was.value ? "changed" : "filled"}`;
}

/**
 * What changed from `before` to `after`, the snapshots read before and after
 * one action. On the same document it gives a short diff: the controls that
 * changed, appeared or went away, a new title, and every new text line. When
 * the page navigated or most of it changed, it gives `pageText(after)` with
 * `full: true`. A secret control never shows a value: a changed one says
 * that it was filled, changed or cleared.
 */
export function changeText(before: Snapshot, after: Snapshot, options: ChangeOptions = {}): Change {
  const whole: Change = { full: true, text: pageText(after, options) };
  if (!sameFrames(before, after)) return whole;
  const max = options.maxControls ?? MAX_CONTROLS;
  const old = new Map(before.controls.map((c) => [c.id, c]));
  const now = new Set(after.controls.map((c) => c.id));
  const gone = before.controls.filter((c) => !now.has(c.id));
  const added = after.controls.filter((c) => !old.has(c.id));
  const changed = after.controls.filter((c) => old.has(c.id) && state(old.get(c.id)!) !== state(c));
  const total = new Set([...old.keys(), ...now]).size;
  if (gone.length + added.length + changed.length > total / 2 || Math.max(gone.length, added.length, changed.length) > max) return whole;

  const was = new Map<string, number>();
  for (const unit of units(before.text)) was.set(unit, (was.get(unit) ?? 0) + 1);
  const fresh = units(after.text).filter((unit) => {
    const n = was.get(unit) ?? 0;
    if (n > 0) was.set(unit, n - 1);
    return n === 0;
  });
  const freshLength = fresh.join("\n").length;
  if (freshLength > DIFF_TEXT || freshLength > after.text.length / 2) return whole;
  const removed = [...was.values()].reduce((sum, n) => sum + n, 0);

  const out = [`The page did not navigate: ${after.url}`];
  if (after.title !== before.title) out.push(`New title: ${quote(after.title)}`);
  if (after.captcha && !before.captcha) out.push("A captcha is now on the page.");
  const target = after.controls.find((c) => c.id === options.target);
  if (target && !changed.includes(target) && !added.includes(target)) out.push("Acted on:", line(target));
  if (changed.length) out.push("Changed:", ...changed.map((c) => changedLine(c, old.get(c.id)!)));
  if (added.length) out.push("New:", ...added.map(line));
  if (gone.length) out.push("Gone:", ...gone.map(line));
  if (removed) out.push(`(${removed} lines of text went away.)`);
  if (fresh.length) out.push("New text:", ...fresh.map(show));
  if (!changed.length && !added.length && !gone.length && !fresh.length && !removed && after.title === before.title && after.captcha === before.captcha) {
    out.splice(1, 0, "Nothing on the page changed.");
  }
  return { full: false, text: out.join("\n") };
}
