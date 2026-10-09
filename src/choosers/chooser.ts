// The seam between foxpaw and a model. The controller asks a Chooser which
// control serves a requirement. It never asks a model for code or selectors.
import type { Requirement } from "../goal.js";
import type { Control } from "../types.js";

export interface Choice {
  controlId: string;
  /** 0 to 1. The controller does not act below its floor. */
  score: number;
}

export interface Chooser {
  /** A short name for run results: "rule", "gliner". */
  readonly name: string;
  /** The control in `controls` that serves the requirement, or null when none does or two tie. */
  choose(requirement: Requirement, controls: Control[]): Promise<Choice | null>;
  /** Spans of the goal for each label: { email: ["sam@example.com"], person: ["Sam Lee"] }. */
  extract(goal: string, labels: string[]): Promise<Record<string, string[]>>;
}
