import { describe, expect, it } from "vitest";
import type { ScopedPricingRule } from "@core/config";
import type { SourceProduct, SourceVariant, StoreTermRef } from "@core/core-spine";
import { makeConfig, makeVariant, rule } from "@core/__tests__/helpers";
import {
  assessMarginSubject,
  findTermMarginRule,
  freshRuleId,
  isTermMarginRule,
  marginPriceWords,
  sameRule,
  summarizeMargin,
  termMarginOf,
  termScope,
  undoTermMargin,
  withTermMargin,
  type MarginOutcome,
  type MarginSubject,
} from "./margin-plan";
import { keptForTerm, labelParams, labelText } from "./plan";
import { words } from "./words";

/**
 * "Cambia il ricarico", decided: the term's own rule in the list, setting,
 * replacing and removing it, its undo, and what it does to prices — with
 * the real engine, so each price below is the one the reprice writes.
 *
 * The store's trees: categories 10 Sneakers › 11 Nike › 12 Nike Off-White;
 * brands 30 Nike.
 */

const plain = (text: string) => text.replace(/ /g, " ");
const terms = (...pairs: [number, number][]): StoreTermRef[] => pairs.map(([id, depth]) => ({ id, depth }));
const NIKE = { taxonomy: "category" as const, id: 11 };
const OFF_WHITE = { taxonomy: "category" as const, id: 12 };

/** The house rule as shipped, trimmed: the 35 % band up to 150 €, charm rounding, the €20 net. */
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
});
const GS = rule({
  id: "goldensneakers-passthrough",
  scope: { source: "goldensneakers" },
  markupPercent: 0,
  markupBands: [],
  rounding: { mode: "none" },
  minMarginFixed: 0,
});
const nikeRule = (percent: number, over: Partial<ScopedPricingRule> = {}): ScopedPricingRule =>
  rule({
    id: "store-category-11",
    scope: { storeCategory: 11, storeTermName: "Nike" },
    markupPercent: percent,
    ...over,
  });

/** A KicksDB-priced product filed under Sneakers › Nike › Off-White, sizes at these asks. */
function product(asks: number[], over: Partial<SourceProduct> = {}): SourceProduct {
  return {
    stockxId: "p1",
    sku: "DD1391-100",
    title: "Nike Dunk Low",
    brand: "Nike",
    image: "",
    market: "IT",
    currency: "EUR",
    variants: asks.map((ask, i) => makeVariant(`v${i}`, ask)),
    storeCategories: terms([10, 0], [11, 1], [12, 2]),
    storeBrands: terms([30, 0]),
    ...over,
  };
}

/** The product's sizes, those at these positions locked, or on a sale the product follows. */
const subject = (p: SourceProduct, locked: number[] = [], onSale: number[] = []): MarginSubject => ({
  product: p,
  sizes: p.variants.map((variant: SourceVariant, i) => ({ variant, locked: locked.includes(i), onSale: onSale.includes(i) })),
});

