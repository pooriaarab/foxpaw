# Failure modes

This file lists every way foxpaw can fail that we know of. Each row names the
behaviour we want and the test that checks it. The tests were written before
the code that makes them pass.

- **E2E** checks run in a real Firefox through `pnpm e2e` (`e2e/run.mjs`).
- **Isolated** tests run in Node through `pnpm test` (`tests/*.test.ts`).

## Page side: read and act

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| P1 | A hidden duplicate input (`display:none`, or a 1 px clipped box) has the same label as the real field. A value goes into the hidden copy. | `snapshot` leaves out controls that a person cannot see. The value goes into the visible field. The hidden copies stay empty. | E2E `hidden duplicates are not read` |
| P2 | A React-controlled input ignores a value set through the `value` property. Its state stays empty, and the next render clears the field. | `act` types with `insertText`. When that does not work, it uses the native value setter, then fires `input` and `change`. The page state holds the value. | E2E `react state holds the typed value` |
| P3 | The field is inside a shadow root. `querySelectorAll` does not find it. | `snapshot` walks open shadow roots. `act` hit-tests through them. | E2E `shadow DOM field is read and filled` |
| P4 | The form is inside an iframe. A top-frame read does not find it. | `snapshot` reads every frame. Each control carries its `frameId`. `act` runs in that frame only. | E2E `iframe form is read and filled` |
| P5 | The page changes between the decision and the action. The click lands on a different control. | `act` compares the control and the frame state with the snapshot first. When they differ, it returns `stale` and does not touch the page. | E2E `stale check refuses a changed page` |
| P6 | Another element covers the target. The click goes to the cover. | `act` hit-tests the centre of the target. When the top element is not the target or inside it, it returns `covered`. | E2E `covered control is refused` |
| P7 | The page navigates while the action runs. `executeScript` rejects. | The `tab` wrapper returns `{ ok: false, reason: "navigated" }`. It never throws for this case. | Isolated `tests/tab.test.ts` |
| P8 | The control is disabled. A click does nothing, and the run thinks it worked. | `snapshot` marks it `disabled`. `act` returns `disabled` and does not click. | E2E `disabled submit is refused` |
| P9 | An autocomplete list never opens after typing. The run waits forever. | `settle` returns at its cap (1.5 s). The controller keeps the typed text and moves on (C6). | E2E `settle returns when no list opens` |
| P10 | The page never goes quiet (a ticker). | `settle` returns at its cap. | E2E `settle returns on a page that never stops` |
| P11 | A list without keys reuses its DOM nodes. A row is removed, and the next row's text moves into the same nodes. The "Archive" button keeps its node and its label, but now belongs to another row. | The guard holds the control's section and a short hash of its row, list item or card text. When the row text changed, `act` returns `stale`. | E2E `stale check sees a reused row` |
| P12 | A click on a link starts a navigation, and the next `executeScript` call goes to the document that is unloading. Firefox never answers it, so the run hangs. | Each `snapshot`, `act` and `settle` call gives up after a time limit (5 s, 5 s, 3 s). `runTask` reads the new page again. | E2E `run does not act after a link to another site`, `allowHosts lets the run go on` |

## Page text for a planner: `pageText` and `changeText`

