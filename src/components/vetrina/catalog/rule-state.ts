import type { RailCollection } from "@/lib/collections/types";

/**
 * Where an automatic category's rule stands, for every catalog screen that
 * shows it (the home's "Automatiche", a category's panel): working on its
 * own, paused, waiting for the owner to confirm a big change, or failing.
 */
export type RuleState = "working" | "paused" | "held" | "problem";

export function ruleState(rule: Pick<RailCollection, "enabled" | "held" | "lastError">): RuleState {
  if (!rule.enabled) return "paused";
  if (rule.held) return "held";
  if (rule.lastError) return "problem";
  return "working";
}
