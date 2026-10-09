// Reads one frame's controls. `scripting.executeScript({ func })` sends only
// this function's source (Function.prototype.toString), so it must not use
// anything from module scope: no imports, no helpers outside the function.
// Adapted from foxpilot's snapshot.js (MIT), which is adapted from
// gliner2-ultrafast (MIT, copyright Browser Use).

/** One frame as `readFrame` returns it. `tab.ts` joins the frames into a Snapshot. */
export interface FrameRead {
  url: string;
  title: string;
  text: string;
  headings: string[];
  key: string;
  captcha: boolean;
  more: boolean;
  controls: {
    node: number; role: string; tag: string; type: string; label: string; name: string; placeholder: string;
    section: string; value: string; options?: { value: string; label: string; selected: boolean }[];
    checked?: boolean; expanded?: boolean; disabled: boolean; readOnly: boolean; required: boolean;
    offscreen: boolean; form?: number; submit: boolean; dialog: boolean; popupFor?: number;
    autocomplete: boolean; picker: boolean; dateFormat?: string; secret: boolean; guard: string;
  }[];
}

/** The page cache that `readFrame` sets up and `perform` (act.ts) uses. */
export interface PageCache {
  ids: WeakMap<Element, number>;
  nodes: Map<number, Element>;
  next: number;
  guard(e: Element): string | null;
  key(): string;
}

declare global {
  interface Window {
    __foxpaw?: PageCache;
  }
}

