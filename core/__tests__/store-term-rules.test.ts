import { describe, it, expect } from "vitest";
import {
  compareScopePrecedence,
  productScopeMatches,
  resolveCategoryPath,
  resolveEffectiveRule,
  resolveMarkupRule,
  scopeTier,
  winningMarkupRuleId,
} from "../config";
import type { ScopedPricingRule, TaxonomyConfig } from "../config";
import { buildPlan, computePrice } from "../core-spine";
import type { SourceProduct, StoreTermRef } from "../core-spine";
import { makeConfig, makeProduct, makeVariant, rule } from "./helpers";

/**
 * Margins on the shop's own categories and brands (RuleScope.storeCategory /
 * storeBrand): the owner's "Ricarico 25%" on a category, set from the
 * Vetrina. The product carries its store terms with their ancestors (the
 * enrichment reads them from the store index); these tests hand them over
 * directly.
 *
 * The store's trees used throughout:
 *   categories  10 Sneakers › 11 Nike › 12 Nike Off-White      20 Saldi
 *   brands      30 Nike › 31 Nike SB
 */
const terms = (...pairs: [number, number][]): StoreTermRef[] => pairs.map(([id, depth]) => ({ id, depth }));

/** A KicksDB-priced product filed under Sneakers › Nike › Nike Off-White and the brand Nike SB. */
function offWhite(over: Partial<SourceProduct> = {}): SourceProduct {
  return {
    ...makeProduct([makeVariant("v1", 100)]),
    storeCategories: terms([10, 0], [11, 1], [12, 2]),
    storeBrands: terms([30, 0], [31, 1]),
    ...over,
  };
}

/** The shipped house rule, trimmed to what matters here: banded margin and the safety nets. */
const GENERAL = rule({
  id: "general",
  sourceDeliveryType: "standard",
  markupPercent: 19,
  markupBands: [
    { upTo: 150, percent: 35 },
    { upTo: null, percent: 19 },
  ],
  rounding: { mode: "charm", increment: 0.99 },
  tax: { priceIncludesVat: false, vatRatePercent: 0 },
  minMarginFixed: 20,
  outlierFloorPercent: 40,
  minDeltaPercent: 3,
});
const GS_PASSTHROUGH = rule({
  id: "goldensneakers-passthrough",
  scope: { source: "goldensneakers" },
  markupPercent: 0,
  markupBands: [],
  minAsks: 1,
  rounding: { mode: "none" },
  outlierFloorPercent: 0,
  minMarginFixed: 0,
});

const nike = (markupPercent: number, id = "cat-nike") =>
  rule({ id, scope: { storeCategory: 11, storeTermName: "Nike" }, markupPercent });

function priceOf(product: SourceProduct, rules: ScopedPricingRule[], ask = 100): number | null {
  const v = makeVariant("v", ask);
  const eff = resolveEffectiveRule(product, v, makeConfig(rules));
  return eff ? computePrice(v, eff) : null;
}

