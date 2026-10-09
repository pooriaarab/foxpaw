// Acts on one control in its frame. Like readFrame, this function is sent as
// source by scripting.executeScript, so it uses nothing from module scope.
// Events made here have isTrusted false. Pages that listen for pointer, mouse,
// key, input and submit events respond. Anything that needs a real user
// gesture (popups, native pickers, file dialogs) does not open.
// Adapted from foxpilot's actuate.ts (MIT).
import type { ActRequest, ActResult } from "../types.js";

/** `expect` is what the snapshot saw: the control's guard and its frame's key. */
export async function perform(node: number, request: ActRequest, expect: { guard: string; key: string }): Promise<ActResult> {
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
  if ((op === "type" || op === "date") && (input.readOnly || e.getAttribute("aria-readonly") === "true")) return { ok: false, reason: "readonly" };
  if (op === "scroll") {
    scrollBy({ top: Number(value) || 560, behavior: "instant" });
    return { ok: true };
  }

  const r0 = e.getBoundingClientRect();
  if (r0.bottom < 0 || r0.right < 0 || r0.top >= innerHeight || r0.left >= innerWidth) {
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
  const up = (n: Element) => n.parentElement || (n.parentNode as ShadowRoot | null)?.host || null;
  let inside = false;
  for (let n: Element | null = hit; n; n = up(n)) if (n === e) inside = true;
  // A label that wraps a checkbox counts as the checkbox.
  if (!inside && !(hit && hit.closest("label") && (hit.closest("label") as HTMLLabelElement).control === e)) {
    return { ok: false, reason: "covered", detail: hit ? `${hit.tagName.toLowerCase()} is on top` : "nothing at its centre" };
  }

  if (request.mark !== false) {
    const ring = document.createElement("div");
    ring.style.cssText = `position:fixed;left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;` +
      "outline:3px solid #ff7139;border-radius:6px;pointer-events:none;z-index:2147483647";
    ring.dataset.foxpaw = "mark";
    document.documentElement.append(ring);
    setTimeout(() => ring.remove(), 600);
  }

  let submitted = false;
  const onSubmit = () => { submitted = true; };
  addEventListener("submit", onSubmit, true);
  try {
    const click = () => {
      const mouse = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, detail: 1 };
      const pointer = { ...mouse, pointerId: 1, pointerType: "mouse", isPrimary: true };
      const at = hit ?? e;
      const fire = (type: string, buttons: number) =>
        at.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, { ...pointer, buttons }) : new MouseEvent(type, { ...mouse, buttons }));
      fire("pointerover", 0); fire("mouseover", 0); fire("pointermove", 0); fire("mousemove", 0);
      // A cancelled pointerdown suppresses the mouse events after it, not the click.
      const mouseEvents = fire("pointerdown", 1);
      if (mouseEvents && fire("mousedown", 1)) e.focus({ preventScroll: true });
      fire("pointerup", 0);
      if (mouseEvents) fire("mouseup", 0);
      fire("click", 0);
    };
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

    if (op === "click") click();
    else if (op === "type") return { ok: true, value: typeText(value) };
    else if (op === "date") {
      if (input.type !== "date") return { ok: true, value: typeText(value) };
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(e, value);
      e.dispatchEvent(new Event("input", { bubbles: true }));
      e.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: input.value === value, value: input.value };
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
      const press = down && e.dispatchEvent(new KeyboardEvent("keypress", { ...init, charCode: 13 }));
      // HTML implicit submission, unless the page handled the key itself.
      const form = input.form;
      if (press && form && !submitted) {
        const button = [...form.elements].find((b): b is HTMLButtonElement => (b as HTMLButtonElement).type === "submit");
        if (button) { if (!button.disabled) button.click(); } else form.requestSubmit();
      }
      e.dispatchEvent(new KeyboardEvent("keyup", init));
    }
  } finally {
    removeEventListener("submit", onSubmit, true);
  }
  return { ok: true, submitted };
}
