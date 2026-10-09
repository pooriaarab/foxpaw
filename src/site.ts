// The site a URL belongs to: its registrable domain ("shop.example.co.uk"
// is "example.co.uk"). runTask pins the site it starts on, so one goal never
// acts on a site no caller judged. There is no full public suffix list here:
// common two-part suffixes are listed, and a suffix outside the list counts
// as one label (see the README limits).

const TWO_PART = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk", "com.au", "net.au", "org.au", "edu.au",
  "gov.au", "co.nz", "org.nz", "co.jp", "ne.jp", "or.jp", "co.kr", "com.br", "com.cn", "com.mx", "com.tr", "com.sg", "co.in",
  "co.za", "com.ar", "co.il", "github.io", "netlify.app", "pages.dev", "vercel.app", "workers.dev", "web.app", "firebaseapp.com"]);

/** The registrable domain of a URL's host, the whole host for an IP or a single label, or null without a host. */
export function siteOf(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  if (!host) return null;
  if (host.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || !host.includes(".")) return host;
  const labels = host.split(".");
  const take = TWO_PART.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** Is `url` on the site of `start`, or on a host in `allowHosts` or under one? */
export function sameSite(start: string, url: string, allowHosts: string[] = []): boolean {
  const site = siteOf(url);
  // A page with no host (file:, about:) stays only on pages of its own scheme with no host.
  if (!site) return siteOf(start) === null && URL.canParse(url) && URL.canParse(start) && new URL(url).protocol === new URL(start).protocol;
  if (site === siteOf(start)) return true;
  const host = new URL(url).hostname.toLowerCase();
  return allowHosts.some((allowed) => {
    const a = allowed.toLowerCase().replace(/^\*?\./, "");
    return host === a || host.endsWith(`.${a}`);
  });
}