describe("the term's own margin rule", () => {
  it("is the rule scoped to exactly the term — its name a label; anything narrower is the operator's", () => {
    expect(termScope(NIKE, " Nike ")).toEqual({
      storeCategory: 11,
      storeTermName: "Nike",
    });
    expect(termScope({ taxonomy: "brand", id: 30 }, "")).toEqual({
      storeBrand: 30,
    });
    expect(isTermMarginRule(nikeRule(25), NIKE)).toBe(true);
    expect(isTermMarginRule(rule({ id: "a", scope: { storeCategory: 11 } }), NIKE)).toBe(true);
    // Another term, the other taxonomy, or narrower: not the term's margin.
    expect(isTermMarginRule(nikeRule(25), OFF_WHITE)).toBe(false);
    expect(isTermMarginRule(rule({ id: "b", scope: { storeBrand: 11 } }), NIKE)).toBe(false);
    expect(isTermMarginRule(rule({ id: "c", scope: { storeCategory: 11, sizeMin: 40 } }), NIKE)).toBe(false);
    expect(isTermMarginRule(rule({ id: "d", scope: { storeCategory: 11, storeBrand: 30 } }), NIKE)).toBe(false);
    expect(isTermMarginRule(GENERAL, NIKE)).toBe(false);
  });

  it("is the last of two alike: the later one is the one that prices", () => {
    const rules = [GENERAL, nikeRule(20, { id: "first" }), GS, nikeRule(30, { id: "second" })];
    expect(findTermMarginRule(rules, NIKE)).toEqual({
      rule: rules[3],
      index: 3,
    });
    expect(findTermMarginRule(rules, OFF_WHITE)).toBeNull();
  });

  it("reads as its own margin, else a term above it's, with the standard beside", () => {
    const ancestors = [
      { id: 11, name: "Nike" },
      { id: 10, name: "Sneakers" },
    ];
    expect(termMarginOf([GENERAL, GS], OFF_WHITE, ancestors)).toEqual({
      own: null,
      inherited: null,
      standard: { kind: "bands" },
    });
    expect(termMarginOf([GENERAL, nikeRule(25)], OFF_WHITE, ancestors)).toEqual({
      own: null,
      inherited: { term: "Nike", value: { kind: "percent", percent: 25 } },
      standard: { kind: "bands" },
    });
    // Its own first; the one above it still said, as where "Torna allo standard" leads.
    const own = rule({
      id: "ow",
      scope: { storeCategory: 12 },
      markupFixed: 30,
    });
    expect(termMarginOf([GENERAL, nikeRule(25), own], OFF_WHITE, ancestors)).toEqual({
      own: { kind: "fixed", amount: 30 },
      inherited: { term: "Nike", value: { kind: "percent", percent: 25 } },
      standard: { kind: "bands" },
    });
    // Switched off on the Margins tab: the engine skips it, and so does the row.
    expect(termMarginOf([GENERAL, nikeRule(25, { enabled: false })], NIKE, []).own).toBeNull();
  });
});

describe("setting and removing it", () => {
  it("appends a new rule that states only the margin — never in the general rule's place", () => {
    const change = withTermMargin([GENERAL, GS], NIKE, "Nike", 25);
    expect(change.before).toBeNull();
    expect(change.after).toEqual({
      id: "store-category-11",
      scope: { storeCategory: 11, storeTermName: "Nike" },
      enabled: true,
      markupPercent: 25,
    });
    expect(change.rules).toEqual([GENERAL, GS, change.after]);
    expect(change.index).toBe(2);
  });

  it("changes the term's rule where it stands, keeping what is not the margin, switched on, percent alone", () => {
    const tuned = nikeRule(0, {
      enabled: false,
      markupBands: [{ upTo: null, percent: 10 }],
      markupFixed: 5,
      rounding: { mode: "integer" },
    });
    delete tuned.markupPercent;
    const rules = [GENERAL, tuned, GS];
    const change = withTermMargin(rules, NIKE, "Nike (scarpe)", 30);
    expect(change.index).toBe(1);
    expect(change.before).toBe(tuned);
    expect(change.after).toEqual({
      id: "store-category-11",
      scope: { storeCategory: 11, storeTermName: "Nike (scarpe)" },
      enabled: true,
      markupPercent: 30,
      rounding: { mode: "integer" },
    });
    expect(change.rules).toEqual([GENERAL, change.after, GS]);
  });

  it("removed, a rule the operator gave nets on the Margins tab keeps them: only its margin goes", () => {
    const tuned = nikeRule(25, { rounding: { mode: "integer" }, minMarginFixed: 15 });
    const rules = [GENERAL, tuned, GS];
    const change = withTermMargin(rules, NIKE, "Nike", null);
    expect(change.after).toEqual({ id: "store-category-11", scope: tuned.scope, enabled: true, rounding: { mode: "integer" }, minMarginFixed: 15 });
    expect(change.rules).toEqual([GENERAL, change.after, GS]);
    // No margin of its own any more: the row reads the one above it, or the standard.
    expect(termMarginOf(change.rules, NIKE, []).own).toBeNull();
    // Taking away a margin it no longer has changes nothing.
    const again = withTermMargin(change.rules, NIKE, "Nike", null);
    expect(sameRule(again.before, again.after)).toBe(true);
    // "Annulla" puts the margin back on it.
    const undo = undoTermMargin(change.rules, NIKE, change);
    expect(undo).toEqual({ verdict: "restore", rules: [GENERAL, tuned, GS] });
    // Set again, it takes the percent and keeps the nets.
    expect(withTermMargin(change.rules, NIKE, "Nike", 30).after).toMatchObject({ markupPercent: 30, minMarginFixed: 15 });
  });

  it("removes it — and removing none changes nothing", () => {
    const rules = [GENERAL, nikeRule(25), GS];
    expect(withTermMargin(rules, NIKE, "Nike", null)).toEqual({
      rules: [GENERAL, GS],
      before: rules[1],
      after: null,
      index: 1,
    });
    expect(withTermMargin([GENERAL], NIKE, "Nike", null)).toEqual({
      rules: [GENERAL],
      before: null,
      after: null,
      index: -1,
    });
  });

  it("gives a new rule an id no other rule has", () => {
    expect(freshRuleId([GENERAL], "store-category-11")).toBe("store-category-11");
    expect(freshRuleId([GENERAL, rule({ id: "store-category-11" }), rule({ id: "store-category-11-2" })], "store-category-11")).toBe(
      "store-category-11-3",
    );
  });
});