A planner model reads the page as text, and each token costs time. `pageText`
trims a snapshot to the controls that matter. `changeText` tells the planner
what an action changed, in place of the whole page. Both return page data
only: the caller puts all of it inside its data fence.

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| T1 | The 40-control budget fills with header and menu links. No form field and no product shows (Amazon). | Runs of 5 or more short links outside forms fold into one line. Fields, submit buttons and dialog controls are picked first, then visible controls, then the rest. The kept lines stay in page order. | E2E `trim folds the menu and keeps the field inside it`, isolated `tests/text.test.ts` |
| T2 | The trim drops the only submit button, or a field that sits inside a menu. | Only links fold. A field or a submit button is never folded and is picked before any link. | E2E `trim folds the menu and keeps the field inside it`, isolated `tests/text.test.ts` |
| T3 | A fold line names an id that is not a control, or the planner cannot reach a folded link. | A fold line names each folded link with its real id. Every control stays in the snapshot, so an id from the text works for `act`. | E2E `a folded link still works, and a navigation gives the whole page`, isolated `tests/text.test.ts` |
| T4 | Rows of content (Hacker News stories: upvote, title, site, user, time) read as a menu and fold. | A run of links breaks where two links share a row, a section or a frame. | Isolated `tests/text.test.ts` |
| T5 | The dedupe merges links that do different things ("upvote" on each story, or an `href="#"` Archive link in each row). | Only links with the same label and the same real href count as duplicates. A `#` or `javascript:` href is never a duplicate. | Isolated `tests/text.test.ts` |
| T6 | The text cut drops content: a line that equals the label of a control that did not make the cut (a product title), or a repeated price. | A text line is dropped only when it repeats the label of a control line or a folded link that the text shows. Repeated short lines are dropped, unless they hold a number or read as an error or an alert. | Isolated `tests/text.test.ts` |
| T7 | Text that a scanner such as foxshield wrapped in `<untrusted-data>` loses its wrapper: a dedupe or a diff keeps the middle line and drops a marker line, so injected text reads as plain page text. | A wrapped block is one unit. It is kept whole or left out whole, and never deduped. | Isolated `tests/text.test.ts` |
| T8 | A label or a value holds a line break and a fake control line (`[0:2] button "Pay"`) with a real id, or a `</untrusted-data>` line that closes a wrapper. | Labels and values are one line, in JSON quotes, and a wrapper marker in them is escaped. |
| T9 | Over 40 fields fill the budget and push out the form's submit button. | Submit buttons are picked before anything else. |
| D1 | The diff after an action hides an error message that the page showed. | Every new text line goes into the diff. When the new text is too long for a diff (over 1200 characters, or over half the page text), `changeText` returns the whole page. | E2E `diff shows a new error message`, isolated `tests/text.test.ts` |
| D2 | The action navigated. A diff against the old page is wrong. | When the address, the set of frames, or a frame's document changed (its document id, or its load time when Firefox gives no id), `changeText` returns the whole page with `full: true`. | E2E `a folded link still works, and a navigation gives the whole page`, isolated `tests/text.test.ts` |
| D3 | The page re-rendered, so ids changed between the two reads. The diff names an old id. | Controls are matched by id only. A re-mounted control shows as gone (old id) and new (new id). When over half the controls differ, `changeText` returns the whole page. | Isolated `tests/text.test.ts` |
| D4 | The diff says a password field is empty when it holds a value, or shows its value. | The diff prints the values of the second snapshot as they are ("•••", or a caller's "[redacted]"). The control that was acted on is always listed with its value. | E2E `diff shows a password as masked, never as empty or plain`, isolated `tests/text.test.ts` |
| D6 | A captcha appears after the action, and the diff does not say so. | The diff names a captcha that is now on the page. | Isolated `tests/text.test.ts` |
| D5 | Nothing changed after a click, and the planner cannot tell. | The diff says that nothing on the page changed. | Isolated `tests/text.test.ts` |

## Goal parsing

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| G1 | A comma inside a date ("December 3, 2026") splits the date into two requirements. | Dates and quoted values are kept whole when the goal is split. | Isolated `tests/goal.test.ts` |
| G2 | A list of `key: value` items reads as one requirement. | Each item becomes its own requirement with a key and a value. | Isolated `tests/goal.test.ts` |
| G3 | "from New York to Boston on May 2" reads as one requirement. | Each preposition starts a new requirement. "Set X to Y" is not split. | Isolated `tests/goal.test.ts` |
| G4 | "Do not submit" reads as a requirement to press Submit. | It turns sending off and is not a requirement. | Isolated `tests/goal.test.ts` |

## Controller rules

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| C1 | Two fields have similar labels ("Billing postcode", "Shipping postcode"). The wrong one gets the value. | `ruleChooser` scores the field that matches every word of the requirement higher. | Isolated `tests/choose.test.ts` |
| C2 | Two controls score the same. A guess picks one. | `ruleChooser` returns `null` on a tie. The controller marks the requirement unmatched and does not act on it. | Isolated `tests/choose.test.ts` |
| C3 | Two requirements want the same field. The second one types over the first. | Requirements are served in goal order. A control serves at most one requirement. | Isolated `tests/controller.test.ts` |
| C4 | A value that is not a date goes into a date field, or the other way around. | Date fields take only date requirements. Other fields take a date only when no date field fits. | Isolated `tests/controller.test.ts` |
| C5 | An autocomplete list opens. The run ignores it, or picks the first option. | The controller clicks the option that names the value. It forgives small typos. | Isolated `tests/controller.test.ts`, E2E `form run is verified` |
| C6 | An autocomplete list opens, but no option names the value. | The controller does not click an option. It keeps the typed text and moves on. | Isolated `tests/controller.test.ts` |
| C7 | The date picker shows another month. The day is not there. | The controller clicks the picker's "next month" button, at most 24 times. Then it stops with `blocked`. | Isolated `tests/controller.test.ts`, E2E `form run is verified` |
| C8 | The date is in another locale. The goal says "3 décembre 2026", or the field wants `DD/MM/YYYY`. Day and month swap. | Dates are parsed to ISO first. The typed text follows the field's format hint. Verify reads the field with the same hint. | Isolated `tests/dates.test.ts` |
| C9 | The submit button is disabled and nothing is left to do. The run clicks it and calls itself done. | The controller stops with `blocked: "the submit button is disabled"`. | Isolated `tests/controller.test.ts` |
| C10 | The goal says "do not submit". The run submits anyway. | The controller never sends a form when the goal forbids it. | Isolated `tests/controller.test.ts` |
| C11 | The run never ends, or ends early. | It ends `done` when nothing is left. It ends `blocked` at the step cap, or after 3 stale refusals in a row. | Isolated `tests/controller.test.ts` |
| C12 | The page shows a captcha. The run tries to solve it. | The run stops with `blocked: "captcha"` before any action. | Isolated `tests/controller.test.ts`, E2E `captcha page is blocked` |
| C18 | A send or a link click navigates to another site that has its own form. The run keeps acting there, on a site no caller or gate judged. | `runTask` pins the registrable domain of the page it starts on. When a later page is on another site, it stops with `blocked: "the page moved to another site"` before it acts. A move within the same site goes on. `allowHosts` names more sites for a caller that judged them. | E2E `run stops on another site`, `run does not act after a link to another site`, `allowHosts lets the run go on`; isolated `tests/site.test.ts` |
| C13 | A control deletes, buys or pays. The run clicks it because it scored well. | The controller never picks such a control unless the goal names it. | Isolated `tests/controller.test.ts` |
| C14 | A risky label uses another word form: "Place your order", "Confirm payment", "Check out", "Payment". | Risky labels match by word stem and phrase, not one fixed word. | Isolated `tests/safety.test.ts` |
| C15 | The goal holds the risky word only inside an email or a URL ("me@paypal.com"), or after a negation ("do not buy anything"). | Only a whole word in the goal's own text allows the action. Emails, URLs and quoted text do not count. A "not", "never", "no" or "without" earlier in the same clause blocks it. | Isolated `tests/safety.test.ts` |
| C16 | The form to send has a risky submit button ("Pay now"). | The run stops with `blocked` and names the button. | Isolated `tests/controller.test.ts` |
| C17 | The run presses Enter in a form whose only submit button is hidden. The hidden button is clicked. | `act` with `enter` refuses with `hidden` when the form's submit button is hidden. | E2E `enter refuses a hidden submit button` |

## glinerChooser: a foxmind model behind the Chooser

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| M1 | Two controls share a label. The model's score maps to the wrong one. | Each label sent to the model is unique ("Email", "Email (2)"). The score maps back to the right control. | Isolated `tests/gliner.test.ts` |
| M2 | A page has hundreds of controls. One model call becomes slow. | At most 32 controls go into one call, in page order. | Isolated `tests/gliner.test.ts` |
| M3 | The object passed in has no `classify`. The run fails mid-task. | `glinerChooser` throws a `TypeError` that names the missing method when it is created. | Isolated `tests/gliner.test.ts` |
| M4 | The model scores every control low. | `choose` returns the top score as it is. The controller's floor decides. | Isolated `tests/gliner.test.ts` |

## Verify: the result checklist

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| V1 | A field is empty or holds another value, and the run says done. | Each value requirement needs a control that shows the value. | Isolated `tests/verify.test.ts` |
| V2 | A success banner sits next to an unrelated form ("Thanks for subscribing"). Our form was never sent. | "Form sent" passes only when the run sent the form it filled. Page text does not count. | Isolated `tests/verify.test.ts` |
| V3 | The form was sent, and the next page is an error page. | `verified` is `false`, with the problem "error page". | Isolated `tests/verify.test.ts`, E2E `error page is not verified` |
| V4 | The page is a captcha page. | `verified` is `false`, with the problem "captcha". | Isolated `tests/verify.test.ts` |
| V5 | The page is empty. | `verified` is `false`, with the problem "empty page". | Isolated `tests/verify.test.ts` |
| V6 | The form navigates away after the send. Its fields are gone, so every value check fails. | Value checks use the snapshot taken right before the send. | Isolated `tests/verify.test.ts` |
| V7 | A setting ("accept the terms") is not on. | A setting needs a checked box, a selected option or a pressed button that names it. | Isolated `tests/verify.test.ts` |
| V8 | A normal page has the word "error" in a form hint. It reads as an error page. | Only the title, a top heading or a near-empty page can mark an error page. | Isolated `tests/verify.test.ts` |
| V9 | The run presses Enter or clicks a button that is not a real submit. No submit event fires and the page does not change. The run still reports "Form sent". | A send counts only when a submit event fired, or the top frame's address or document changed after it. Else the run stops with `blocked: "the form did not send"`, and "Form sent" fails. | Isolated `tests/controller.test.ts`, `tests/verify.test.ts` |
| V10 | The run clicks a toggle for a setting, but the toggle was already on, so the click turned it off. The check passes because the click happened. | A setting check reads the control's state after the run. A control that reports a state must be on. | Isolated `tests/verify.test.ts` |

## AMO release build and listed submission (`scripts/amo-listing.mjs`)

`pnpm check:amo` reads `dist-ext/`, which is what `release.yml` signs. Each
row is a way that the listed build or the submission can go wrong.

| ID | Failure | Wanted result |
|---|---|---|
| AR1 | `dist-ext/` is missing, so the check reads nothing | The check stops and says to run `pnpm build:ext` |
| AR2 | A content script in the release manifest matches `127.0.0.1`, `localhost` or `*.localhost` (a test bridge) | The check stops and names the pattern |
| AR3 | A host permission for a local host exists only for tests | The check stops, unless `local_hosts` in the listing gives a reason for that exact pattern |
| AR4 | A file named for tests (`e2e`, `fixture`, `test`, `spec`) is in `dist-ext/` | The check stops and names the file |
| AR5 | `dist-ext/` came from `build-ext.mjs --e2e` | AR2 or AR4 stops it |
| AR6 | The `local_hosts` reasons go to AMO as an unknown field | `metadata` leaves them out, as it does the privacy policy |
| AR7 | A re-run submits a version that AMO already has as listed | `version-status` says `listed`, and the step skips web-ext sign and finishes the release |
| AR8 | AMO has the version as unlisted | `version-status` stops and says to bump the version |
| AR9 | The AMO version lookup fails (401, 500, network) | `version-status` stops; it never guesses `absent` |
| AR10 | The add-on already exists on AMO, and the version lookup sends a parameter AMO refuses on a single version (400), so every release stops | `version-status` asks for `versions/v<version>/` with no query; an owner sees listed and unlisted versions there |
| AR10 | The release sidebar sets `window.foxpaw`, a hook that only the e2e test uses | `build-ext.mjs --e2e` defines `__E2E__` true and keeps the hook; the release build defines it false, so esbuild drops the hook |
| AR11 | `pnpm e2e` runs on the release build, which has no hook, so it cannot drive the sidebar | The `e2e` script builds with `--e2e` |

| ID | Failure | Wanted result |
|---|---|---|
| AR-U1 | A `local_hosts` reason for a host permission also clears a test content script on the same pattern | Each reason names its use (`host_permission`, `content_script`, `web_accessible_resource`, `externally_connectable`); a use without its own reason stops the check |
| AR-U2 | `local_hosts` keeps a reason for a use that the release build does not have | The check stops and names the pattern and the use |
