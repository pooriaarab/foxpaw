// C14, C15: which control labels are risky, and when the goal allows them.
import { describe, expect, it } from "vitest";
import { allowedBy, risky } from "../src/safety.js";

describe("risky labels (C14)", () => {
  it.each(["Delete account", "Place your order", "Confirm payment", "Check out", "Checkout", "Payment", "Pay now",
    "Buy now", "Purchase", "Complete purchase", "Remove item", "Cancel subscription", "Unsubscribe", "Sign out", "Log out", "Close account"])(
    "%s is risky", (label) => {
      expect(risky(label)).not.toBeNull();
    });

  it.each(["Save changes", "Account details", "Order history", "Sign up", "Subscribe", "Book", "Search", "Continue"])(
    "%s is not risky", (label) => {
      expect(risky(label)).toBeNull();
    });
});

describe("when the goal allows a risky label (C15)", () => {
  it("allows a whole verb in the goal", () => {
    expect(allowedBy("Place your order", "order a large pizza")).toBe(true);
    expect(allowedBy("Pay now", "pay the invoice")).toBe(true);
    expect(allowedBy("Delete account", "delete my account")).toBe(true);
    expect(allowedBy("Check out", "check out with the saved card")).toBe(true);
  });

  it("does not count a word inside an email, a URL or a quote", () => {
    expect(allowedBy("Pay now", "email: me@paypal.com")).toBe(false);
    expect(allowedBy("Pay now", "open https://pay.example.com/help")).toBe(false);
    expect(allowedBy("Buy now", 'search for "buy now pay later"')).toBe(false);
  });

  it("does not count a negated verb", () => {
    expect(allowedBy("Buy now", "add the book to the list, do not buy anything")).toBe(false);
    expect(allowedBy("Pay now", "never pay, just look")).toBe(false);
    expect(allowedBy("Delete account", "change my name without deleting the account")).toBe(false);
  });

  it("does not let an unrelated goal through", () => {
    expect(allowedBy("Confirm payment", "email: a@b.co")).toBe(false);
    expect(allowedBy("Place your order", "email: a@b.co")).toBe(false);
  });
});
