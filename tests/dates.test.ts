// C8 and the date rules the controller and verify depend on. Relative dates
// are ported from foxpilot's tests/dates.test.ts (MIT).
import { describe, expect, it } from "vitest";
import { formatDate, readDate, resolveDate } from "../src/dates.js";

// Friday, September 25, 2026 (local time, as the extension sees it).
const TODAY = new Date(2026, 8, 25);

describe("dates in the goal", () => {
  it.each([
    ["on October 9, 2026", "2026-10-09"],
    ["9 October 2026", "2026-10-09"],
    ["2026-10-09", "2026-10-09"],
    ["3 décembre 2026", "2026-12-03"],
    ["3. Dezember 2026", "2026-12-03"],
    ["3 de diciembre de 2026", "2026-12-03"],
    ["tomorrow", "2026-09-26"],
    ["next Friday", "2026-10-02"],
    ["on the 1st Friday of next month", "2026-10-02"],
    ["in 2 weeks", "2026-10-09"],
  ])("%s -> %s", (text, iso) => {
    expect(resolveDate(text, TODAY)).toBe(iso);
  });

  it("has no date for words that only look like one", () => {
    expect(resolveDate("fly to Sun Valley", TODAY)).toBeNull();
    expect(resolveDate("next month", TODAY)).toBeNull();
    expect(resolveDate("February 30, 2026", TODAY)).toBeNull();
  });
});

describe("dates in a field (C8)", () => {
  it("types the date in the format the field asks for", () => {
    expect(formatDate("2026-12-03", "DD/MM/YYYY")).toBe("03/12/2026");
    expect(formatDate("2026-12-03", "MM/DD/YYYY")).toBe("12/03/2026");
    expect(formatDate("2026-12-03", "DD.MM.YYYY")).toBe("03.12.2026");
    expect(formatDate("2026-12-03", "YYYY-MM-DD")).toBe("2026-12-03");
    expect(formatDate("2026-12-03", undefined)).toBe("2026-12-03");
  });

  it("reads a field with the same format, so day and month do not swap", () => {
    expect(readDate("03/12/2026", "DD/MM/YYYY", TODAY)).toBe("2026-12-03");
    expect(readDate("12/03/2026", "MM/DD/YYYY", TODAY)).toBe("2026-12-03");
    expect(readDate("03/12/2026", "MM/DD/YYYY", TODAY)).toBe("2026-03-12");
  });

  it("reads a date a picker wrote in words", () => {
    expect(readDate("Thu, Dec 3, 2026", undefined, TODAY)).toBe("2026-12-03");
    expect(readDate("Pick a date", undefined, TODAY)).toBeNull();
  });
});