describe("undoing it", () => {
  it("takes back a new rule, a change, a removal — only while the rule is what the action left", () => {
    const added = withTermMargin([GENERAL, GS], NIKE, "Nike", 25);
    expect(undoTermMargin(added.rules, NIKE, added)).toEqual({
      verdict: "restore",
      rules: [GENERAL, GS],
    });

    const changed = withTermMargin([GENERAL, nikeRule(20), GS], NIKE, "Nike", 30);
    expect(undoTermMargin(changed.rules, NIKE, changed)).toEqual({
      verdict: "restore",
      rules: [GENERAL, nikeRule(20), GS],
    });

    const removed = withTermMargin([GENERAL, nikeRule(20), GS], NIKE, "Nike", null);
    expect(undoTermMargin(removed.rules, NIKE, removed)).toEqual({
      verdict: "restore",
      rules: [GENERAL, nikeRule(20), GS],
    });
    // Put back where it was, even with rules added after it since.
    expect(undoTermMargin([...removed.rules, rule({ id: "x" })], NIKE, removed)).toEqual({
      verdict: "restore",
      rules: [GENERAL, nikeRule(20), GS, rule({ id: "x" })],
    });
  });

  it("leaves a rule changed since alone, and one already as before", () => {
    const changed = withTermMargin([GENERAL, nikeRule(20)], NIKE, "Nike", 30);
    // The owner set 35 % since (or the operator edited it on the Margins tab).
    expect(undoTermMargin([GENERAL, nikeRule(35)], NIKE, changed)).toEqual({
      verdict: "changed",
    });
    // Removed meanwhile: not the action's to bring back.
    expect(undoTermMargin([GENERAL], NIKE, changed)).toEqual({
      verdict: "changed",
    });
    // Already at 20 % again.
    expect(undoTermMargin([GENERAL, nikeRule(20)], NIKE, changed)).toEqual({
      verdict: "already",
    });
    const added = withTermMargin([GENERAL], NIKE, "Nike", 25);
    expect(undoTermMargin([GENERAL], NIKE, added)).toEqual({
      verdict: "already",
    });
  });

  it("compares rules field by field, whatever order the stored JSON keeps", () => {
    const stored = JSON.parse(
      '{"markupPercent":25,"enabled":true,"scope":{"storeTermName":"Nike","storeCategory":11},"id":"store-category-11"}',
    );
    expect(sameRule(stored, nikeRule(25))).toBe(true);
    expect(sameRule(stored, nikeRule(26))).toBe(false);
    expect(sameRule(null, null)).toBe(true);
    expect(sameRule(null, nikeRule(25))).toBe(false);
  });
});

