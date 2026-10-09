// Splits a goal into requirements with rules, no model. A requirement is a
// value for a field ("email: sam@example.com"), a date ("depart December 3,
// 2026") or a setting ("accept the terms"). A Chooser's extract() can add
// values later (controller.ts), for parts that have none.
import { findDate, resolveDate, type IsoDate } from "./dates.js";

export interface Requirement {
  /** The part of the goal, as written. */
  text: string;
  /** The words that name the field: "email", "shipping postcode", "from". */
  key: string;
  /** The value to type or choose. */
  value?: string;
  /** For a date requirement: the ISO date. */
  date?: IsoDate;
  kind: "value" | "date" | "setting";
}

export interface Goal {
  requirements: Requirement[];
  /** False when the goal says not to send the form. */
  submit: boolean;
}

const NO_SUBMIT = /[,;]?\s*(?:but\s+)?(?:do\s+not|don['’]t|never|without)\s+(?:submit|send|sending|submitting|press(?:ing)?\s+(?:submit|send))\b[^,;.]*/i;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE = /\+?\d[\d ()-]{6,}\d/;
const LEAD = /^(?:please\s+)?(?:select|choose|pick|check|tick|accept|enable|turn\s+on|agree\s+to|and)\s+(?:the\s+|a\s+|an\s+)?/i;
const HOLD = (n: number) => `${n}`;

const tidy = (text: string) => text.replace(/^[\s,;.]+|[\s,;.]+$/g, "").replace(/\s+/g, " ");
const strip = (key: string) => tidy(key.replace(/^(?:the|a|an|my|your)\s+/i, "").replace(/\s+(?:field|box)$/i, ""));

/** One part of the goal, with held dates and quotes put back. */
function readPart(part: string, held: string[], today: Date): Requirement | null {
  const restore = (s: string) => s.replace(/(\d+)/g, (_, n: string) => held[Number(n)]!);
  const text = tidy(restore(part));
  if (text.length < 2) return null;
  const quoted = /(\d+)/.exec(part);
  const value = (key: string, v: string): Requirement => ({ text, key: strip(restore(key)), value: tidy(restore(v).replace(/^"|"$/g, "")), kind: "value" });
  let m = /^(?:set|change|switch)\s+(.+?)\s+to\s+(.+)$/i.exec(part);
  if (m) return value(m[1]!, m[2]!);
  m = /^(?:type|enter|fill\s+in|put|write)\s+(.+?)\s+(?:in|into|as|for)\s+(.+)$/i.exec(part);
  if (m) return value(m[2]!, m[1]!);
  m = /^([^:=]{1,40}?)\s*[:=]\s*(.+)$/.exec(part);
  if (m) return value(m[1]!, m[2]!);
  const full = restore(part);
  if (quoted && held[Number(quoted[1])]!.startsWith('"')) {
    return value(part.replace(quoted[0], "").replace(/\b(?:with|as|is)\s*$/i, ""), held[Number(quoted[1])]!);
  }
  const date = findDate(full) ? resolveDate(full, today) : null;
  if (date) {
    const where = findDate(full)!;
    return { text, key: strip(full.slice(0, where.start) + full.slice(where.end)) || "date", date, kind: "date" };
  }
  for (const shape of [EMAIL, PHONE]) {
    const found = shape.exec(full);
    if (found) return value(full.replace(found[0], "").replace(/\s+(?:with|as|is|using|use)\s*$/i, "").replace(/^(?:with|use|using)\s+/i, ""), found[0]);
  }
  m = /^(from|to|at|near|via)\s+(.+)$/i.exec(full);
  if (m) return { text, key: m[1]!.toLowerCase(), value: tidy(m[2]!), kind: "value" };
  const relative = resolveDate(full, today);
  if (relative) return { text, key: strip(full.replace(/\b(?:on|for)\b/gi, "")) || "date", date: relative, kind: "date" };
  return { text, key: strip(full.replace(LEAD, "")), kind: "setting" };
}

export function parseGoal(goal: string, today: Date = new Date()): Goal {
  let rest = goal.replace(/\s+/g, " ").trim();
  const submit = !NO_SUBMIT.test(rest);
  rest = rest.replace(NO_SUBMIT, "");
  // Hold quoted values and dates, so splitting does not cut them.
  const held: string[] = [];
  rest = rest.replace(/"[^"]*"|“[^”]*”/g, (q) => HOLD(held.push(`"${q.slice(1, -1)}"`) - 1));
  for (let found = findDate(rest); found; found = findDate(rest)) {
    held.push(rest.slice(found.start, found.end));
    rest = rest.slice(0, found.start) + HOLD(held.length - 1) + rest.slice(found.end);
  }
  const requirements: Requirement[] = [];
  for (const clause of rest.split(/\s*(?:[,;\n]|\.\s|\bthen\b|\band\s+(?=\S+\s+\S))\s*/i)) {
    // "from X to Y on Z": each preposition starts a part, but "set X to Y" stays whole.
    const pieces = /^(?:set|change|switch|go|type|enter|put|write)\b/i.test(clause) || /[:=]/.test(clause)
      ? [clause] : clause.split(/\s+(?=(?:from|to|on|departing|returning)\s)/i);
    for (const piece of pieces) {
      const read = readPart(piece, held, today);
      if (read) requirements.push(read);
    }
  }
  return { requirements, submit };
}
