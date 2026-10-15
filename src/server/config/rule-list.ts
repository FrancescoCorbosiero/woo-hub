import { createHash } from "node:crypto";
import type { ScopedPricingRule } from "@core/config";

/**
 * A short fingerprint of a pricing-rule list: what the Margins tab loaded,
 * handed back with its save so the server can tell whether the list moved
 * since (a margin set from the Vetrina, the pricing bar, another tab).
 *
 * A fingerprint of the rules rather than the row's updated_at: a change to
 * another part of the config (the taxonomy, say) must not refuse a rules
 * save that loses nothing. Keys are sorted first — Postgres' jsonb hands
 * them back in its own order, the editor in whatever order it built them —
 * and absent and undefined fields read the same.
 */
export function pricingRulesVersion(rules: readonly ScopedPricingRule[]): string {
  return createHash("sha256").update(canonical(rules)).digest("hex").slice(0, 16);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
