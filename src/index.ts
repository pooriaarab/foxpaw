// The public API of foxpaw.
export { act, settle, snapshot, type ScriptingApi } from "./tab.js";
export type * from "./types.js";
export { parseGoal, type Goal, type Requirement } from "./goal.js";
export { formatDate, readDate, resolveDate, type IsoDate } from "./dates.js";
export type { Choice, Chooser } from "./choosers/chooser.js";
export { ruleChooser } from "./choosers/rule.js";
export { confirmSend, decide, record, start, FLOOR, type Next, type RunState, type StepRecord } from "./controller.js";
export { namesValue, nearlyNames } from "./match.js";
export { problemOf, verify, type Check, type Verdict } from "./verify.js";
export { runTask, type RunOptions, type RunResult } from "./run.js";
export { groupTab, type TabGroupStatus } from "./tabgroup.js";
export { glinerChooser, LABEL_CAP, type MindLike } from "./choosers/gliner.js";
export { allowedBy, risky } from "./safety.js";