describe("a store-term scope matches", () => {
  it("the products filed under the term", () => {
    expect(productScopeMatches({ storeCategory: 12 }, offWhite())).toBe(true);
    expect(productScopeMatches({ storeBrand: 31 }, offWhite())).toBe(true);
  });

  it("the products of its sub-terms: a parent's rule covers its children", () => {
    // Filed under "Nike Off-White" only; "Nike" and "Sneakers" come as ancestors.
    expect(productScopeMatches({ storeCategory: 11 }, offWhite())).toBe(true);
    expect(productScopeMatches({ storeCategory: 10 }, offWhite())).toBe(true);
    expect(productScopeMatches({ storeBrand: 30 }, offWhite())).toBe(true);
  });

  it("not a product outside the term, nor a term of the other taxonomy with the same id", () => {
    expect(productScopeMatches({ storeCategory: 20 }, offWhite())).toBe(false);
    // 30 is a brand: as a category id it names nothing this product is in.
    expect(productScopeMatches({ storeCategory: 30 }, offWhite())).toBe(false);
  });

  it("both terms when the scope names both", () => {
    expect(productScopeMatches({ storeCategory: 11, storeBrand: 31 }, offWhite())).toBe(true);
    expect(productScopeMatches({ storeCategory: 20, storeBrand: 31 }, offWhite())).toBe(false);
  });

  it("never a product whose store terms are unknown (no index, not on the store yet)", () => {
    const unknown = makeProduct([makeVariant("v1", 100)]);
    expect(productScopeMatches({ storeCategory: 11 }, unknown)).toBe(false);
    expect(productScopeMatches({ storeCategory: 11 }, { ...unknown, storeCategories: [] })).toBe(false);
    expect(priceOf(unknown, [GENERAL, nike(25)])).toBe(135.99); // the house band, untouched
  });

  it("never a product the supplier feed prices, whatever category the shop files it under", () => {
    const gs = offWhite({ source: "goldensneakers" });
    expect(productScopeMatches({ storeCategory: 11 }, gs)).toBe(false);
    // Its presented price passes through, as without the rule.
    expect(priceOf(gs, [GENERAL, GS_PASSTHROUGH, nike(25)], 138)).toBe(138);
    expect(resolveMarkupRule(gs, makeVariant("v", 138), makeConfig([GENERAL, GS_PASSTHROUGH, nike(25)]))?.id).toBe(
      "goldensneakers-passthrough",
    );
    // Nor any other source than the market's asks — a store-only mirror row included.
    expect(productScopeMatches({ storeCategory: 11 }, offWhite({ source: "woo" }))).toBe(false);
    // …even when the rule itself names that source.
    expect(productScopeMatches({ storeCategory: 11, source: "goldensneakers" }, gs)).toBe(false);
  });

  it("a KicksDB product, however its source is spelled", () => {
    expect(productScopeMatches({ storeCategory: 11 }, offWhite({ source: "kicksdb" }))).toBe(true);
    expect(productScopeMatches({ storeCategory: 11 }, offWhite({ source: " KicksDB " }))).toBe(true);
    expect(productScopeMatches({ storeCategory: 11 }, offWhite({ source: undefined }))).toBe(true);
  });

  it("a label is never matched: storeTermName alone constrains nothing", () => {
    expect(productScopeMatches({ storeTermName: "Adidas" }, offWhite())).toBe(true);
    expect(scopeTier({ storeTermName: "Adidas" })).toBe(1);
  });
});

describe("precedence: SKU > store term > everything else", () => {
  it("tiers: 3 for a SKU, 2 for a store term, 1 for the rest", () => {
    expect(scopeTier({ sku: "CT8012-047" })).toBe(3);
    expect(scopeTier({ sku: "CT8012-047", storeCategory: 11 })).toBe(3);
    expect(scopeTier({ storeCategory: 11 })).toBe(2);
    expect(scopeTier({ storeBrand: 30, sizeMin: 40 })).toBe(2);
    expect(scopeTier({ category: "Air Jordan", secondaryCategory: "One", model: "Retro" })).toBe(1);
    expect(scopeTier({})).toBe(1);
  });

  it("a store-term rule outranks every catalog-axis rule, however many fields it has", () => {
    const family = rule({
      id: "family",
      scope: { brand: "Jordan", category: "Air Jordan", secondaryCategory: "One", model: "Retro High" }, // weight 13
      markupPercent: 50,
    });
    // Either order in the list: the tier decides, not the position.
    expect(priceOf(offWhite(), [GENERAL, family, nike(25)])).toBe(125.99);
    expect(priceOf(offWhite(), [GENERAL, nike(25), family])).toBe(125.99);
  });

  it("a SKU rule outranks the store-term rule", () => {
    const one = rule({ id: "one-sku", scope: { sku: "CT8012-047" }, markupFixed: 30 });
    expect(priceOf(offWhite(), [GENERAL, one, nike(25)])).toBe(130.99);
    expect(priceOf(offWhite(), [GENERAL, nike(25), one])).toBe(130.99);
  });

  it("a SKU rule now outranks any combination of catalog axes (the documented change)", () => {
    // family + sub-family + name weighs 11, a bare SKU 10: before tiers the
    // family rule won on this very product. The SKU is the narrower word.
    const heavy = rule({
      id: "heavy",
      scope: { category: "Air Jordan", secondaryCategory: "One", model: "Retro" },
      markupPercent: 60,
    });
    const one = rule({ id: "one-sku", scope: { sku: "CT8012-047" }, markupPercent: 10 });
    const p = makeProduct([makeVariant("v1", 200)]);
    const withAxes = { ...p, category: "Air Jordan", secondaryCategory: "One", model: "Air Jordan 1 Retro High" };
    expect(resolveMarkupRule(withAxes, makeVariant("v", 200), makeConfig([GENERAL, heavy, one]))?.id).toBe("one-sku");
    expect(resolveMarkupRule(withAxes, makeVariant("v", 200), makeConfig([GENERAL, one, heavy]))?.id).toBe("one-sku");
    expect(winningMarkupRuleId(withAxes, [GENERAL, one, heavy])).toBe("one-sku");
  });

  it("between catalog-axis rules nothing changes: weight, then the later rule", () => {
    const brand = rule({ id: "brand", scope: { brand: "Jordan" }, markupPercent: 40 });
    const brandToo = rule({ id: "brand-too", scope: { brand: "Jordan" }, markupPercent: 45 });
    expect(resolveMarkupRule(offWhite(), makeVariant("v", 100), makeConfig([GENERAL, brand, brandToo]))?.id).toBe(
      "brand-too",
    );
    expect(compareScopePrecedence({ category: "A" }, { brand: "B" })).toBeGreaterThan(0);
  });
});

