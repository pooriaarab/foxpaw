// A Chooser backed by a GLiNER2 model through foxmind (or any object with
// the same extract/classify shape). foxpaw bundles no model runtime: the
// caller builds the model and passes it in. The model scores the observed
// controls as labels for the requirement, as in foxpilot's controller.
import type { Requirement } from "../goal.js";
import type { Control } from "../types.js";
import type { Chooser } from "./chooser.js";

/** foxmind's Mind, or anything with its extract and classify methods. */
export interface MindLike {
  extract(text: string, labels: Record<string, string | undefined>): Promise<{ entities: Record<string, { text: string }[]> }>;
  classify(texts: string[], prompt: string, labels: Record<string, string | undefined>): Promise<{ scores: Record<string, number>[] }>;
}

/** At most this many controls go into one classify call. */
export const LABEL_CAP = 32;

const KINDS: Record<string, string> = {
  field: "a text field to type a value into",
  select: "a dropdown value to choose",
  click: "a button, link, box or option to press",
};
const VALUE_TYPES: Record<string, string> = {
  person: "a person's name",
  location: "a place, city, country, airport or address",
  organization: "a company, brand or organisation name",
  email: "an email address",
  phone: "a phone number",
  number: "a count, quantity or amount",
  date: "a calendar date or day",
};

const kindOf = (c: Control) =>
  c.tag === "select" ? KINDS.select : ["textbox", "searchbox", "spinbutton"].includes(c.role) || (c.role === "combobox" && c.tag === "input") ? KINDS.field : KINDS.click;

export function glinerChooser(mind: MindLike): Chooser {
  for (const method of ["extract", "classify"] as const) {
    if (typeof mind?.[method] !== "function") throw new TypeError(`glinerChooser needs an object with a ${method}() method, such as a foxmind Mind.`);
  }
  return {
    name: "gliner",
    async choose(requirement: Requirement, controls: Control[]) {
      const kept = controls.slice(0, LABEL_CAP);
      if (!kept.length) return null;
      // Labels must be unique, or two same-named controls share one score.
      const byLabel = new Map<string, Control>();
      for (const control of kept) {
        const base = (control.label || control.placeholder || control.name || control.role).replace(/\s+/g, " ").trim().slice(0, 90);
        let label = base;
        for (let i = 2; byLabel.has(label); i++) label = `${base} (${i})`;
        byLabel.set(label, control);
      }
      const labels = Object.fromEntries([...byLabel].map(([label, control]) => [label, kindOf(control)]));
      const { scores } = await mind.classify([requirement.text], "referenced", labels);
      let best: [string, number] | null = null;
      for (const [label, score] of Object.entries(scores[0] ?? {})) if (byLabel.has(label) && (!best || score > best[1])) best = [label, score];
      return best ? { controlId: byLabel.get(best[0])!.id, score: best[1] } : null;
    },
    async extract(goal: string, labels: string[]) {
      const { entities } = await mind.extract(goal, Object.fromEntries(labels.map((l) => [l, VALUE_TYPES[l]])));
      return Object.fromEntries(Object.entries(entities).filter(([, spans]) => spans.length).map(([label, spans]) => [label, spans.map((s) => s.text)]));
    },
  };
}
