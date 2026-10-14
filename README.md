# foxpaw

[![npm version](https://img.shields.io/npm/v/foxpaw)](https://www.npmjs.com/package/foxpaw)
[![Downloads/month](https://img.shields.io/npm/dm/foxpaw)](https://www.npmjs.com/package/foxpaw)
[![MIT license](https://img.shields.io/npm/l/foxpaw)](https://opensource.org/license/mit)
![Zero runtime dependencies](https://img.shields.io/badge/runtime_dependencies-0-blue)
![Types included](https://img.shields.io/badge/types-included-blue)

[Setup](#install) · [API reference](#runtime-surfaces) · [Comparisons](#compare) · [Source](https://github.com/pooriaarab/foxpaw)

foxpaw is an open-source Firefox browser automation library for extension authors.
It reads page controls, fills forms through in-page events, and returns a result checklist.
Rules choose controls by default; applications can supply a GLiNER2 chooser through foxmind.

## Install

```bash
npm install foxpaw
```

Development requires Node.js 24 or later.
The package includes TypeScript types and has zero runtime dependencies.
Browser operations require Firefox WebExtension scripting and host access.
Exact-document action targeting uses Firefox 153 or later.

## Parse your first form goal

Save this example as `quickstart.mjs`, then run `node quickstart.mjs`.
No browser, credentials, environment variables, or `.env` file are required for this parser example.

```js
import { parseGoal } from "foxpaw";

const goal = parseGoal("email: sam@example.com, do not submit");
console.log(goal.requirements[0].key, goal.requirements[0].value, goal.submit);
// email sam@example.com false
```

For a browser walkthrough, bundle this code into your extension background script.
Grant `scripting`, `activeTab`, and access to your test page.
Open a page with an Email field before calling it.

```js
import { runTask } from "foxpaw";

const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
const result = await runTask(tab.id, "email: sam@example.com, do not submit");
console.log(result.status, result.verified, result.checks);
```

Success shows `done true`; the Email field contains `sam@example.com`, and the form remains unsent.
Check the returned evidence when the page does not match this simple form.

## How it works

```text
Goal -> requirements -> snapshot -> chooser -> stale check -> act
                           ^                                |
                           +----------- settle -------------+
No work remains -> verify -> status, checks, unmatched requirements
```

The default chooser scores label overlap and field type.
The controller orders requirements, chooses one form, and checks destinations before sending.
Page actions compare the saved control guard and frame state.
The loop reads the page again after each action.

## Why it exists

Extension authors need page controls and result evidence inside the user's Firefox session.
foxpaw provides a form-oriented controller over WebExtension scripting.
Playwright and Selenium are alternatives when an external browser automation process fits the application.

## Compare

Scope checked on 2026-10-14 against the linked official documentation.

| Scope | foxpaw | [Playwright](https://playwright.dev/docs/auth) | [Selenium](https://www.selenium.dev/documentation/webdriver/) |
|---|---|---|---|
| Main role | Form goals and page actions | Browser testing and automation | WebDriver browser automation |
| Execution | Your Firefox extension | Your browser automation process | Your WebDriver session |
| Configuration | Goal text and chooser interface | Test fixtures and browser contexts | Driver and language bindings |
| Result surface | Status and per-goal checklist | Test assertions | Application-defined assertions |

## Coverage

| Surface or integration | Status | Behavior |
|---|---|---|
| Firefox WebExtensions | Implemented | Snapshot, action, settle, and task loop |
| Rule chooser | Implemented | No model or download required |
| GLiNER2 / foxmind | Implemented adapter | Caller supplies `extract` and `classify`; no model bundled |
| Open shadow roots | Implemented | Snapshot walks accessible controls |
| Frames with host permission | Implemented | Snapshots collect readable frame results |
| Google reCAPTCHA | Detection only | Run blocks on recognized frame or widget |
| hCaptcha | Detection only | Run blocks on recognized frame or widget |
| Cloudflare Turnstile | Detection only | Run blocks on recognized frame or widget |
| Cross-origin payment fields | Blocked | Sensitive requirements do not fill those frames |

Source inventory: eight operations and two built-in chooser implementations.
Operations are click, type, select, check, uncheck, date, enter, and scroll.
Three named CAPTCHA-provider patterns detect obstacles; they do not solve them.
Local tests exercise the controller and page paths. No live-provider or credential checks were performed for this rewrite.
The GLiNER2 adapter is implemented; the demo's model option is disabled because it bundles no model.

## Common use cases

1. Firefox extension authors: fill a local job form from explicit `key: value` goals.
2. Accessibility tool authors: map a user command to Firefox controls and inspect refusal reasons.
3. QA engineers: run a Firefox smoke test and assert `verified` plus the returned checks.
4. Agent authors: use foxmind's GLiNER2 interface to choose controls while controller rules govern actions.
5. Approval-flow authors: inspect `preview` and pin the approved form destination through `allowHosts`.

## Features

- **Page snapshots:** labels, roles, form state, frames, and open shadow roots.
- **Page actions:** eight operations with stale, hidden, covered, and disabled checks.
- **Goal controller:** requirement order, form selection, autocomplete, and date handling.
- **Preview:** planned fields, destination, button, and blocked reason without page actions.
- **Verification:** field evidence, form-send checks, and error-page detection.
- **Planner text:** `pageText` and `changeText` summarize snapshots and changes.

## Runtime surfaces

foxpaw is a library. It has no command-line interface or Model Context Protocol (MCP) server.

| Export | What it does |
|---|---|
| `runTask(tabId, goal, options?)` | Runs a goal on a tab and returns a `RunResult`: `status` (`done`, `blocked`, `stopped`, `error`), `verified`, `checks`, `steps`, `refusals`, `blockedReason`, `unmatched`, `totalMs`. Options: `chooser`, `maxSteps` (40), `today`, `group`, `onStep`, `signal`, `allowHosts`, `read` (reads each page in place of `snapshot`, so a caller can put a shield such as foxshield in front of the run). |
| `preview(snapshot, goal, options?)` | What `runTask` would do on this snapshot, without acting: `{ sends, destination, button, fields, blocked }`. `fields` holds the label and value of each field that gets one; a card number shows as `•••• 4242`, another sensitive value as `•••`. `destination` is the send's action URL, or null. Options: `chooser`, `today`, `allowHosts`. |
| `snapshot(tabId)` | Reads every frame of the tab into a `Snapshot` of `Control` objects. |
| `act(tabId, control, request, snapshot)` | Does one operation on one control: `click`, `type`, `select`, `check`, `uncheck`, `date`, `enter` or `scroll`. Returns `{ ok }`, or `{ ok: false, reason }` with `stale`, `gone`, `hidden`, `covered`, `disabled`, `readonly`, `unsupported` or `navigated`, `destination` or `submit`. |
| `pageText(snapshot, options?)` | The page as text for a planner model: title, address, up to 40 controls and the visible text. Runs of short links (menus) fold into one line that names each link and its id. Submit buttons and fields are picked first, duplicate links go, and text that only repeats a shown label goes. Option: `maxControls` (40). |
| `changeText(before, after, options?)` | What one action changed, as `{ full, text }`. On the same document, `text` is a short diff: changed, new and gone controls, a new title, and every new text line. After a navigation, or when over half the controls changed, it is `pageText(after)` and `full` is `true`. Option `target`: the id of the control the action used, always listed. |
| `settle(tabId, options?)` | Waits for a quiet page. With `listFor`, it first waits for a field's suggestion list. |
| `verify(page, state, sentFrom?)` | Builds the result checklist. `problemOf(page)` names an error, empty or captcha page. |
| `parseGoal(goal)` | Splits a goal into requirements. |
| `siteOf(url)`, `sameSite(start, url, allowHosts?)` | The registrable domain of a URL, and the site check `runTask` uses. |
| `start`, `decide`, `record`, `confirmSend`, `FLOOR` | The controller, one step at a time, for callers that run their own loop. |
| `ruleChooser()` | A `Chooser` with no model: word overlap, synonyms and type fit. Returns `null` on a tie. |
| `glinerChooser(mind)` | A `Chooser` backed by GLiNER2 through a [foxmind](https://github.com/pooriaarab/foxmind) `Mind`, or any object with its `extract` and `classify` methods. |
| `allowedBy(label, goal)`, `risky(label)` | Classify risky labels and check explicit goal intent. |
| `LABEL_CAP` | The GLiNER2 chooser considers at most 32 controls per classification call. |
| `groupTab(tabId)` | Puts the tab in a "foxpaw" tab group. `runTask` does this with `group: true`. |
| `resolveDate`, `formatDate`, `readDate` | Date rules. They read English, French, German and Spanish month names and field formats such as `DD/MM/YYYY`. |
| `namesValue`, `nearlyNames` | Literal value matching. `nearlyNames` forgives small typos. |

`pageText` and `changeText` return text from the page, folded lines included.
Pass all of it to a model as untrusted data, inside your data fence. Text that
a scanner wrapped in `<untrusted-data>` stays whole.

A `Chooser` has two methods:

```ts
interface Chooser {
  readonly name: string;
  choose(requirement: Requirement, controls: Control[]): Promise<{ controlId: string; score: number } | null>;
  extract(goal: string, labels: string[]): Promise<Record<string, string[]>>;
}
```

The controller does not act on a score below 0.4.

## Delivery and behavior limits

- In-page events have `isTrusted: false`. A site that checks for trusted input
  can ignore a click. Native pickers, file dialogs and pop-ups do not open.
- `ruleChooser` matches words. It reads English labels best, and it does not
  understand a goal the way a model does. A setting it cannot match, such as
  "Find a flight", is skipped and listed in `unmatched`.
- The goal parser reads `key: value` items, prepositions ("from", "to", "on"),
  quoted values, emails, phone numbers and dates. Other phrasing may become a
  setting that matches nothing.
- Requirements are matched greedily in goal order. An earlier requirement can
  take a control that a later one fits better.
- Closed shadow roots and cross-origin frames without host access are not read.
- The page check uses the title, the top heading and short page text. It can
  miss an error message inside a normal page.
- `verify` checks what the form shows. It does not check that the results a
  site shows after the send are correct.
- The site check has no full public suffix list. It knows common two-part
  suffixes such as `co.uk` and `github.io`. On another suffix, two hosts under
  it can count as one site.
- Destination checks (C22 to C29) are defence in depth, not a boundary. Page
  script can read a field as foxpaw types, or send it with `fetch`. The
  boundary is the approval that names where the data goes. The
  `window.stop()` fallback for a moved action is not proven against every race.
- Card fields in a cross-origin frame (Stripe Elements, Adyen, Braintree)
  block by design: foxpaw types no goal value there (C27), so C20 stops the send.
- foxpaw does not solve captchas. It stops with `blocked: "captcha"`.
- The demo extension bundles no model, so its GLiNER2 option is off.
- E2E tests cover local fixture pages only, not live sites.

## Integration guides

- [Firefox form automation setup](#parse-your-first-form-goal) includes permissions and an unsent form example.
- [GLiNER2 chooser API](#runtime-surfaces) describes the caller-supplied model interface.
- [Destination and input limits](#delivery-and-behavior-limits) explains synthetic events and payment-frame restrictions.

### Demo extension and local checks

```bash
pnpm install
pnpm build:ext
pnpm ci:local
pnpm e2e
```

Load `dist-ext/manifest.json` through Firefox's temporary add-on screen at `about:debugging#/runtime/this-firefox`.
Open the sidebar from the toolbar button, enter a goal for a test page, and select Run.
`ci:local` checks lint, types, unit tests, builds, extension lint, and the add-on listing.
`e2e` runs Firefox against local fixture pages; it requires a Firefox installation.

## Status

Version 0.1.15 is an early release. APIs and goal behavior can change during the 0.x series.
Report problems through [GitHub issues](https://github.com/pooriaarab/foxpaw/issues).
Public case studies are not yet published in this repository.

## FAQ

### What is foxpaw?

foxpaw reads and acts on web-page controls from a Firefox extension.
It returns task status and a checklist of observed results.

### Which integrations are verified?

foxpaw has source-backed Firefox and chooser paths with local tests.
This rewrite does not verify live websites or a downloaded GLiNER2 model.

### Does foxpaw provide a managed browser service?

foxpaw runs inside your extension.
You supply the browser permissions, interface, and optional model.

### How is foxpaw different from Playwright?

foxpaw runs form goals through in-page events inside Firefox WebExtensions.
[Playwright](https://playwright.dev/docs/auth) uses browser contexts and test fixtures in an automation process.

### How is foxpaw different from Selenium?

foxpaw provides a goal parser, chooser, controller, and result checklist.
[Selenium WebDriver](https://www.selenium.dev/documentation/webdriver/) controls browser sessions through drivers and language bindings.

### Does foxpaw require an AI model?

foxpaw uses `ruleChooser()` by default, with no model download.
The optional `glinerChooser(mind)` adapter needs a caller-supplied object with extraction and classification methods.

### Can foxpaw solve CAPTCHAs?

foxpaw detects known CAPTCHA hints and stops the run.
It returns a blocked result rather than attempting the challenge.

### What does verified mean?

foxpaw reports `verified` when the run finishes and its page checks pass.
Those checks do not prove that a remote service stored the data or produced correct results.

### Can foxpaw act on another site?

foxpaw stays on the starting site unless `allowHosts` permits another host.
Form destinations have additional checks; the site matcher uses a limited suffix list.

## Attribution

foxpaw adapts page and controller code from [foxpilot](https://github.com/pooriaarab/foxpilot), licensed under MIT.
foxpilot adapts [gliner2-ultrafast](https://github.com/sahibzada-allahyar/gliner2-ultrafast) by Sahibzada Allahyar, with Browser Use copyright.

## License

MIT. See the [MIT license text](https://opensource.org/license/mit).