describe("two store-term rules on one product", () => {
  it("the deeper term wins: a sub-term's rule beats its parent's, in either list order", () => {
    const parent = nike(25, "nike");
    const child = rule({ id: "off-white", scope: { storeCategory: 12 }, markupPercent: 40 });
    expect(priceOf(offWhite(), [GENERAL, child, parent])).toBe(140.99);
    expect(priceOf(offWhite(), [GENERAL, parent, child])).toBe(140.99);
    // A product of the parent only keeps the parent's margin.
    const plainNike = offWhite({ storeCategories: terms([10, 0], [11, 1]) });
    expect(priceOf(plainNike, [GENERAL, child, parent])).toBe(125.99);
  });

  it("a category rule and a brand rule: the term deeper in its own tree wins", () => {
    const brandSb = rule({ id: "brand-sb", scope: { storeBrand: 31 }, markupPercent: 30 }); // depth 1
    const catOffWhite = rule({ id: "cat-ow", scope: { storeCategory: 12 }, markupPercent: 45 }); // depth 2
    expect(resolveMarkupRule(offWhite(), makeVariant("v", 100), makeConfig([GENERAL, catOffWhite, brandSb]))?.id).toBe(
      "cat-ow",
    );
    const brandNike = rule({ id: "brand-nike", scope: { storeBrand: 30 }, markupPercent: 30 }); // depth 0
    const catNike = nike(22, "cat-nike"); // depth 1
    expect(resolveMarkupRule(offWhite(), makeVariant("v", 100), makeConfig([GENERAL, catNike, brandNike]))?.id).toBe(
      "cat-nike",
    );
  });

  it("at the same depth, the later rule in the list", () => {
    const catNike = nike(22, "cat-nike"); // depth 1
    const brandSb = rule({ id: "brand-sb", scope: { storeBrand: 31 }, markupPercent: 30 }); // depth 1
    const cfgA = makeConfig([GENERAL, catNike, brandSb]);
    const cfgB = makeConfig([GENERAL, brandSb, catNike]);
    expect(resolveMarkupRule(offWhite(), makeVariant("v", 100), cfgA)?.id).toBe("brand-sb");
    expect(resolveMarkupRule(offWhite(), makeVariant("v", 100), cfgB)?.id).toBe("cat-nike");
    expect(winningMarkupRuleId(offWhite(), [GENERAL, catNike, brandSb])).toBe("brand-sb");
    expect(winningMarkupRuleId(offWhite(), [GENERAL, brandSb, catNike])).toBe("cat-nike");
  });

  it("on the same term, a narrower rule (a size range) beats the plain one", () => {
    const big = rule({ id: "nike-big", scope: { storeCategory: 11, sizeMin: 12 }, markupPercent: 50 });
    const product = offWhite();
    const small = makeVariant("v", 100); // size 9
    const large = { ...makeVariant("v", 100), sizeLabel: "13" };
    const cfg = makeConfig([GENERAL, big, nike(25)]);
    expect(resolveMarkupRule(product, small, cfg)?.id).toBe("cat-nike");
    expect(resolveMarkupRule(product, large, cfg)?.id).toBe("nike-big");
  });

  it("without the product, depths are unknown and only weight and list order tell", () => {
    expect(compareScopePrecedence({ storeCategory: 12 }, { storeCategory: 11 })).toBe(0);
    expect(compareScopePrecedence({ storeCategory: 12 }, { storeCategory: 11 }, offWhite())).toBeGreaterThan(0);
  });
});

