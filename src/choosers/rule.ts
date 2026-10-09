// A Chooser with no model: word overlap between the requirement and each
// control's label, name, placeholder and options, plus a bonus when the
// control's type fits the value. It needs no download, so foxpaw and its
// tests run anywhere.
import { findDate } from "../dates.js";
import type { Requirement } from "../goal.js";
import type { Control } from "../types.js";
import type { Choice, Chooser } from "./chooser.js";

const STOP = new Set(["the", "a", "an", "my", "your", "our", "please", "field", "box", "enter", "type", "select", "choose",
  "pick", "set", "with", "of", "in", "into", "for", "is", "as", "and", "or", "i", "me", "this", "that", "here", "find", "use"]);
const SYNONYMS: Record<string, string> = {
  "e-mail": "email", mail: "email", zip: "postcode", postal: "postcode", tel: "phone", telephone: "phone", mobile: "phone",
  cell: "phone", departure: "depart", departing: "depart", leave: "depart", leaving: "depart", outbound: "depart",
  returning: "return", inbound: "return", origin: "from", destination: "to", qty: "quantity", agree: "accept",
};
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /\+?\d[\d ()-]{6,}\d/g;

/** Lower-case words with accents, stop words and plural "s" removed, synonyms joined. */
export function words(text: string): string[] {
  const flat = text.normalize("NFKD").replace(/\p{M}/gu, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
    .replace(/\b(?:zip|postal|post)[\s_-]*code\b/g, "postcode").replace(/\be[\s-]?mail\b/g, "email");
  return [...new Set((flat.match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((w) => SYNONYMS[w] ?? w)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .filter((w) => !STOP.has(w)))];
}

const shape = (value: string | undefined) =>
  !value ? "" : new RegExp(`^${EMAIL.source}$`).test(value) ? "email" : new RegExp(`^${PHONE.source}$`).test(value) ? "phone" : /^\d+$/.test(value) ? "number" : "";

/** How well `control` serves `requirement`, from 0. Above 1 is possible before the caller clamps it. */
export function score(requirement: Requirement, control: Control): number {
  const want = words(requirement.key || requirement.text);
  if (!want.length) return 0;
  const own = new Set(words(`${control.label} ${control.name.replace(/[_-]/g, " ")} ${control.placeholder}`));
  // An option the requirement names counts as words of the control ("cabin Business").
  for (const option of control.options ?? []) {
    const ow = words(option.label);
    if (ow.length && ow.every((w) => want.includes(w))) ow.forEach((w) => own.add(w));
  }
  const hit = want.filter((w) => own.has(w)).length;
  let total = own.size ? 0.8 * (hit / want.length) + 0.2 * (hit / own.size) : 0;
  const value = requirement.value?.toLowerCase();
  if (value && ["option", "radio", "tab", "menuitem", "gridcell"].includes(control.role) && control.label.toLowerCase().includes(value)) total = Math.max(total, 0.9);
  const kind = shape(requirement.value);
  const type = control.type;
  if (kind === "email" && ["tel", "number", "date"].includes(type)) return 0;
  if (requirement.kind === "date" && ["email", "tel"].includes(type)) return 0;
  if ((kind === "email" && type === "email") || (kind === "phone" && type === "tel")) total += 0.3;
  if (requirement.kind === "date" && (control.picker || control.dateFormat || type === "date")) total += 0.3;
  if (kind === "number" && control.role === "spinbutton") total += 0.15;
  if (total > 0 && control.section) {
    const section = new Set(words(control.section));
    total += 0.05 * (want.filter((w) => section.has(w)).length / want.length);
  }
  return total;
}

export function ruleChooser(): Chooser {
  return {
    name: "rule",
    async choose(requirement, controls) {
      let best: Choice | null = null;
      let second = 0;
      for (const control of controls) {
        const s = score(requirement, control);
        if (!best || s > best.score) {
          second = best?.score ?? 0;
          best = { controlId: control.id, score: s };
        } else if (s > second) second = s;
      }
      if (!best || best.score <= 0 || Math.abs(best.score - second) < 1e-9) return null;
      return { controlId: best.controlId, score: Math.min(1, best.score) };
    },
    async extract(goal, labels) {
      const dates: string[] = [];
      for (let rest = goal, found = findDate(rest); found; rest = rest.slice(found.end), found = findDate(rest)) {
        dates.push(rest.slice(found.start, found.end));
      }
      const all: Record<string, string[]> = {
        email: goal.match(EMAIL) ?? [],
        phone: goal.match(PHONE) ?? [],
        date: dates,
        quoted: [...goal.matchAll(/"([^"]+)"|“([^”]+)”/g)].map((m) => m[1] ?? m[2]!),
      };
      return Object.fromEntries(labels.filter((l) => all[l]?.length).map((l) => [l, all[l]!]));
    },
  };
}
