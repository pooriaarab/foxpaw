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
    offscreen: boolean; form?: number; submit: boolean; action?: string; firstAction?: string; dialog: boolean; popupFor?: number;
    autocomplete: boolean; picker: boolean; dateFormat?: string; secret: boolean; guard: string;
    href?: string; row?: string; near?: string; list?: boolean;
  }[];
}

/** The page cache that `readFrame` sets up and `perform` (act.ts) uses. */
export interface PageCache {
  ids: WeakMap<Element, number>;
  nodes: Map<number, Element>;
  next: number;
  guard(e: Element): string | null;
  key(): string;
  /** Where a click on the control, or Enter in it, sends its form (C25, C26). */
  to(e: Element): string | null;
  /** Each control's destination when foxpaw first read it (C25). */
  first?: WeakMap<Element, string | null>;
  /** The page's own submit, requestSubmit and link click, replaced during a fill op and put back after (C36). */
  nav?: { restore(): void; timer?: ReturnType<typeof setTimeout> };
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
  const selector = "a[href],button,input,textarea,select,summary,[contenteditable=\"true\"]," +
    ROLES.map((r) => `[role="${r}"]`).join(",");
  const role = (e: Element): string | null => {
    const explicit = e.getAttribute("role");
    if (explicit && ROLES.includes(explicit)) return explicit;
    if (e.tagName === "BUTTON" || e.tagName === "SUMMARY") return "button";
    if (e.tagName === "A") return "link";
    if (e.tagName === "SELECT") return "combobox";
    if (e.tagName === "TEXTAREA" || (e as HTMLElement).isContentEditable) return "textbox";
    if (e.tagName !== "INPUT") return clickable(e) ? "button" : null;
    const type = f(e).type;
    if (type === "checkbox" || type === "radio") return type;
    if (["button", "submit", "reset", "image"].includes(type)) return "button";
    if (type === "search") return "searchbox";
    if (type === "number") return "spinbutton";
    if (["hidden", "file", "range", "color"].includes(type)) return null;
    return "textbox";
  };
  // Text a script makes clickable (P21): its own short text, a pointer cursor, no control in or around it.
  const pointerBody = getComputedStyle(document.body).cursor === "pointer";
  const ownText = (e: Element) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
  // Same-origin `:hover` rules that show a pointer, without the `:hover` (P23). A cross-origin sheet throws and is skipped.
  const hoverPointers: string[] = [];
  const hoverRules = (rules: CSSRuleList, depth: number) => {
    for (const rule of rules) {
      if (hoverPointers.length >= 200) return;
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested && depth < 3) hoverRules(nested, depth + 1);
      const style = rule as CSSStyleRule;
      if (!style.selectorText?.includes(":hover") || style.style?.cursor !== "pointer") continue;
      for (const part of style.selectorText.split(",")) {
        const base = part.includes(":hover") ? part.replace(/:hover/g, "").trim() : "";
        try {
          if (base) { document.querySelector(base); hoverPointers.push(base); }
        } catch { /* not a selector without :hover */ }
      }
    }
  };
  if (!pointerBody) for (const sheet of document.styleSheets) {
    try { hoverRules(sheet.cssRules, 0); } catch { /* cross-origin */ }
  }
  // The elements those rules match, found once per read: a matches() per element and rule is too slow on a big page.
  const hovered = new Set<Element>();
  for (const s of hoverPointers) for (const e of document.querySelectorAll(s)) if (hovered.size < 5000) hovered.add(e);
  const pointer = (e: Element) => getComputedStyle(e).cursor === "pointer" || hovered.has(e) || (!!e.parentElement && hovered.has(e.parentElement));
  // An icon a script makes clickable (P23): no text, an image, a small box, a pointer, and a name.
  const GENERIC = new Set(["icon", "icons", "ico", "btn", "button", "fa", "fas", "far", "fab", "fal", "glyphicon", "material", "symbols",
    "outlined", "svg", "img", "image", "pull", "right", "left", "float", "active", "hover", "small", "large", "sm", "lg", "md", "xs", "js", "ui",
    "item", "el", "wrap", "wrapper", "inner", "outer", "control", "controls", "action", "actions", "link", "span", "div", "is", "has"]);
  const iconName = (e: Element): string => {
    const own = e.getAttribute("aria-label") || e.getAttribute("title") || e.getAttribute("alt");
    if (own?.trim()) return own.trim();
    const inner = e.querySelector("img[alt],svg title,[aria-label],[title]");
    const named = inner && (inner.tagName.toLowerCase() === "title" ? inner.textContent : inner.getAttribute("alt") || inner.getAttribute("aria-label") || inner.getAttribute("title"));
    if (named?.trim()) return named.trim();
    const words = `${e.id} ${e.getAttribute("class") || ""}`.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_-]+/)
      .filter((w) => /^[a-z]{2,15}$/.test(w) && !GENERIC.has(w));
    return [...new Set(words)].slice(0, 4).join(" ");
  };
  const picture = (e: Element) => {
    if (e.tagName === "IMG" || e.querySelector("img,svg")) return true;
    const style = getComputedStyle(e);
    return /url\(/.test(style.content) || /url\(/.test(style.backgroundImage) || !/^(none|normal|)$/.test(getComputedStyle(e, "::before").content);
  };
  const icon = (e: Element): boolean => {
    if (pointerBody || !(e instanceof HTMLElement) || /^(BODY|HTML|LABEL|INPUT|OPTION|SELECT|TEXTAREA|BUTTON|A)$/.test(e.tagName)) return false;
    if ((e.textContent || "").trim() || e.childElementCount > 3) return false;
    const r = e.getBoundingClientRect();
    if (r.width > 96 || r.height > 96 || !picture(e) || !pointer(e)) return false;
    return !e.querySelector(selector) && !e.parentElement?.closest(`${selector},label`) && !!iconName(e);
  };
  const clickable = (e: Element): boolean => {
    if (pointerBody || !(e instanceof HTMLElement) || /^(BODY|HTML|LABEL|INPUT|OPTION)$/.test(e.tagName)) return false;
    const text = ownText(e);
    if (!text) return icon(e);
    if (text.length > 80 || !pointer(e)) return false;
    return !e.querySelector(selector) && !e.parentElement?.closest(`${selector},label`);
  };
  // A list item that holds its own child list: the control at its top opens and closes that list (P22).
  const disclosure = (e: Element): boolean | undefined => {
    const item = e.parentElement;
    if (!item?.matches('li,[role="treeitem"]')) return undefined;
    const list = [...item.children].find((c) => c !== e && c.matches('ul,ol,[role="group"]'));
    if (!list?.childElementCount) return undefined;
    return list.checkVisibility({ checkVisibilityCSS: true });
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
  // The row, list item or card around a control. A keyless list reuses its
  // nodes, so the same "Archive" button can move to another row's text.
  const rowHash = (e: Element): string => {
    const row = e.closest('li,tr,dd,article,[role="row"],[role="listitem"],[role="option"],[role="article"]');
    const text = (row?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 2000);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
    return (hash >>> 0).toString(36);
  };
  const context = (e: Element): string => `${section(e)}|${rowHash(e)}`;
  const inRow = (e: Element) => !!e.closest('li,tr,dd,article,[role="row"],[role="listitem"],[role="option"],[role="article"]');
  // Where a control sends (C22, C26): a submit button's formaction, else the
  // first submit button's (what Enter presses), else the form's action. The
  // prototype getters, because a field named "action" shadows form.action.
  const formGet = (k: string) => Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, k)!.get!;
  const submits = (e: Element) => !!f(e).form && (f(e).type === "submit" || f(e).type === "image");
  cache.to = (e: Element) => {
    const form = (f(e).form || e.closest("form")) as HTMLFormElement | null;
    if (!form) return null;
    const button = submits(e) ? e : [...(formGet("elements").call(form) as HTMLFormControlsCollection)].find(submits);
    const own = button?.getAttribute("formaction");
    try {
      return own ? new URL(own, document.baseURI).href : String(formGet("action").call(form));
    } catch {
      return "";
    }
  };
  cache.guard = (e: Element) => e.isConnected && visible(e)
    ? JSON.stringify([role(e), name(e), shown(e), state(e) ?? null, f(e).selectedIndex ?? null, disabled(e),
      e.getAttribute("aria-expanded"), e.getAttribute("href"), context(e), cache.to(e)])
    : null;
  const first = (cache.first ||= new WeakMap());

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
  const controls: FrameRead["controls"] = [];
  const read: Element[] = [];
  // Clickable text joins the controls in page order; a page with none reads as before (P21).
  const clicks: Element[] = [];
  const looked = new Set<Element>();
  const texts = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = pointerBody ? null : texts.nextNode(), seen = 0; n && seen < 5000 && clicks.length < 60; n = texts.nextNode(), seen++) {
    const parent = n.parentElement;
    if (!parent || looked.has(parent) || !n.textContent?.trim()) continue;
    looked.add(parent);
    if (!parent.matches(selector) && clickable(parent) && visible(parent)) clicks.push(parent);
  }
  // Icons have no text node: look at the elements with no text (P23).
  if (!pointerBody) {
    let seen = 0;
    for (const e of document.body.querySelectorAll("*")) {
      if (clicks.length >= 60 || seen >= 4000) break;
      seen++;
      if (e.childElementCount > 3 || e.matches(selector) || (e.textContent || "").trim() || e.closest("script,style,noscript,template,svg")) continue;
      if (icon(e) && visible(e)) clicks.push(e);
    }
  }
  const inOrder = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  const found = clicks.length ? [...new Set([...deep(document, selector), ...clicks])].toSorted(inOrder) : [...new Set(deep(document, selector))];
  for (const e of found) {
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
    const to = cache.to(e);
    if (!first.has(e)) first.set(e, to);
    controls.push({
      node: identity(e), role: rname, tag: e.tagName.toLowerCase(), type: e.tagName === "INPUT" ? f(e).type : "",
      label: (name(e) || (icon(e) ? iconName(e) : "")).slice(0, 200), name: e.getAttribute("name") || "", placeholder: e.getAttribute("placeholder") || "",
      section: section(e), value: shown(e).slice(0, 500),
      options: e.tagName === "SELECT"
        ? [...f(e).options].filter((o) => !o.disabled).map((o) => ({ value: o.value, label: o.label.trim(), selected: o.selected }))
        : undefined,
      checked: state(e), expanded: e.hasAttribute("aria-expanded") ? e.getAttribute("aria-expanded") === "true" : disclosure(e),
      ...(!e.hasAttribute("aria-expanded") && disclosure(e) !== undefined ? { list: true } : {}),
      disabled: disabled(e), readOnly: !!f(e).readOnly || e.getAttribute("aria-readonly") === "true",
      required: !!f(e).required || e.getAttribute("aria-required") === "true",
      offscreen, form: form ? identity(form) : undefined,
      submit: !!f(e).form && (f(e).type === "submit" || f(e).type === "image"),
      ...(to === null ? {} : { action: to }), ...(first.get(e) === to ? {} : { firstAction: String(first.get(e)) }),
      dialog: !!e.closest('dialog,[role="dialog"],[aria-modal="true"],[role="listbox"],[role="menu"],[role="grid"]'),
      popupFor: source && ["option", "gridcell", "menuitem"].includes(rname) ? source.node : undefined,
      autocomplete: typable && (e.getAttribute("aria-autocomplete") === "list" || e.getAttribute("role") === "combobox" ||
        !!e.getAttribute("list")),
      picker: typable && (/^(dialog|grid)$/.test(e.getAttribute("aria-haspopup") || "") || e.hasAttribute("data-datepicker")),
      dateFormat, secret: secret(e), guard: cache.guard(e) || "",
      ...(rname === "link" && e.getAttribute("href") ? { href: e.getAttribute("href")! } : {}),
      ...(inRow(e) ? { row: rowHash(e) } : {}),
    });
    read.push(e);
    if (controls.length >= 300) break;
  }
  // Controls that share one name carry the first line of their card's text, when the cards differ (P24).
  const byLabel = new Map<string, number[]>();
  const FIELD_ROLES = new Set(["textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "spinbutton"]);
  controls.forEach((c, i) => { if (c.label && c.role !== "link" && !FIELD_ROLES.has(c.role)) byLabel.set(c.label, [...(byLabel.get(c.label) ?? []), i]); });
  const near = (e: Element, label: string): string => {
    for (let p = e.parentElement, depth = 0; p && p !== document.body && depth < 6; p = p.parentElement, depth++) {
      const line = (p as HTMLElement).innerText?.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).find((l) => l && l !== label);
      if (line) return line.slice(0, 40);
    }
    return "";
  };
  for (const [label, at] of byLabel) {
    if (at.length < 2 || at.length > 20) continue;
    const cards = at.map((i) => near(read[i]!, label));
    if (new Set(cards).size < 2) continue;
    at.forEach((i, k) => { if (cards[k]) controls[i]!.near = cards[k]; });
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
