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
| C13 | A control deletes, buys or pays. The run clicks it because it scored well. | The controller never picks such a control unless the goal names it. | Isolated `tests/controller.test.ts` |

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