describe("the whole-margin takeover and the safety nets are unchanged", () => {
  it("the store-term rule's percent replaces the bands; rounding and the nets still come from the house rule", () => {
    const eff = resolveEffectiveRule(offWhite(), makeVariant("v", 100), makeConfig([GENERAL, nike(25)]))!;
    expect(eff.markupRuleId).toBe("cat-nike");
    expect(eff.markupPercent).toBe(25);
    expect(eff.markupBands).toBeUndefined();
    expect(eff.rounding).toEqual({ mode: "charm", increment: 0.99 });
    expect(eff.minMarginFixed).toBe(20);
    expect(eff.outlierFloorPercent).toBe(40);
    expect(eff.minDeltaPercent).toBe(3);
    expect(eff.matchedRuleIds).toEqual(["general", "cat-nike"]);
    // 100 € ask: 25 % → 125,99, not the house 35 % band (135,99).
    expect(priceOf(offWhite(), [GENERAL, nike(25)])).toBe(125.99);
    // A cheap ask: 25 % of 44 € is 11 €, under the guaranteed 20 € margin.
    expect(priceOf(offWhite(), [GENERAL, nike(25)], 44)).toBe(64.99);
  });

  it("a net the store-term rule sets itself wins over the house one, field by field", () => {
    const own = rule({ id: "cat-nike", scope: { storeCategory: 11 }, markupPercent: 25, minMarginFixed: 5 });
    expect(priceOf(offWhite(), [GENERAL, own], 44)).toBe(55.99); // 44 × 1.25 = 55, the 5 € net already met
  });

  it("a catalog-axis rule's nets still merge under a store-term margin", () => {
    const brandNet = rule({ id: "jordan-floor", scope: { brand: "Jordan" }, floor: 200 });
    const eff = resolveEffectiveRule(offWhite(), makeVariant("v", 100), makeConfig([GENERAL, nike(25), brandNet]))!;
    expect(eff.markupRuleId).toBe("cat-nike");
    expect(eff.floor).toBe(200);
  });

  it("a fixed € store-term margin replaces a percent", () => {
    const fixed = rule({ id: "cat-fixed", scope: { storeBrand: 30 }, markupFixed: 40 });
    expect(priceOf(offWhite(), [GENERAL, fixed])).toBe(140.99);
  });
});

describe("in a plan", () => {
  it("the sync writes the store-term price, a lock still wins, and a sale is still held", () => {
    const product = offWhite({ variants: [makeVariant("a", 100), makeVariant("b", 100), makeVariant("c", 100)] });
    const mapping = (id: string, extra: object = {}) => ({
      stockxVariantId: id,
      storeProductId: 1,
      storeVariationId: id.charCodeAt(0),
      currentPrice: 135.99,
      ...extra,
    });
    const plan = buildPlan(
      product,
      makeConfig([GENERAL, nike(25)]),
      new Map([
        ["a", mapping("a")],
        ["b", mapping("b", { manualPrice: 150 })],
        ["c", mapping("c", { saleActive: true })],
      ]),
    );
    const byId = new Map(plan.items.map((i) => [i.stockxVariantId, i]));
    expect(byId.get("a")).toMatchObject({ action: "update", proposedPrice: 125.99 });
    expect(byId.get("b")).toMatchObject({ action: "update", proposedPrice: 150, locked: true });
    expect(byId.get("c")).toMatchObject({ action: "skip", reason: "discounted — sale price preserved" });
  });
});

describe("other rule lists that order by specificity", () => {
  it("the taxonomy rules: a SKU rule outranks a heavier catalog-axis combination", () => {
    const taxonomy: TaxonomyConfig = {
      useSourceTree: [],
      defaultCategory: "Sneakers",
      write: { brandTaxonomy: true, brandAttribute: true, genderAttribute: true },
      rules: [
        {
          id: "heavy",
          enabled: true,
          scope: { category: "Air Jordan", secondaryCategory: "One", model: "Retro" },
          category: "Jordan 1",
        },
        { id: "sku", enabled: true, scope: { sku: "CT8012-047" }, category: "Edizioni limitate" },
      ],
    };
    const axes = { ...makeProduct([]), category: "Air Jordan", secondaryCategory: "One", model: "Air Jordan 1 Retro" };
    expect(resolveCategoryPath(axes, taxonomy)).toEqual(["Edizioni limitate"]);
  });
});
