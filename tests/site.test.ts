// C18: which hosts count as the same site.
import { describe, expect, it } from "vitest";
import { sameSite, siteOf } from "../src/site.js";

describe("siteOf", () => {
  it.each([
    ["https://www.example.com/a", "example.com"],
    ["https://shop.example.com/", "example.com"],
    ["https://example.co.uk/", "example.co.uk"],
    ["https://a.b.example.co.uk/", "example.co.uk"],
    ["https://example.com.au/", "example.com.au"],
    ["http://127.0.0.1:8080/x", "127.0.0.1"],
    ["http://localhost:3000/", "localhost"],
    ["http://[::1]:3000/", "[::1]"],
  ])("%s -> %s", (url, site) => {
    expect(siteOf(url)).toBe(site);
  });

  it("has no site for a URL without a host", () => {
    expect(siteOf("about:blank")).toBeNull();
    expect(siteOf("not a url")).toBeNull();
  });
});

describe("sameSite", () => {
  it("keeps a run on one site", () => {
    expect(sameSite("https://www.example.com/", "https://login.example.com/x")).toBe(true);
    expect(sameSite("https://example.com/", "https://example.net/")).toBe(false);
    expect(sameSite("https://example.co.uk/", "https://other.co.uk/")).toBe(false);
    expect(sameSite("http://127.0.0.1:1/", "http://localhost:1/")).toBe(false);
  });

  it("allows the hosts a caller named, and their subdomains", () => {
    expect(sameSite("https://shop.example.com/", "https://pay.stripe.com/", ["stripe.com"])).toBe(true);
    expect(sameSite("https://shop.example.com/", "https://evilstripe.com/", ["stripe.com"])).toBe(false);
  });
});
