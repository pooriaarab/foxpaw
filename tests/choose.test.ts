// C1, C2: ruleChooser picks among controls by words, with no model.
import { describe, expect, it } from "vitest";
import { ruleChooser } from "../src/choosers/rule.js";
import type { Control } from "../src/types.js";
import type { Requirement } from "../src/goal.js";

let n = 0;
const field = (label: string, more: Partial<Control> = {}): Control => ({
  id: `0:${++n}`, frameId: 0, node: n, role: "textbox", tag: "input", type: "text", label, name: "", placeholder: "",
  section: "", value: "", disabled: false, readOnly: false, required: false, offscreen: false, submit: false,
  dialog: false, autocomplete: false, picker: false, secret: false, guard: "", ...more,
});
const req = (key: string, value?: string, more: Partial<Requirement> = {}): Requirement =>
  ({ text: value ? `${key}: ${value}` : key, key, value, kind: value ? "value" : "setting", ...more });

describe("ruleChooser", () => {
  const chooser = ruleChooser();

  it("picks the field that matches every word of the requirement (C1)", async () => {
    const billing = field("Billing postcode");
    const shipping = field("Shipping postcode");
    expect((await chooser.choose(req("shipping postcode", "94110"), [billing, shipping]))?.controlId).toBe(shipping.id);
    expect((await chooser.choose(req("billing postcode", "94110"), [billing, shipping]))?.controlId).toBe(billing.id);
  });

  it("returns null on a tie instead of guessing (C2)", async () => {
    expect(await chooser.choose(req("email", "sam@example.com"), [field("Email"), field("Email")])).toBeNull();
  });

  it("breaks a tie with the section name", async () => {
    const work = field("Email", { section: "Work contact" });
    const home = field("Email", { section: "Home contact" });
    expect((await chooser.choose(req("home email", "a@b.co"), [work, home]))?.controlId).toBe(home.id);
  });

  it("matches common synonyms", async () => {
    const zip = field("ZIP code");
    const phone = field("Mobile number", { type: "tel" });
    expect((await chooser.choose(req("postcode", "94110"), [phone, zip]))?.controlId).toBe(zip.id);
    expect((await chooser.choose(req("phone", "555 0100"), [zip, phone]))?.controlId).toBe(phone.id);
  });

  it("prefers a field whose type fits the value", async () => {
    const name = field("Contact");
    const mail = field("Contact address", { type: "email" });
    expect((await chooser.choose(req("contact", "sam@example.com"), [name, mail]))?.controlId).toBe(mail.id);
  });

  it("matches a setting to a select through its options", async () => {
    const cabin = field("Cabin", { role: "combobox", tag: "select", type: "", options: [
      { value: "e", label: "Economy", selected: true }, { value: "b", label: "Business", selected: false }] });
    const seat = field("Seat", { role: "combobox", tag: "select", type: "" });
    expect((await chooser.choose(req("cabin Business"), [seat, cabin]))?.controlId).toBe(cabin.id);
  });

  it("scores nothing it cannot match", async () => {
    expect(await chooser.choose(req("Find a flight"), [field("Email")])).toBeNull();
  });

  it("extracts emails, dates and quoted text with no model", async () => {
    const found = await chooser.extract('email sam@example.com, note "hello there", on October 9, 2026', ["email", "date", "quoted"]);
    expect(found).toEqual({ email: ["sam@example.com"], date: ["October 9, 2026"], quoted: ["hello there"] });
  });
});