export function readFrame(): FrameRead | null {
  if (!document.body) return null;
  const cache = (window.__foxpaw ||= { ids: new WeakMap(), nodes: new Map(), next: 1 } as PageCache);
  const identity = (e: Element): number => {
    if (!cache.ids.has(e)) cache.ids.set(e, cache.next++);
    const id = cache.ids.get(e)!;
    cache.nodes.set(id, e);
    return id;
  };
  for (const [id, e] of cache.nodes) if (!e.isConnected) cache.nodes.delete(id);

  // One loose view of input, select, textarea and button, read without narrowing.
  type Field = Element & {
    type: string; value: string; checked: boolean; selectedIndex: number; readOnly: boolean; required: boolean;
    form: HTMLFormElement | null; labels: NodeListOf<HTMLLabelElement> | null; options: HTMLOptionsCollection;
  };
  const f = (e: Element) => e as Field;
  const secret = (e: Element) => e.tagName === "INPUT" && f(e).type === "password";
  const shown = (e: Element): string => {
    if (secret(e)) return f(e).value ? "•••" : "";
    if ("value" in e && e.tagName !== "BUTTON") return String(f(e).value ?? "");
    return (e as HTMLElement).isContentEditable ? (e as HTMLElement).innerText.trim() : "";
  };
  // A person cannot see it: hidden by CSS or ARIA, zero size, a 1 px clipped
  // box, or placed where no scroll can reach (a honeypot at left:-9999px).
  const visible = (e: Element): boolean => {
    if (e.closest('[aria-hidden="true"],[inert]')) return false;
    if (!e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = e.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2 || r.right + scrollX <= 0 || r.bottom + scrollY <= 0) return false;
    // The "visually hidden" pattern: clipped to nothing, by the element or a near parent.
    for (let p: Element | null = e, depth = 0; p && depth < 4; p = p.parentElement, depth++) {
      const style = getComputedStyle(p);
      if (/rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(style.clip) || /inset\(50%\)/.test(style.clipPath)) return false;
    }
    return true;
  };
  const name = (e: Element | null, seen = new Set<Element>()): string => {
    if (!e || seen.has(e)) return "";
    seen.add(e);
    const referenced = (e.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
      .map((id) => name(document.getElementById(id), seen)).filter(Boolean).join(" ");
    const labels = [...(("labels" in e && f(e).labels) || [])];
    const text = e.tagName === "INPUT" || e.tagName === "SELECT" || e.tagName === "TEXTAREA" ? "" :
      [...e.childNodes].map((n) => n.nodeType === 3 ? n.textContent :
        n.nodeType === 1 && (n as Element).getAttribute("aria-hidden") !== "true" ? name(n as Element, seen) : "")
        .join(" ").replace(/\s+/g, " ").trim();
    return (referenced || e.getAttribute("aria-label") || labels.map((l) => name(l, seen)).filter(Boolean).join(" ") ||
      (["button", "submit", "reset"].includes(f(e).type) && e.tagName === "INPUT" ? f(e).value : "") ||
      e.getAttribute("alt") || text || e.getAttribute("title") || e.getAttribute("placeholder") || "").trim();
  };
  const section = (e: Element): string => {
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const named = p.getAttribute("aria-label") ||
        p.querySelector(":scope>h1,:scope>h2,:scope>h3,:scope>legend")?.textContent?.trim() || "";
      if (named && /^(FORM|FIELDSET|SECTION|DIALOG|NAV|ASIDE|MAIN)$/.test(p.tagName)) return named.slice(0, 70);
      if (p.getAttribute("role") === "dialog" && named) return named.slice(0, 70);
    }
    return "";
  };
  // Web components keep controls in shadow roots, where querySelectorAll does not look.
  const deep = (root: Document | ShadowRoot | Element, selector: string, out: Element[] = []): Element[] => {
    for (const e of root.querySelectorAll(selector)) out.push(e);
    for (const e of root.querySelectorAll("*")) if (e.shadowRoot) deep(e.shadowRoot, selector, out);
    return out;
  };
  const ROLES = ["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemradio", "option",
    "gridcell", "combobox", "textbox", "searchbox", "spinbutton"];
  const role = (e: Element): string | null => {
    const explicit = e.getAttribute("role");
    if (explicit && ROLES.includes(explicit)) return explicit;
    if (e.tagName === "BUTTON" || e.tagName === "SUMMARY") return "button";
    if (e.tagName === "A") return "link";
    if (e.tagName === "SELECT") return "combobox";
    if (e.tagName === "TEXTAREA" || (e as HTMLElement).isContentEditable) return "textbox";
    if (e.tagName !== "INPUT") return null;
    const type = f(e).type;
    if (type === "checkbox" || type === "radio") return type;
    if (["button", "submit", "reset", "image"].includes(type)) return "button";
    if (type === "search") return "searchbox";
    if (type === "number") return "spinbutton";
    if (["hidden", "file", "range", "color"].includes(type)) return null;
    return "textbox";
  };
  const state = (e: Element): boolean | undefined => {
    if (e.tagName === "INPUT" && ["checkbox", "radio"].includes(f(e).type)) return f(e).checked;
    for (const k of ["aria-checked", "aria-selected", "aria-pressed"]) {
      const v = e.getAttribute(k);
      if (v !== null) return v === "true";
    }
    return undefined;
  };
  const disabled = (e: Element) => e.matches(":disabled") || !!e.closest('[aria-disabled="true"]');
  const fields = () => deep(document, "input,textarea,select").filter((e) => !["hidden", "file"].includes(f(e).type) && visible(e));
  cache.key = () => JSON.stringify([performance.timeOrigin, location.href,
    fields().map((e) => [identity(e), shown(e), f(e).checked, f(e).selectedIndex, disabled(e)])]);
  cache.guard = (e: Element) => e.isConnected && visible(e)
    ? JSON.stringify([role(e), name(e), shown(e), state(e) ?? null, f(e).selectedIndex ?? null, disabled(e),
      e.getAttribute("aria-expanded"), e.getAttribute("href")])
    : null;

  // Autocomplete lists, found through the page's own ARIA links.
  const popups: { popup: Element; node: number }[] = [];
  for (const input of deep(document, "input,textarea")) {
    if (!visible(input)) continue;
    const owner = input.closest('[role="combobox"]');
    const ids = [input, owner].filter((e): e is Element => !!e)
      .flatMap((e) => `${e.getAttribute("aria-controls") || ""} ${e.getAttribute("aria-owns") || ""}`.trim().split(/\s+/));
    for (const id of new Set(ids)) {
      const popup = id && (input.getRootNode() as Document).getElementById?.(id);
      if (popup && visible(popup)) popups.push({ popup, node: identity(input) });
    }
  }
  const formatOf = (e: Element): string | undefined => {
    if (e.tagName === "INPUT" && f(e).type === "date") return "YYYY-MM-DD";
    const hint = `${e.getAttribute("placeholder") || ""} ${e.getAttribute("data-format") || ""} ${name(e)}`.toUpperCase()
      .replace(/JJ/g, "DD").replace(/AAAA/g, "YYYY").replace(/TT/g, "DD").replace(/JJJJ/g, "YYYY");
    return /\b(?:DD|MM|YYYY)[./-](?:DD|MM)[./-](?:YYYY|DD)\b/.exec(hint)?.[0];
  };
  const selector = "a[href],button,input,textarea,select,summary,[contenteditable=\"true\"]," +
    ROLES.map((r) => `[role="${r}"]`).join(",");
  const controls: FrameRead["controls"] = [];
  for (const e of new Set(deep(document, selector))) {
    const rname = role(e);
    if (!rname || !visible(e)) continue;
    // The inner input owns typing; the outer combobox is not a second field.
    if (rname === "combobox" && e.tagName !== "SELECT" && e.tagName !== "INPUT" && e.querySelector("input,textarea")) continue;
    const r = e.getBoundingClientRect();
    const offscreen = r.right < 0 || r.bottom < 0 || r.left >= innerWidth || r.top >= innerHeight;
    const form = f(e).form || e.closest("form");
    const typable = ["textbox", "searchbox", "spinbutton"].includes(rname) || (rname === "combobox" && e.tagName === "INPUT");
    const source = popups.find(({ popup }) => popup.contains(e));
    const dateFormat = typable ? formatOf(e) : undefined;
    controls.push({
      node: identity(e), role: rname, tag: e.tagName.toLowerCase(), type: e.tagName === "INPUT" ? f(e).type : "",
      label: name(e).slice(0, 200), name: e.getAttribute("name") || "", placeholder: e.getAttribute("placeholder") || "",
      section: section(e), value: shown(e).slice(0, 500),
      options: e.tagName === "SELECT"
        ? [...f(e).options].filter((o) => !o.disabled).map((o) => ({ value: o.value, label: o.label.trim(), selected: o.selected }))
        : undefined,
      checked: state(e), expanded: e.hasAttribute("aria-expanded") ? e.getAttribute("aria-expanded") === "true" : undefined,
      disabled: disabled(e), readOnly: !!f(e).readOnly || e.getAttribute("aria-readonly") === "true",
      required: !!f(e).required || e.getAttribute("aria-required") === "true",
      offscreen, form: form ? identity(form) : undefined,
      submit: !!f(e).form && (f(e).type === "submit" || f(e).type === "image"),
      dialog: !!e.closest('dialog,[role="dialog"],[aria-modal="true"],[role="listbox"],[role="menu"],[role="grid"]'),
      popupFor: source && ["option", "gridcell", "menuitem"].includes(rname) ? source.node : undefined,
      autocomplete: typable && (e.getAttribute("aria-autocomplete") === "list" || e.getAttribute("role") === "combobox" ||
        !!e.getAttribute("list")),
      picker: typable && (/^(dialog|grid)$/.test(e.getAttribute("aria-haspopup") || "") || e.hasAttribute("data-datepicker")),
      dateFormat, secret: secret(e), guard: cache.guard(e) || "",
    });
    if (controls.length >= 300) break;
  }

  const words: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let length = 0;
  for (let n = walker.nextNode(); n && length < 6000; n = walker.nextNode()) {
    const value = n.textContent?.trim() || "";
    const parent = n.parentElement;
    if (!value || !parent || parent.closest("script,style,noscript,template") || !visible(parent)) continue;
    words.push(value);
    length += value.length;
  }
  const headings = deep(document, "h1,h2").filter(visible).map((h) => h.textContent?.replace(/\s+/g, " ").trim() || "").filter(Boolean);
  const text = words.join("\n").slice(0, 6000);
  const captcha = deep(document, 'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"],' +
    ".g-recaptcha,.h-captcha,.cf-turnstile,[data-captcha]").length > 0 ||
    /\b(?:captcha|i['’]?m not a robot|verify (?:that )?you are (?:a )?human|are you a robot)\b/i.test(`${document.title}\n${text}`);
  return {
    url: location.href, title: document.title, text, headings, key: cache.key(), captcha,
    more: scrollY + innerHeight < document.documentElement.scrollHeight - 2, controls,
  };
}
