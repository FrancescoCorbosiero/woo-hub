import { describe, expect, it } from "vitest";
import type { ScopedPricingRule } from "@core/config";
import { pricingRulesVersion } from "./rule-list";

const rule: ScopedPricingRule = {
  id: "store-category-12",
  scope: { storeCategory: 12, storeTermName: "Saldi" },
  enabled: true,
  markupPercent: 25,
};

describe("pricingRulesVersion", () => {
  it("reads the same list the same way, whatever order its keys come in", () => {
    // Postgres' jsonb hands keys back in its own order; the editor in its.
    const reordered = JSON.parse('{"markupPercent":25,"enabled":true,"scope":{"storeTermName":"Saldi","storeCategory":12},"id":"store-category-12"}');
    expect(pricingRulesVersion([reordered])).toBe(pricingRulesVersion([rule]));
    // An undefined field is an absent one.
    expect(pricingRulesVersion([{ ...rule, floor: undefined }])).toBe(pricingRulesVersion([rule]));
  });

  it("moves with any change to the list: a margin, a rule added or removed, the order", () => {
    const base = pricingRulesVersion([rule]);
    expect(pricingRulesVersion([{ ...rule, markupPercent: 30 }])).not.toBe(base);
    expect(pricingRulesVersion([rule, { ...rule, id: "x" }])).not.toBe(base);
    expect(pricingRulesVersion([])).not.toBe(base);
    expect(pricingRulesVersion([{ ...rule, id: "x" }, rule])).not.toBe(pricingRulesVersion([rule, { ...rule, id: "x" }]));
  });
});
