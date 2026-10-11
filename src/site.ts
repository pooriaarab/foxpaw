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
  return site === siteOf(start) || hostIn(url, allowHosts);
}

/** Is the URL's host one of `allowHosts` (the host of a URL entry), or under one? */
function hostIn(url: string, allowHosts: string[]): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return allowHosts.some((allowed) => {
    const a = (URL.canParse(allowed) ? new URL(allowed).hostname : allowed).toLowerCase().replace(/^\*?\./, "");
    return host === a || host.endsWith(`.${a}`);
  });
}

/**
 * Why a form on `page` may not send to `to` (C22, C24, C32), or null when it may.
 * `to` is undefined outside a form (C29 decides). A sensitive value goes only
 * to an http or https action. An `allowHosts` URL entry (one with a "/") is a
 * pin: with one, every send goes only to an action a URL entry names, by exact
 * origin and path, or by path prefix when the entry ends with "/". A host entry
 * allows another origin, but not for a sensitive value, which stays in the
 * page's folder or under its path.
 */
export function refuseDestination(page: string, to: string | undefined, allowHosts: string[], sensitive: boolean): string | null {
  const pins = allowHosts.filter((a) => a.includes("/"));
  if (to === undefined) return pins.length ? "fields outside a form send to an unknown place, not to the destination you approved" : null;
  if (!/^https?:/i.test(to) || !URL.canParse(to)) {
    return sensitive || pins.length ? `the form sends ${sensitive ? "a sensitive value " : ""}to "${to}", which is not a web address` : null;
  }
  const [from, dest] = [new URL(page), new URL(to)];
  const names = (a: string) => {
    if (!URL.canParse(a)) return false;
    const pin = new URL(a);
    return pin.origin === dest.origin && (pin.pathname.endsWith("/") ? dest.pathname.startsWith(pin.pathname) : dest.pathname === pin.pathname);
  };
  if (pins.length) return pins.some(names) ? null : `the form sends to ${dest.origin}${dest.pathname}, not to the destination you approved`;
  if (dest.origin !== from.origin) {
    return !sensitive && hostIn(to, allowHosts) ? null : `the form sends to ${dest.host}, which is not the origin of this page`;
  }
  const dir = from.pathname.slice(0, from.pathname.lastIndexOf("/") + 1);
  const near = (dest.pathname.startsWith(dir) && !dest.pathname.slice(dir.length).includes("/")) || dest.pathname.startsWith(`${from.pathname}/`);
  return !sensitive || near ? null : `the form sends a sensitive value to ${dest.pathname}, outside the path of this page`;
}
