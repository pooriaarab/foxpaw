// C33: preview names the destination and the fields of a form fill, and acts on nothing.
import { describe, expect, it } from "vitest";
import { preview, ruleChooser, type Control, type Snapshot } from "../src/index.js";

const TODAY = new Date(2026, 8, 25);
let n = 0;
const c = (label: string, more: Partial<Control> = {}): Control => {
  n += 1;
  return {
    id: `0:${n}`, frameId: 0, node: n, role: "textbox", tag: "input", type: "text", label, name: "", placeholder: "", section: "",
    value: "", disabled: false, readOnly: false, required: false, offscreen: false, form: 1, submit: false, dialog: false,
    autocomplete: false, picker: false, secret: false, guard: "", ...more,
  };
};
const page = (controls: Control[]): Snapshot => ({
  url: "http://fixture/checkout/pay", title: "Checkout", text: "", headings: [], controls, captcha: false, more: false,
  frames: [{ frameId: 0, url: "http://fixture/checkout/pay", key: "k", documentId: "doc" }],
});
const options = { chooser: ruleChooser(), today: TODAY };
const twin = (form: number) => ["Email", "Card number", "CVC"].map((l) => c(l, { form, action: "http://fixture/checkout/pay" }))
  .concat(c("Pay", { form, role: "button", submit: true, action: "http://fixture/checkout/pay" }));
const CARD = "email: sam@example.com, card number: 4242 4242 4242 4242, CVC: 123";

describe("preview (C33)", () => {
  it("names the form the run fills, where it sends, its button and its fields, with sensitive values masked", async () => {
    const to = { form: 3, action: "http://fixture/checkout/pay" };
    const fake = { form: 2, action: "http://fixture/attacker.test/express" };
    const controls = [c("Card number", fake), c("Pay with Express", { ...fake, role: "button", submit: true }),
      c("Email", { ...to, type: "email" }), c("Card number", to), c("CVC", to), c("Pay $40.00", { ...to, role: "button", submit: true })];
    const plan = await preview(page(controls), `${CARD}, then click "Pay $40.00"`, options);
    expect(plan).toEqual({
      sends: true, destination: "http://fixture/checkout/pay", button: "Pay $40.00",
      fields: [{ label: "Email", value: "sam@example.com" }, { label: "Card number", value: "•••• 4242" }, { label: "CVC", value: "•••" }],
    });
  });

  it("acts on nothing: the snapshot's controls keep their values", async () => {
    const controls = [c("Email", { action: "http://fixture/signup" }), c("Sign up", { role: "button", submit: true, action: "http://fixture/signup" })];
    const before = JSON.stringify(controls);
    await preview(page(controls), "email: sam@example.com, sign up", options);
    expect(JSON.stringify(controls)).toBe(before);
  });

  it("shows a choice, a checked box and a date in plain words", async () => {
    const to = { action: "http://fixture/book" };
    const controls = [c("Country", { ...to, tag: "select", role: "combobox", options: [{ value: "ca", label: "Canada", selected: false }, { value: "us", label: "United States", selected: true }] }),
      c("Accept the terms", { ...to, role: "checkbox", type: "checkbox" }), c("Check in", { ...to, type: "date" }),
      c("Book", { ...to, role: "button", submit: true })];
    const plan = await preview(page(controls), "country: Canada, check in October 2, 2026, accept the terms, book", options);
    expect(plan.destination).toBe("http://fixture/book");
    expect(plan.fields).toEqual([{ label: "Country", value: "Canada" }, { label: "Check in", value: "2026-10-02" }, { label: "Accept the terms", value: "checked" }]);
  });

  it("lists a field that already holds its value: the send carries it too", async () => {
    const to = { action: "http://fixture/booked" };
    const controls = [c("Name", to), c("Party size", { ...to, tag: "select", role: "combobox", options: [{ value: "2", label: "2", selected: true }, { value: "3", label: "3", selected: false }] }),
      c("Book a table", { ...to, role: "button", submit: true })];
    const plan = await preview(page(controls), "name: Ana Silva, party size: 2", options);
    expect(plan.fields).toEqual([{ label: "Name", value: "Ana Silva" }, { label: "Party size", value: "2" }]);
  });

  it("has no destination when the goal does not send", async () => {
    const plan = await preview(page([c("Email", { action: "http://fixture/signup" })]), "email: sam@example.com, do not submit", options);
    expect(plan).toEqual({ sends: false, destination: null, fields: [{ label: "Email", value: "sam@example.com" }] });
  });

  it("has no destination and says why when the run would stop", async () => {
    const plan = await preview(page([...twin(4), ...twin(5)]), `${CARD}, pay`, options);
    expect(plan.destination).toBeNull();
    expect(plan.blocked).toMatch(/^two forms fit the goal/);
  });

  it("has no destination for fields outside a form", async () => {
    const plan = await preview(page([c("Email", { form: undefined }), c("Submit", { role: "button", form: undefined })]), 'email: sam@example.com, then click "Submit"', options);
    expect(plan.sends).toBe(true);
    expect(plan.destination).toBeNull();
    expect(plan.button).toBe("Submit");
  });
});
