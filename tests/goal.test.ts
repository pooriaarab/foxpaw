// G1-G4: how a goal becomes requirements.
import { describe, expect, it } from "vitest";
import { parseGoal } from "../src/goal.js";

const TODAY = new Date(2026, 8, 25);
const brief = (goal: string) => parseGoal(goal, TODAY).requirements.map(({ key, value, date, kind }) => ({ key, value, date, kind }));

describe("parseGoal", () => {
  it("keeps a date with a comma whole (G1)", () => {
    expect(brief("depart December 3, 2026, cabin Business")).toEqual([
      { key: "depart", value: undefined, date: "2026-12-03", kind: "date" },
      { key: "cabin Business", value: undefined, date: undefined, kind: "setting" },
    ]);
  });

  it("splits key: value items (G2)", () => {
    expect(brief("Name: Sam Lee, email: sam@example.com; shipping postcode = 94110")).toEqual([
      { key: "Name", value: "Sam Lee", date: undefined, kind: "value" },
      { key: "email", value: "sam@example.com", date: undefined, kind: "value" },
      { key: "shipping postcode", value: "94110", date: undefined, kind: "value" },
    ]);
  });

  it("keeps a quoted value whole", () => {
    expect(brief('type "Fish, chips and peas" into the order note')).toEqual([
      { key: "order note", value: "Fish, chips and peas", date: undefined, kind: "value" },
    ]);
  });

  it("starts a requirement at each preposition (G3)", () => {
    expect(brief("Find a flight from New York to Boston on October 9, 2026")).toEqual([
      { key: "Find a flight", value: undefined, date: undefined, kind: "setting" },
      { key: "from", value: "New York", date: undefined, kind: "value" },
      { key: "to", value: "Boston", date: undefined, kind: "value" },
      { key: "on", value: undefined, date: "2026-10-09", kind: "date" },
    ]);
  });

  it("does not split 'set X to Y' (G3)", () => {
    expect(brief("set the language to French")).toEqual([
      { key: "language", value: "French", date: undefined, kind: "value" },
    ]);
  });

  it("reads 'accept the terms' as a setting", () => {
    expect(brief("accept the terms")).toEqual([{ key: "terms", value: undefined, date: undefined, kind: "setting" }]);
  });

  it("turns sending off for 'do not submit' (G4)", () => {
    const parsed = parseGoal("email: sam@example.com, but do not submit the form", TODAY);
    expect(parsed.submit).toBe(false);
    expect(parsed.requirements.map((r) => r.key)).toEqual(["email"]);
    expect(parseGoal("email: sam@example.com", TODAY).submit).toBe(true);
  });

  it("finds an email with no key", () => {
    expect(brief("sign up with sam@example.com")).toEqual([
      { key: "sign up", value: "sam@example.com", date: undefined, kind: "value" },
    ]);
  });
});
