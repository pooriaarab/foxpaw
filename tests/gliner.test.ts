// M1-M4: glinerChooser over any object with foxmind's extract/classify shape.
import { describe, expect, it } from "vitest";
import { glinerChooser, type MindLike } from "../src/choosers/gliner.js";
import type { Requirement } from "../src/goal.js";
import type { Control } from "../src/types.js";

let n = 0;
const c = (label: string): Control => {
  n += 1;
  return {
    id: `0:${n}`, frameId: 0, node: n, role: "textbox", tag: "input", type: "text", label, name: "", placeholder: "", section: "",
    value: "", disabled: false, readOnly: false, required: false, offscreen: false, submit: false, dialog: false,
    autocomplete: false, picker: false, secret: false, guard: "",
  };
};
const req: Requirement = { text: "work email: a@b.co", key: "work email", value: "a@b.co", kind: "value" };

/** A fake mind that scores the label `best` highest and records each call. */
function mind(best: (labels: string[]) => string, top = 0.9) {
  const calls: { labels: string[] }[] = [];
  const fake: MindLike = {
    async extract(text, labels) {
      return { entities: Object.fromEntries(Object.keys(labels).map((l) => [l, l === "email" ? [{ text: "a@b.co", confidence: 0.9, start: 0, end: 6 }] : []])) };
    },
    async classify(_texts, _prompt, labels) {
      const names = Object.keys(labels);
      calls.push({ labels: names });
      const winner = best(names);
      return { scores: [Object.fromEntries(names.map((l) => [l, l === winner ? top : top / 2]))] };
    },
  };
  return { fake, calls };
}

describe("glinerChooser", () => {
  it("maps a score back to the right one of two same-named controls (M1)", async () => {
    const { fake, calls } = mind((labels) => labels[1]!);
    const [a, b] = [c("Email"), c("Email")];
    expect((await glinerChooser(fake).choose(req, [a, b]))?.controlId).toBe(b.id);
    expect(new Set(calls[0]!.labels).size).toBe(2);
  });

  it("sends at most 32 controls in one call (M2)", async () => {
    const { fake, calls } = mind((labels) => labels[0]!);
    const many = Array.from({ length: 100 }, (_, i) => c(`Field ${i}`));
    await glinerChooser(fake).choose(req, many);
    expect(calls[0]!.labels).toHaveLength(32);
    expect(calls[0]!.labels[0]).toBe("Field 0");
  });

  it("refuses an object with no classify when it is created (M3)", () => {
    const { fake } = mind((labels) => labels[0]!);
    expect(() => glinerChooser({ extract: fake.extract } as MindLike)).toThrow(TypeError);
    expect(() => glinerChooser({ extract: fake.extract } as MindLike)).toThrow(/classify/);
  });

  it("returns a low top score as it is (M4)", async () => {
    const { fake } = mind((labels) => labels[0]!, 0.2);
    const choice = await glinerChooser(fake).choose(req, [c("Name"), c("Phone")]);
    expect(choice?.score).toBeCloseTo(0.2);
  });

  it("extracts spans as plain text", async () => {
    const { fake } = mind((labels) => labels[0]!);
    expect(await glinerChooser(fake).extract("email a@b.co", ["email", "person"])).toEqual({ email: ["a@b.co"] });
  });
});
