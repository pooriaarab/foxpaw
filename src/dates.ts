// Dates as ISO strings (YYYY-MM-DD), so equal dates are equal strings.
// Adapted from foxpilot's dates.ts (MIT), which ports gliner2-ultrafast
// dates.py (MIT). Month names in French, German and Spanish are added.

export type IsoDate = string;

const MONTH_NAMES: [string, number][] = [
  ...["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map((m, i) => [m, i + 1] as [string, number]),
  ["sept", 9],
  // French, German, Spanish. Accents are removed before matching.
  ["janv", 1], ["fevr", 2], ["mars", 3], ["avr", 4], ["mai", 5], ["juin", 6], ["juil", 7], ["aout", 8], ["dece", 12],
  ["janu", 1], ["marz", 3], ["juni", 6], ["juli", 7], ["okt", 10], ["dez", 12],
  ["ene", 1], ["abr", 4], ["ago", 8], ["dic", 12],
];
const MONTH = "(?:jan|feb|fev|mar|apr|avr|abr|may|mai|jun|jui|jul|aug|aou|ago|sep|oct|okt|nov|dec|dez|dic|ene)[a-z]*\\.?";
const DATE = new RegExp(
  `\\b(?:(?<iso>\\d{4}-\\d{1,2}-\\d{1,2})` +
    `|(?<month>${MONTH})\\s+(?<day>\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(?<year>\\d{4}))?` +
    `|(?<day2>\\d{1,2})(?:st|nd|rd|th|er)?\\.?\\s+(?:de\\s+)?(?<month2>${MONTH})(?:,?\\s+(?:de\\s+)?(?<year2>\\d{4}))?` +
    `|(?<m>\\d{1,2})/(?<d>\\d{1,2})/(?<y>\\d{4}))(?![\\w/])`,
  "i",
);

const plain = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

function monthOf(word: string): number {
  const w = plain(word).replace(/\.$/, "");
  let best = 0, length = 0;
  for (const [prefix, month] of MONTH_NAMES) if (w.startsWith(prefix) && prefix.length > length) [best, length] = [month, prefix.length];
  return best;
}

function iso(year: number, month: number, day: number): IsoDate | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Where the first calendar date is in the text, or null. */
export function findDate(text: string): { start: number; end: number } | null {
  const found = DATE.exec(plain(text));
  return found ? { start: found.index, end: found.index + found[0].length } : null;
}

/** The first calendar date in the text, or null. A missing year is this year, or next year when the day has passed. */
export function firstDate(text: unknown, today: Date = new Date()): IsoDate | null {
  const found = DATE.exec(plain(String(text ?? "")));
  if (!found?.groups) return null;
  const g = found.groups;
  if (g.iso) {
    const [year, month, day] = g.iso.split("-").map(Number) as [number, number, number];
    return iso(year, month, day);
  }
  if (g.m) return iso(Number(g.y), Number(g.m), Number(g.d));
  const month = monthOf(g.month ?? g.month2 ?? "");
  const day = Number(g.day ?? g.day2);
  const year = g.year ?? g.year2;
  if (month < 1) return null;
  const thisYear = today.getFullYear();
  const parsed = iso(year ? Number(year) : thisYear, month, day);
  if (!parsed || year) return parsed;
  return parsed < iso(thisYear, today.getMonth() + 1, today.getDate())! ? iso(thisYear + 1, month, day) : parsed;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const ORDINALS: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5, last: -1 };
const NUMBERS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const at = (year: number, month: number, date: number) => new Date(Date.UTC(year, month, date));
const isoOf = (d: Date) => iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());

/** "tomorrow", "next Friday", "the 1st Friday of next month", "in 2 weeks". */
export function relativeDate(text: unknown, today: Date = new Date()): IsoDate | null {
  const t = String(text ?? "").toLowerCase();
  const base = at(today.getFullYear(), today.getMonth(), today.getDate());
  const plus = (days: number) => isoOf(at(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + days));
  const nth = new RegExp(`\\b(${Object.keys(ORDINALS).join("|")})\\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*\\s+(?:of|in)\\s+(?:(this|next)\\s+month|(${MONTH})(?:,?\\s+(\\d{4}))?)`).exec(t);
  if (nth) {
    const [, ordinal, weekday, which, monthName, year] = nth;
    let y = base.getUTCFullYear();
    let m = base.getUTCMonth();
    if (which === "next") m += 1;
    else if (monthName) {
      m = monthOf(monthName) - 1;
      if (year) y = Number(year);
      else if (m < base.getUTCMonth()) y += 1;
    }
    const first = at(y, m, 1);
    const wd = WEEKDAYS.indexOf(weekday!);
    const n = ORDINALS[ordinal!]!;
    if (n === -1) {
      const last = at(first.getUTCFullYear(), first.getUTCMonth() + 1, 0);
      return isoOf(at(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7)));
    }
    const found = at(first.getUTCFullYear(), first.getUTCMonth(), 1 + ((wd - first.getUTCDay() + 7) % 7) + (n - 1) * 7);
    return found.getUTCMonth() === first.getUTCMonth() ? isoOf(found) : null;
  }
  if (/\bday after tomorrow\b/.test(t)) return plus(2);
  if (/\btomorrow\b/.test(t)) return plus(1);
  if (/\b(today|tonight)\b/.test(t)) return plus(0);
  const later = /\bin\s+(\d+|a|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|week)s?\b/.exec(t);
  if (later) {
    const n = NUMBERS[later[1]!] ?? Number(later[1]);
    return plus(later[2] === "week" ? n * 7 : n);
  }
  // Full names only: "Sun Valley" and "Sat" are not dates.
  const named = /\b(?:(this|next|coming)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(t);
  if (named) {
    const ahead = (WEEKDAYS.indexOf(named[2]!.slice(0, 3)) - base.getUTCDay() + 7) % 7;
    return plus(named[1] === "this" ? ahead : ahead || 7);
  }
  return null;
}

/** A calendar date if the text has one, else a relative one. */
export function resolveDate(text: unknown, today: Date = new Date()): IsoDate | null {
  return firstDate(text, today) ?? relativeDate(text, today);
}

/** The ISO date written in a field format such as "DD/MM/YYYY". No format gives ISO. */
export function formatDate(date: IsoDate, format: string | undefined): string {
  if (!format) return date;
  const [y, m, d] = date.split("-") as [string, string, string];
  return format.replace("YYYY", y).replace("MM", m).replace("DD", d);
}

/** The date a field shows, read with the field's format first. */
export function readDate(text: string, format: string | undefined, today: Date = new Date()): IsoDate | null {
  if (format) {
    const order = format.match(/YYYY|MM|DD/g) ?? [];
    const parts = /(\d{1,4})\D(\d{1,2})\D(\d{1,4})/.exec(text);
    if (parts && order.length === 3) {
      const value = Object.fromEntries(order.map((k, i) => [k, Number(parts[i + 1])]));
      return iso(value.YYYY!, value.MM!, value.DD!);
    }
  }
  return firstDate(text, today);
}
