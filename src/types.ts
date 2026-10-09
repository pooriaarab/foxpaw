// The shapes foxpaw passes around. A Control is one thing on the page a
// person can use. A Snapshot is every control in every frame of a tab.

/** One option of a `<select>`. */
export interface SelectOption { value: string; label: string; selected: boolean }

/** One control on the page, as `snapshot` reads it. */
export interface Control {
  /** `<frameId>:<node>`. Stable while the element stays in the page. */
  id: string;
  frameId: number;
  /** The element's number in its frame. */
  node: number;
  /** The ARIA role, or the role the tag implies: textbox, button, link, checkbox, combobox... */
  role: string;
  /** Lower-case tag name. */
  tag: string;
  /** The input type, or "" for other tags. */
  type: string;
  /** The accessible name: aria-labelledby, aria-label, `<label>`, text, title, placeholder. */
  label: string;
  /** The `name` attribute. */
  name: string; placeholder: string;
  /** The named region or form the control is in. */
  section: string;
  /** The current text value. A password shows as "•••". */
  value: string;
  options?: SelectOption[];
  /** On for a checked box, a selected tab or option, or a pressed toggle. */
  checked?: boolean;
  expanded?: boolean;
  disabled: boolean; readOnly: boolean; required: boolean;
  /** Below or beside the visible area. `act` scrolls it into view first. */
  offscreen: boolean;
  /** The number of the form it belongs to, in its frame. */
  form?: number;
  /** Clicking it sends its form. */
  submit: boolean;
  /** Inside a dialog, listbox or menu that is open over the page. */
  dialog: boolean;
  /** For an autocomplete option: the id of the field whose list holds it. */
  popupFor?: string;
  /** The field opens a list of suggestions. */
  autocomplete: boolean;
  /** The field opens a date picker. */
  picker: boolean;
  /** The date format the field wants: "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"... */
  dateFormat?: string;
  /** A password field. Its value never leaves the page. */
  secret: boolean;
  /** What `act` compares before it acts. Opaque. */
  guard: string;
}

/** The state of one frame when it was read. */
export interface FrameState {
  frameId: number; url: string;
  /** What `act` compares before it acts. Opaque. */
  key: string;
  /** Firefox 153+: the document the snapshot read. `act` targets only this document. */
  documentId?: string;
}

/** Every control in every frame of a tab. */
export interface Snapshot {
  url: string;
  title: string;
  /** Visible text of the top frame, up to 6000 characters. */
  text: string;
  /** Text of the visible h1 and h2 elements. */
  headings: string[];
  controls: Control[];
  frames: FrameState[];
  /** A captcha widget or captcha text is on the page. */
  captcha: boolean;
  /** The page can scroll down. */
  more: boolean;
}
/** What `act` can do to a control. */
export type Operation = "click" | "type" | "select" | "check" | "uncheck" | "date" | "enter" | "scroll";

export interface ActRequest {
  op: Operation;
  /** The text to type, the option value to select, the ISO date, or the scroll delta. */
  value?: string;
  /** Outline the control before acting. Default: true. */
  mark?: boolean;
}

/** Why `act` did not act. */
export type Refusal = "stale" | "gone" | "hidden" | "covered" | "disabled" | "readonly" | "unsupported" | "navigated";

export interface ActResult {
  ok: boolean;
  reason?: Refusal;
  /** More detail on a refusal. */
  detail?: string;
  /** The field's value after typing. */
  value?: string;
  /** The action fired a submit event on a form. */
  submitted?: boolean;
}
