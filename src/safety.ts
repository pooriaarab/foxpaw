// Controls that spend money, delete data or end a session. The controller
// never picks one unless the goal asks for it in its own words: a whole verb,
// outside emails, URLs and quotes, with no negation earlier in its clause.

interface Risk {
  /** What the control does, for messages. */
  name: string;
  /** Labels that do it, by stem and phrase. */
  label: RegExp;
  /** Goal verbs that ask for it. */
  goal: RegExp;
}

const RISKS: Risk[] = [
  {
    name: "spend money",
    label: /\b(?:pay\w*|buy\w*|purchas\w*|check\s*-?\s*out\w*|place\s+(?:\w+\s+)?order|order\s+now|confirm\s+(?:\w+\s+)?(?:order|purchase|payment|booking)|complete\s+(?:\w+\s+)?(?:order|purchase|payment)|subscribe\s+and\s+pay)\b/i,
    goal: /\b(?:pay|buy|purchase|order|check\s*-?\s*out|checkout)\b/gi,
  },
  { name: "delete data", label: /\b(?:delet\w*|remov\w*|eras\w*|destroy\w*|discard\w*|wipe\w*)\b/i, goal: /\b(?:delete|remove|erase|destroy|discard|wipe)\b/gi },
  {
    name: "end an account",
    label: /\b(?:cancel\s+(?:\w+\s+)?(?:account|subscription|membership|plan|order)|close\s+(?:\w+\s+)?account|unsubscrib\w*|deactivat\w*)\b/i,
    goal: /\b(?:cancel|close|unsubscribe|deactivate)\b/gi,
  },
  { name: "end the session", label: /\b(?:sign|log)\s*-?\s*(?:out|off)\b/i, goal: /\b(?:sign|log)\s*-?\s*(?:out|off)\b/gi },
];

const NEGATION = /\b(?:not|never|no|without|avoid|don['’]?t|won['’]?t)\b/i;

/** What a risky label does, or null for a safe one. */
export function risky(label: string): string | null {
  return RISKS.find((r) => r.label.test(label))?.name ?? null;
}

/** Does the goal ask, in its own words, for what this risky label does? */
export function allowedBy(label: string, goal: string): boolean {
  const risk = RISKS.find((r) => r.label.test(label));
  if (!risk) return true;
  const own = goal.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ").replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ").replace(/"[^"]*"|“[^”]*”|'[^']*'/g, " ");
  for (const found of own.matchAll(risk.goal)) {
    const clause = own.slice(0, found.index).split(/[,;.!?]|\bthen\b|\bbut\b/i).pop() ?? "";
    if (!NEGATION.test(clause)) return true;
  }
  return false;
}