describe("what it does to prices (the engine's own)", () => {
  const current = makeConfig([GENERAL, GS]);
  const added = withTermMargin(current.pricingRules, NIKE, "Nike", 25);
  const draft = makeConfig(added.rules);
  const ids = { current: null, draft: added.after!.id };

  it("prices the term's KicksDB products by the draft: 100 € ask, house 35 % → 135,99, Nike 25 % → 125,99", () => {
    const outcome = assessMarginSubject(subject(product([100, 100])), current, draft, ids);
    expect(outcome).toEqual({
      kind: "covered",
      before: [135.99, 135.99],
      after: [125.99, 125.99],
      lockedSizes: 0,
      saleSizes: 0,
    });
  });

  it("a sub-category's product counts too; a locked size keeps its price and is counted apart", () => {
    const outcome = assessMarginSubject(subject(product([100, 200]), [1]), current, draft, ids);
    expect(outcome).toEqual({
      kind: "covered",
      before: [135.99],
      after: [125.99],
      lockedSizes: 1,
      saleSizes: 0,
    });
  });

  it("a size on sale keeps its regular price while the sale lasts — a locked one on sale keeps its lock", () => {
    const outcome = assessMarginSubject(subject(product([100, 100, 100]), [2], [1, 2]), current, draft, ids);
    expect(outcome).toEqual({ kind: "covered", before: [135.99], after: [125.99], lockedSizes: 1, saleSizes: 1 });
    // Every size on sale: the margin decides it, but no price moves now.
    const held = assessMarginSubject(subject(product([100]), [], [0]), current, draft, ids);
    expect(held).toEqual({ kind: "covered", before: [], after: [], lockedSizes: 0, saleSizes: 1 });
    expect(summarizeMargin([held])).toMatchObject({ applies: 1, same: 1, saleSizes: 1, averageChange: null });
  });

  it("never prices a supplier's product, nor one a more specific rule takes", () => {
    const feed = product([100], { source: "goldensneakers" });
    expect(assessMarginSubject(subject(feed), current, draft, ids)).toEqual({
      kind: "otherRule",
    });
    const sku = makeConfig([...added.rules, rule({ id: "sku", scope: { sku: "DD1391-100" }, markupPercent: 50 })]);
    expect(assessMarginSubject(subject(product([100])), makeConfig([GENERAL, GS, sku.pricingRules[3]]), sku, ids)).toEqual({
      kind: "otherRule",
    });
    // Off-White's own margin outranks Nike's for Off-White's products.
    const deeper = rule({
      id: "ow",
      scope: { storeCategory: 12 },
      markupPercent: 40,
    });
    const withDeeper = makeConfig([GENERAL, GS, deeper, added.after!]);
    expect(assessMarginSubject(subject(product([100])), makeConfig([GENERAL, GS, deeper]), withDeeper, ids)).toEqual({
      kind: "otherRule",
    });
  });

  it("a product the market gives no price for is left as it is", () => {
    const empty = product([100], {
      variants: [{ ...makeVariant("v", 0), offers: [] }],
    });
    expect(assessMarginSubject(subject(empty), current, draft, ids)).toEqual({
      kind: "noQuote",
    });
  });

  it("back to the standard: the term's rule now is the one that decides", () => {
    const nike = makeConfig([GENERAL, GS, nikeRule(25)]);
    const back = withTermMargin(nike.pricingRules, NIKE, "Nike", null);
    const outcome = assessMarginSubject(subject(product([100])), nike, makeConfig(back.rules), {
      current: "store-category-11",
      draft: null,
    });
    expect(outcome).toEqual({
      kind: "covered",
      before: [125.99],
      after: [135.99],
      lockedSizes: 0,
      saleSizes: 0,
    });
  });

  it("moves a size only as the sync's plan would: from what the store shows, past the minimum change, never over a WordPress edit", () => {
    // The store shows the house price; the Hub wrote it.
    const shown = (p: SourceProduct, price: number, hubPrice: number | null = price): MarginSubject => ({
      product: p,
      sizes: p.variants.map((variant) => ({ variant, locked: false, store: { price, hubPrice } })),
    });
    const guarded = (pct: number, over: Partial<ScopedPricingRule> = {}) => {
      const rules = withTermMargin([rule({ ...GENERAL, minDeltaPercent: 3, ...over }), GS], NIKE, "Nike", pct);
      return makeConfig(rules.rules);
    };
    const base = makeConfig([rule({ ...GENERAL, minDeltaPercent: 3 }), GS]);
    const id = (cfg: ReturnType<typeof makeConfig>) => ({ current: null, draft: cfg.pricingRules[2].id });

    // 25 %: 125,99 against the 135,99 shown — a real move, from the store's price.
    const big = guarded(25);
    expect(assessMarginSubject(shown(product([100]), 135.99), base, big, id(big))).toEqual({
      kind: "covered",
      before: [135.99],
      after: [125.99],
      lockedSizes: 0,
      saleSizes: 0,
    });
    // 34 %: 134,99 against 135,99 — under the house's 3 % minimum change: the sync leaves it.
    const small = guarded(34);
    const within = assessMarginSubject(shown(product([100]), 135.99), base, small, id(small));
    expect(within).toEqual({
      kind: "covered",
      before: [],
      after: [],
      lockedSizes: 0,
      saleSizes: 0,
      guard: { belowMin: 1, overMax: 0, edited: 0 },
    });
    expect(summarizeMargin([within])).toMatchObject({ applies: 1, same: 1, up: 0, down: 0, belowMinSizes: 1 });
    // Past the maximum change: blocked, as the plan blocks it.
    const capped = guarded(100, { maxDeltaPercent: 20 });
    expect(assessMarginSubject(shown(product([100]), 135.99), base, capped, id(capped))).toMatchObject({
      before: [],
      guard: { overMax: 1 },
    });
    // Changed on WordPress since the Hub wrote it: kept.
    expect(assessMarginSubject(shown(product([100]), 140, 135.99), base, big, id(big))).toMatchObject({
      before: [],
      guard: { edited: 1 },
    });
    // Already at the new price: the same, and nothing guarded.
    expect(assessMarginSubject(shown(product([100]), 125.99), base, big, id(big))).toEqual({
      kind: "covered",
      before: [125.99],
      after: [125.99],
      lockedSizes: 0,
      saleSizes: 0,
    });
  });

  it("counts up, down and the same, and the average change of each product's prices", () => {
    const outcomes: MarginOutcome[] = [
      {
        kind: "covered",
        before: [100, 100],
        after: [110, 110],
        lockedSizes: 0,
        saleSizes: 0,
      }, // +10 %
      { kind: "covered", before: [200], after: [180], lockedSizes: 1, saleSizes: 0 }, // −10 %
      { kind: "covered", before: [150], after: [150], lockedSizes: 0, saleSizes: 2 },
      { kind: "covered", before: [], after: [], lockedSizes: 2, saleSizes: 0 }, // every size locked
      { kind: "otherRule" },
      { kind: "noQuote" },
    ];
    expect(summarizeMargin(outcomes)).toEqual({
      applies: 4,
      up: 1,
      down: 1,
      same: 2,
      averageChange: 0,
      lockedSizes: 3,
      saleSizes: 2,
      belowMinSizes: 0,
      overMaxSizes: 0,
      editedSizes: 0,
      otherRule: 1,
      noQuote: 1,
    });
    expect(summarizeMargin([{ kind: "covered", before: [135.99], after: [125.99], lockedSizes: 0, saleSizes: 0 }]).averageChange).toBe(-7.4);
    expect(summarizeMargin([]).averageChange).toBeNull();
  });

  it("says a product's prices as a sale's preview does: the lowest, «da» when sizes differ", () => {
    const w = words("it");
    const same = marginPriceWords(
      {
        kind: "covered",
        before: [135.99, 135.99],
        after: [125.99, 125.99],
        lockedSizes: 0,
        saleSizes: 0,
      },
      w,
    );
    expect(plain(same.before)).toBe("135,99 €");
    expect(plain(same.after)).toBe("125,99 €");
    const mixed = marginPriceWords(
      {
        kind: "covered",
        before: [135.99, 270.99],
        after: [125.99, 250.99],
        lockedSizes: 0,
        saleSizes: 0,
      },
      w,
    );
    expect(plain(mixed.before)).toBe("da 135,99 €");
    expect(plain(mixed.after)).toBe("da 125,99 €");
  });
});

