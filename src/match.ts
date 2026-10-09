// Literal matching of a value against a label. Adapted from foxpilot's
// controller.ts (MIT), which ports gliner2-ultrafast gliner.py (MIT).

const wordsOf = (text: string) =>
  String(text).normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").match(/[\p{L}\p{N}_@.+-]+/gu)?.map((w) => w.replace(/^[.+-]+|[.+-]+$/g, "")) ?? [];

/** The label holds the value as whole words, ignoring case, accents and punctuation. */
export function namesValue(label: string, value: string): boolean {
  const needle = wordsOf(value).join(" ");
  return Boolean(needle) && ` ${wordsOf(label).join(" ")} `.includes(` ${needle} `);
}

/** Edit distance where swapping two neighbouring letters is one edit. */
function edits(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_row, i) => Array.from({ length: b.length + 1 }, (_cell, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

const close = (a: string, b: string) => a === b || (!/\d/.test(a) && a.length >= 4 && edits(a, b) <= (a.length <= 6 ? 1 : 2));

/**
 * namesValue that forgives typos: each word of the value matches a word of
 * the label in order, one edit off for words of 4-6 letters and two for
 * longer ones, with up to 8 words between them. Numbers must match exactly.
 */
export function nearlyNames(label: string, value: string): boolean {
  if (namesValue(label, value)) return true;
  const want = wordsOf(value);
  const have = wordsOf(label);
  if (!want.length) return false;
  for (let start = 0; start < have.length; start++) {
    if (!close(want[0]!, have[start]!)) continue;
    let at = start;
    let skipped = 0;
    let found = true;
    for (const word of want.slice(1)) {
      let next = at + 1;
      while (next < have.length && !close(word, have[next]!)) next++;
      skipped += next - at - 1;
      if (next >= have.length || skipped > 8) { found = false; break; }
      at = next;
    }
    if (found) return true;
  }
  return false;
}
