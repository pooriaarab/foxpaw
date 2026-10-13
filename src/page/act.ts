// Acts on one control in its frame. Like readFrame, this function is sent as
// source by scripting.executeScript, so it uses nothing from module scope.
// Events made here have isTrusted false. Pages that listen for pointer, mouse,
// key, input and submit events respond. Anything that needs a real user
// gesture (popups, native pickers, file dialogs) does not open.
// Adapted from foxpilot's actuate.ts (MIT).
import type { ActRequest, ActResult } from "../types.js";

/** `expect` is what the snapshot saw: the control's guard, its frame's key and where it sends. */
export async function perform(node: number, request: ActRequest, expect: { guard: string; key: string; to?: string }): Promise<ActResult> {
  const cache = window.__foxpaw;
  const e = cache?.nodes.get(node) as HTMLElement | undefined;
  if (!cache || !e?.isConnected) return { ok: false, reason: "gone" };
  // The stale check: the control and the frame must be as the decision saw them.
  const now = cache.guard(e);
  if (now === null) return { ok: false, reason: "hidden" };
  if (now !== expect.guard) return { ok: false, reason: "stale", detail: "the control changed" };
  if (cache.key() !== expect.key) return { ok: false, reason: "stale", detail: "the page changed" };
  if (e.matches(":disabled") || e.closest('[aria-disabled="true"]')) return { ok: false, reason: "disabled" };

  const input = e as HTMLInputElement;
  const { op, value = "" } = request;
  // Dates and times in the common forms, for native fields (P19) and calendars (P20).
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const p2 = (n: number) => String(n).padStart(2, "0");
  const monthNo = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
  const toIso = (text: string): string | null => {
    const t = text.trim().replace(/\s+/g, " ");
    let m: RegExpExecArray | null;
    let ymd: number[] | null = null;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) ymd = [+m[1]!, +m[2]!, +m[3]!];
    else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) ymd = [+m[3]!, +m[1]!, +m[2]!];
    else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t))) ymd = [+m[3]!, +m[2]!, +m[1]!];
    else if ((m = /^(?:[a-z]+,? )?([a-z]{3,})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/i.exec(t)) && monthNo(m[1]!)) ymd = [+m[3]!, monthNo(m[1]!), +m[2]!];
    else if ((m = /^(?:[a-z]+,? )?(\d{1,2}) ([a-z]{3,})\.?,? (\d{4})$/i.exec(t)) && monthNo(m[2]!)) ymd = [+m[3]!, monthNo(m[2]!), +m[1]!];
    if (!ymd) return null;
    const [y, mo, d] = ymd as [number, number, number];
    const day = new Date(Date.UTC(y, mo - 1, d));
    return day.getUTCMonth() === mo - 1 && day.getUTCDate() === d ? `${y}-${p2(mo)}-${p2(d)}` : null;
  };
  const toTime = (text: string): string | null => {
    const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])?\.?\s?(?:m\.?)?$/i.exec(text.trim());
    if (!m || (m[2] === undefined && !m[3])) return null;
    let h = +m[1]!;
    const min = +(m[2] ?? 0);
    if (m[3]) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
    }
    return h > 23 || min > 59 ? null : `${p2(h)}:${p2(min)}`;
  };
  const NATIVE: Record<string, [(text: string) => string | null, string]> = {
    date: [toIso, "2019-11-08"],
    time: [toTime, "10:57"],
    month: [(t) => (/^\d{4}-\d{2}$/.test(t.trim()) ? t.trim() : toIso(t)?.slice(0, 7) ?? toIso(`1 ${t}`)?.slice(0, 7) ?? null), "2019-11"],
    "datetime-local": [(t) => {
      const m = /^(.*?\d{4}|\d{4}-\d{2}-\d{2})(?:T|,? )(.+)$/.exec(t.trim());
      const d = m && toIso(m[1]!), h = m && toTime(m[2]!);
      return d && h ? `${d}T${h}` : null;
    }, "2019-11-08T10:57"],
  };
  const native = e instanceof HTMLInputElement && Object.hasOwn(NATIVE, input.type) ? NATIVE[input.type] : undefined;
  const readOnly = input.readOnly || e.getAttribute("aria-readonly") === "true";
  // A read-only field that gets a date: a person opens its calendar and presses the day (P20).
  const calendarDay = readOnly && !native && (op === "date" || op === "type") ? toIso(value) : null;
  if ((op === "type" || op === "date") && readOnly && !calendarDay) return { ok: false, reason: "readonly" };
  // A fill op sets only a control it may set; it never clicks a button, a link, a menu item or clickable text,
  // whose script could send with form.submit(), which fires no submit event (C35). Those go through click.
  const role = e.getAttribute("role") || "";
  const box = e instanceof HTMLInputElement && (input.type === "checkbox" || input.type === "radio");
  const settable =
    op === "check" || op === "uncheck" ? box || /^(checkbox|radio|switch|menuitemcheckbox|menuitemradio)$/.test(role)
    : op === "select" ? e.tagName === "SELECT" || ((e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) && (role === "combobox" || e.getAttribute("aria-autocomplete") === "list"))
      || (role === "option" && !!e.closest('[role="listbox"]')) || (role === "gridcell" && !!e.closest('[role="grid"],[role="treegrid"]'))
    : op === "type" || op === "date" ? e instanceof HTMLTextAreaElement || e.isContentEditable
      || (e instanceof HTMLInputElement && !["button", "submit", "reset", "image", "checkbox", "radio", "file", "hidden", "range", "color"].includes(input.type))
    : true;
  if (!settable) return { ok: false, reason: "unsupported", detail: `${op} does not set this control; use click, which asks for approval` };
  if (op === "scroll") {
    // A number scrolls the page; no value brings the control into view (P17).
    if (value.trim() && Number.isFinite(Number(value))) scrollBy({ top: Number(value), behavior: "instant" });
    else e.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    return { ok: true };
  }

  const up = (n: Element) => n.parentElement || (n.parentNode as ShadowRoot | null)?.host || null;
  // Only click and Enter may send a form or open a page: they carry the
  // approval. Every other op fills, so it refuses a control that sends (C34).
  const fills = op !== "click" && op !== "enter";
  const here = location.href.split("#")[0];
  const sends = (start: Element | null) => {
    for (let n = start; n; n = up(n)) {
      if (n instanceof HTMLButtonElement && n.type === "submit" && n.form) return true;
      if (n instanceof HTMLInputElement && (n.type === "submit" || n.type === "image") && n.form) return true;
      if ((n instanceof HTMLAnchorElement || n instanceof HTMLAreaElement) && n.hasAttribute("href") &&
        n.protocol !== "javascript:" && n.href.split("#")[0] !== here) return true;
    }
    return false;
  };
  const sendsRefused: ActResult = { ok: false, reason: "submit", detail: "this control sends a form or opens a page: use click, which asks for approval" };
  if (fills && sends(e)) return sendsRefused;

  // The hit-test is at the centre, so the centre must be on the screen (P13).
  const r0 = e.getBoundingClientRect();
  const cx = r0.x + r0.width / 2, cy = r0.y + r0.height / 2;
  if (cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) {
    e.scrollIntoView({ block: "center", inline: "center" });
    await new Promise((done) => setTimeout(done, 50));
  }
  const r = e.getBoundingClientRect();
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  // The control must be the top element at its centre, or hold it.
  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  let inside = false;
  for (let n: Element | null = hit; n; n = up(n)) if (n === e) inside = true;
  // A label that wraps a checkbox counts as the checkbox.
  if (!inside && !(hit && hit.closest("label") && (hit.closest("label") as HTMLLabelElement).control === e)) {
    return { ok: false, reason: "covered", detail: hit ? `${hit.tagName.toLowerCase()} is on top` : "nothing at its centre" };
  }
  // The click goes to the element at the centre: a link inside an option sends too.
  if (fills && sends(hit)) return sendsRefused;

  if (request.mark !== false) {
    const ring = document.createElement("div");
    ring.style.cssText = `position:fixed;left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;` +
      "outline:3px solid #ff7139;border-radius:6px;pointer-events:none;z-index:2147483647";
    ring.dataset.foxpaw = "mark";
    document.documentElement.append(ring);
    setTimeout(() => ring.remove(), 600);
  }

  // A page script can move the form's destination as the send happens (C25):
  // read it again before the click or Enter, and on submit, first and last.
  // A click can redraw the control itself (a calendar's "Next month"). A
  // control that left the page sends nothing, so its form's destination is
  // read from the form it was in (P14).
  const form0 = input.form || e.closest("form");
  const moved = () => expect.to !== undefined && cache.to(e.isConnected || !form0 ? e : form0) !== expect.to;
  const refused: ActResult = { ok: false, reason: "destination", detail: "the form's destination changed as foxpaw sent it" };
  let submitted = false;
  let changed = false;
  let blocked = false;
  const onSubmit = (event: Event) => {
    // A page script that sends the form on a fill's click (C34).
    if (fills) {
      blocked = true;
      event.preventDefault();
      return;
    }
    submitted = true;
    if (!moved()) return;
    changed = true;
    event.preventDefault();
  };
  addEventListener("submit", onSubmit, true);
  addEventListener("submit", onSubmit);
  // A click or Enter sends with the page's real functions; a fill op replaces them in the page world, so a
  // control's own handler cannot send with form.submit(), requestSubmit() or a link's click() (C36).
  if (cache.nav) {
    clearTimeout(cache.nav.timer);
    cache.nav.restore();
    cache.nav = undefined;
  }
  type Proto = Record<string, unknown>;
  const pageWorld = (window as unknown as { wrappedJSObject?: { HTMLFormElement: { prototype: Proto }; HTMLAnchorElement: { prototype: Proto } } }).wrappedJSObject;
  const exportFn = (globalThis as unknown as { exportFunction?: (fn: () => void, target: object) => unknown }).exportFunction;
  // The submit listener of a fill op stays with the stand-ins, so a deferred click on a submit button is cancelled too (C37).
  const unlisten = () => {
    removeEventListener("submit", onSubmit, true);
    removeEventListener("submit", onSubmit);
  };
  if (fills) {
    let put = () => {};
    if (pageWorld && exportFn) {
      const form = pageWorld.HTMLFormElement.prototype, link = pageWorld.HTMLAnchorElement.prototype;
      const saved = { submit: form.submit, requestSubmit: form.requestSubmit, click: link.click };
      const standIn = exportFn(() => { blocked = true; }, window);
      form.submit = standIn; form.requestSubmit = standIn; link.click = standIn;
      put = () => { form.submit = saved.submit; form.requestSubmit = saved.requestSubmit; link.click = saved.click; };
    }
    cache.nav = { restore: () => { put(); unlisten(); } };
  }
  try {
    // A press at a point: pointer and mouse down and up, then a click unless `withClick` is false.
    const press = (at: Element, px: number, py: number, withClick = true) => {
      const mouse = { bubbles: true, cancelable: true, composed: true, view: window, clientX: px, clientY: py, button: 0, detail: 1 };
      const pointer = { ...mouse, pointerId: 1, pointerType: "mouse", isPrimary: true };
      const fire = (type: string, buttons: number) =>
        at.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, { ...pointer, buttons }) : new MouseEvent(type, { ...mouse, buttons }));
      fire("pointerover", 0); fire("mouseover", 0); fire("pointermove", 0); fire("mousemove", 0);
      // A cancelled pointerdown suppresses the mouse events after it, not the click.
      const mouseEvents = fire("pointerdown", 1);
      if (mouseEvents && fire("mousedown", 1) && (at === e || at === hit)) e.focus({ preventScroll: true });
      fire("pointerup", 0);
      if (mouseEvents) fire("mouseup", 0);
      if (moved()) return false;
      if (withClick) fire("click", 0);
      return true;
    };
    // A fill presses the control itself, never what lies over it, even inside its label (C36).
    const click = () => press(fills ? e : (hit ?? e), x, y);
    const shownNow = (n: Element) => n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    // The popups on the page that a field can open: a calendar, a suggestion list, a menu.
    const popups = () => [...document.querySelectorAll('dialog[open],[role="dialog"],[role="grid"],[role="listbox"],[role="menu"]')]
      .filter((p) => !p.contains(e) && shownNow(p));
    // Replace the text like typing does. insertText fires beforeinput and
    // input, which React and editors listen for. When it does nothing, the
    // native setter goes past React's value tracker, and input still fires.
    const typeText = (text: string) => {
      click();
      e.focus({ preventScroll: true });
      const plain = e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement;
      const read = () => (plain ? (e as HTMLInputElement).value : e.textContent ?? "");
      if (plain) (e as HTMLInputElement).select();
      else getSelection()?.selectAllChildren(e);
      const done = document.execCommand(text ? "insertText" : "delete", false, text);
      if (!done || read() !== text) {
        if (plain) {
          const proto = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(e, text);
        } else e.textContent = text;
        e.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
      }
      e.dispatchEvent(new Event("change", { bubbles: true }));
      return read();
    };

    // The visible calendars on the page: a popup with 28 or more day numbers, the outermost one.
    const dayText = (n: Element) => (n.textContent || "").replace(/\s+/g, " ").trim();
    const dayCells = (cal: Element) => {
      const cells = [...cal.querySelectorAll('button,a,td,[role="gridcell"],[role="button"]')].filter((c) => /^\d{1,2}$/.test(dayText(c)) && shownNow(c));
      return cells.filter((c) => !cells.some((o) => o !== c && c.contains(o)));
    };
    const calendars = () => {
      const all = [...document.querySelectorAll('[role="dialog"],[role="grid"],.ui-datepicker,[class*="datepicker" i],[class*="calendar" i]')]
        .filter((p) => !p.contains(e) && shownNow(p) && dayCells(p).length >= 28);
      return all.filter((p) => !all.some((o) => o !== p && o.contains(p)));
    };
    const pickDay = async (iso: string): Promise<ActResult> => {
      const [ty, tm, td] = iso.split("-").map(Number) as [number, number, number];
      const before = new Set(calendars());
      click();
      await new Promise((done) => setTimeout(done, 150));
      let cal = calendars().find((c) => !before.has(c)) ?? calendars()[0];
      if (!cal) return { ok: false, reason: "readonly", detail: "the field is read-only and opened no calendar" };
      const badSel = '[aria-disabled="true"],.ui-state-disabled,[class*="other-month" i],[class*="outside" i],[class*="disabled" i]';
      const good = (c: Element, within: Element) => !c.matches(":disabled") && !(c.closest(badSel) && within.contains(c.closest(badSel)));
      const NAMES = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{4})\b/i;
      const monthOf = (within: Element) => {
        const m = NAMES.exec(within.textContent || "");
        if (m) return { y: +m[2]!, m: monthNo(m[1]!) };
        const holder = within.querySelector("[data-month][data-year]");
        return holder ? { y: Number(holder.getAttribute("data-year")), m: Number(holder.getAttribute("data-month")) + 1 } : null;
      };
      const dayIn = (within: Element): Element | undefined => {
        const cells = dayCells(within).filter((c) => good(c, within));
        const tagged = cells.find((c) => (c.closest("[data-date]")?.getAttribute("data-date") ?? "").slice(0, 10) === iso);
        if (tagged) return tagged;
        const labelled = cells.find((c) => { const l = c.getAttribute("aria-label") || c.closest("[aria-label]")?.getAttribute("aria-label") || ""; return toIso(l) === iso; });
        if (labelled) return labelled;
        const own = cells.filter((c) => { const h = c.closest("[data-month][data-year]"); return h && within.contains(h) && Number(h.getAttribute("data-year")) === ty && Number(h.getAttribute("data-month")) === tm - 1 && Number(dayText(c)) === td; });
        if (own.length === 1) return own[0];
        const shown = monthOf(within);
        const byNumber = shown && shown.y === ty && shown.m === tm ? cells.filter((c) => Number(dayText(c)) === td) : [];
        return byNumber.length === 1 ? byNumber[0] : undefined;
      };
      const pressOn = (n: Element) => { const b = n.getBoundingClientRect(); press(n, b.x + b.width / 2, b.y + b.height / 2); };
      for (let turn = 0; turn <= 24; turn++) {
        if (!cal.isConnected || !shownNow(cal)) cal = calendars()[0];
        if (!cal) return { ok: false, reason: "readonly", detail: "the calendar closed" };
        const day = dayIn(cal);
        if (day) {
          // A day that sends a form or opens a page needs a click and its approval (C34).
          if (sends(day)) return sendsRefused;
          pressOn(day);
          await new Promise((done) => setTimeout(done, 100));
          if (blocked) return sendsRefused;
          return input.value ? { ok: true, value: input.value } : { ok: false, reason: "readonly", detail: "the calendar day did not fill the field" };
        }
        const shown = monthOf(cal);
        if (!shown) return { ok: false, reason: "readonly", detail: "the calendar shows no month" };
        const ahead = ty * 12 + tm - (shown.y * 12 + shown.m);
        if (ahead === 0) return { ok: false, reason: "readonly", detail: `the calendar has no day ${iso}` };
        const way = ahead > 0 ? /\bnext\b|›|»|→/i : /\bprev(?:ious)?\b|‹|«|←/i;
        const step = [...cal.querySelectorAll('button,a,[role="button"],[data-handler]')].filter(shownNow)
          .find((b) => way.test(`${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""} ${dayText(b)} ${b.getAttribute("data-handler") || ""} ${b.getAttribute("class") || ""}`));
        if (!step) return { ok: false, reason: "readonly", detail: "the calendar has no next or previous month button" };
        if (sends(step)) return sendsRefused;
        pressOn(step);
        await new Promise((done) => setTimeout(done, 80));
      }
      return { ok: false, reason: "readonly", detail: `the calendar never showed ${iso}` };
    };

    if (calendarDay) return await pickDay(calendarDay);
    if (native && (op === "type" || op === "date")) {
      // A native date or time field takes only its own form (P19).
      const [convert, example] = native;
      const want = value.trim() ? convert(value) : "";
      if (want === null) return { ok: false, reason: "unsupported", detail: `a ${input.type} field takes a value such as ${example}` };
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(e, want);
      e.dispatchEvent(new Event("input", { bubbles: true }));
      e.dispatchEvent(new Event("change", { bubbles: true }));
      if (blocked) return sendsRefused;
      return input.value === want ? { ok: true, value: input.value } : { ok: false, reason: "unsupported", detail: `the field did not take ${want}` };
    }
    if (op === "click") {
      if (!click()) return refused;
    } else if (op === "type") {
      const typed = typeText(value);
      return blocked ? sendsRefused : { ok: true, value: typed };
    }
    else if (op === "date") {
      // A person closes the calendar the field opened: Escape, then a press outside (P16).
      const before = new Set(popups());
      const typed = typeText(value);
      await new Promise((done) => setTimeout(done, 100));
      const opened = () => popups().filter((p) => !before.has(p));
      if (opened().length) {
        const key = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true };
        e.dispatchEvent(new KeyboardEvent("keydown", key));
        e.dispatchEvent(new KeyboardEvent("keyup", key));
      }
      if (opened().length) press(document.body, 1, 1, false);
      return blocked ? sendsRefused : { ok: true, value: typed };
    } else if (op === "select" && /^(option|gridcell)$/.test(role)) {
      if (!click()) return refused;
    } else if (op === "select" && e.tagName !== "SELECT" && (e.getAttribute("role") === "combobox" || e.getAttribute("aria-autocomplete") === "list") &&
      (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement)) {
      // An autocomplete field: type the value, then pick the one suggestion that holds it (P15).
      const want = value.trim().toLowerCase();
      const owner = e.parentElement?.closest('[role="combobox"]');
      const ids = [...new Set([e, owner].filter((n): n is Element => !!n).flatMap((n) => `${n.getAttribute("aria-controls") || ""} ${n.getAttribute("aria-owns") || ""}`.trim().split(/\s+/)).filter(Boolean))];
      const options = () => ids.map((id) => (e.getRootNode() as Document).getElementById?.(id)).filter((l): l is HTMLElement => !!l)
        .flatMap((l) => [...l.querySelectorAll('[role="option"]')]).filter((o) => shownNow(o) && !o.closest('[aria-disabled="true"]'));
      const text = (o: Element) => (o.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      const bracket = /\(([^)]+)\)/.exec(value)?.[1]?.trim();
      const before = value.replace(/\([^)]*\)/, "").trim();
      // A name and a code in other words: the code in brackets and each word before it (P18).
      const code = bracket ? `(${bracket.toLowerCase()})` : "";
      const names = before.toLowerCase().split(/\s+/).filter(Boolean);
      const holding = () => {
        const all = options().filter((o) => text(o).includes(want));
        const exact = all.filter((o) => text(o) === want);
        if (all.length || !code) return all.length > 1 && exact.length === 1 ? exact : all;
        return options().filter((o) => text(o).includes(code) && names.every((w) => text(o).includes(w)));
      };
      // A list that is open already; else the whole value, then the part in brackets, then the words before it.
      let fits = holding();
      for (const query of [value, ...(bracket ? [bracket] : []), ...(before && before !== value.trim() ? [before] : [])]) {
        if (fits.length === 1) break;
        typeText(query);
        for (let waited = 0; waited <= 1000; waited += 50) {
          fits = holding();
          if (fits.length === 1 || (waited >= 300 && !options().length)) break;
          await new Promise((done) => setTimeout(done, 50));
        }
      }
      if (fits.length !== 1) return { ok: false, reason: "unsupported", detail: `${fits.length} suggestions hold the value` };
      const o = fits[0]!;
      if (sends(o)) return sendsRefused;
      o.scrollIntoView({ block: "nearest" });
      const ro = o.getBoundingClientRect();
      if (!press(o, ro.x + ro.width / 2, ro.y + ro.height / 2)) return refused;
      if (blocked) return sendsRefused;
      return { ok: true, value: (e as HTMLInputElement).value };
    } else if (op === "select") {
      const select = e as unknown as HTMLSelectElement;
      if (e.tagName !== "SELECT" || ![...select.options].some((o) => o.value === value && !o.disabled)) return { ok: false, reason: "unsupported", detail: "no such option" };
      select.value = value;
      e.dispatchEvent(new Event("input", { bubbles: true }));
      e.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (op === "check" || op === "uncheck") {
      const on = () => (input.type === "checkbox" || input.type === "radio" ? input.checked : e.getAttribute("aria-checked") === "true" ||
        e.getAttribute("aria-pressed") === "true" || e.getAttribute("aria-selected") === "true");
      if (on() !== (op === "check")) click();
      if (blocked) return sendsRefused;
      if (on() !== (op === "check")) return { ok: false, reason: "unsupported", detail: "the state did not change" };
    } else if (op === "enter") {
      // Enter would press the form's first submit button. A hidden one is not
      // what a person sees, and its label was never checked: refuse.
      const first = input.form && [...input.form.elements].find((b) => (b as HTMLButtonElement).type === "submit");
      if (first && !first.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
        return { ok: false, reason: "hidden", detail: "the form's submit button is hidden" };
      }
      e.focus({ preventScroll: true });
      const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
      const down = e.dispatchEvent(new KeyboardEvent("keydown", init));
      const pressed = down && e.dispatchEvent(new KeyboardEvent("keypress", { ...init, charCode: 13 }));
      // HTML implicit submission, unless the page handled the key itself.
      const form = input.form;
      if (moved()) return refused;
      if (pressed && form && !submitted) {
        const button = [...form.elements].find((b): b is HTMLButtonElement => (b as HTMLButtonElement).type === "submit");
        if (button) { if (!button.disabled) button.click(); } else form.requestSubmit();
      }
      e.dispatchEvent(new KeyboardEvent("keyup", init));
    }
    if (blocked) return sendsRefused;
    // Last resort: a script that ran after both checks. Stop the navigation.
    if (changed || moved()) {
      stop();
      return refused;
    }
  } finally {
    if (!fills) unlisten();
    // A fill's stand-ins and submit listener stay a second for a send deferred by a timer; a click or Enter removes them first.
    const nav = cache.nav;
    if (nav) nav.timer = setTimeout(() => { nav.restore(); if (cache.nav === nav) cache.nav = undefined; }, 1000);
  }
  return { ok: true, submitted };
}