describe("in the log", () => {
  it("is filed under its term, but goes after 30 days: what stands is the rule, not the row", () => {
    const row = {
      kind: "margin" as const,
      status: "done" as const,
      changed: 3,
      undoneAt: null,
      termKey: "category:11",
    };
    expect(keptForTerm(row)).toBe(false);
    expect(keptForTerm({ ...row, kind: "hide" })).toBe(true);
  });

  it("names the margin and the term — or the standard it went back to", () => {
    const w = words("it");
    const set = labelParams({ kind: "margin", taxonomy: "category", termId: 11, percent: 25 }, { count: 34, term: "Nike" });
    expect(set).toEqual({
      kind: "margin",
      count: 34,
      term: "Nike",
      percent: 25,
    });
    expect(labelText(set, w)).toBe("Ricarico 25% · Nike");
    const back = labelParams({ kind: "margin", taxonomy: "brand", termId: 30, percent: null }, { count: 3, term: "Nike" });
    expect(back).toEqual({ kind: "margin", count: 3, term: "Nike" });
    // Taken away: the label says so, never "standard" — a term above may be where it goes back to.
    expect(labelText(back, w)).toBe("Ricarico tolto · Nike");
    expect(labelText(back, words("en"))).toBe("Own margin removed · Nike");
  });
});
