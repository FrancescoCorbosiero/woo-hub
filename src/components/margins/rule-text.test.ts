import { describe, expect, it } from "vitest";
import type { ScopedPricingRule } from "@core/config";
import type { CatalogTerm } from "@/lib/vetrina/catalog";
import { it as itDict } from "@/i18n/dictionaries/it";
import { en as enDict } from "@/i18n/dictionaries/en";
import {
  findStoreTermRule,
  pickableTerms,
  ruleLabel,
  ruledTermIds,
  scopeSummary,
  storeTermScope,
  storeTermsOf,
} from "./rule-text";

const t = itDict.margins;

const rule = (id: string, scope: ScopedPricingRule["scope"]): ScopedPricingRule => ({
  id,
  scope,
  enabled: true,
  markupPercent: 25,
});

const term = (taxonomy: CatalogTerm["taxonomy"], id: number, path: string, count = 1): CatalogTerm => ({
  taxonomy,
  id,
  name: path.split(" › ").pop() ?? path,
  slug: path.toLowerCase(),
  parent: 0,
  path,
  children: [],
  count,
  soldOut: 0,
  hidden: 0,
  onSale: 0,
  sections: [],
  automatic: null,
});

describe("ruleLabel", () => {
  it("names a store category's or brand's rule by the name it was saved with", () => {
    expect(ruleLabel(rule("r1", { storeCategory: 12, storeTermName: "Saldi" }), 1, t)).toBe(
      "Categoria del negozio «Saldi»",
    );
    expect(ruleLabel(rule("r2", { storeBrand: 7, storeTermName: "Nike" }), 2, t)).toBe("Brand del negozio «Nike»");
    expect(ruleLabel(rule("r2", { storeBrand: 7, storeTermName: "Nike" }), 2, enDict.margins)).toBe(
      "Store brand “Nike”",
    );
  });

  it("falls back to the term's id when no name was kept", () => {
    expect(ruleLabel(rule("r1", { storeCategory: 12 }), 0, t)).toBe("Categoria del negozio n. 12");
    expect(ruleLabel(rule("r1", { storeCategory: 12, storeTermName: "  " }), 0, t)).toBe(
      "Categoria del negozio n. 12",
    );
  });

  it("leads with the store term and keeps the axes that narrow it", () => {
    expect(ruleLabel(rule("r1", { storeBrand: 7, storeTermName: "Nike", sizeMin: 36, sizeMax: 40 }), 0, t)).toBe(
      "Brand del negozio «Nike» · 36–40",
    );
  });

  it("is not mistaken for the GoldenSneakers list by a source it would never match", () => {
    expect(ruleLabel(rule("r1", { storeCategory: 12, storeTermName: "Saldi", source: "goldensneakers" }), 0, t)).toBe(
      "Categoria del negozio «Saldi»",
    );
    expect(ruleLabel(rule("r1", { source: "goldensneakers" }), 0, t)).toBe(t.gsRule);
  });

  it("keeps the labels of the other rules as they were", () => {
    expect(ruleLabel(rule("general", {}), 0, t)).toBe(t.generalRule);
    expect(ruleLabel(rule("r1", { brand: "Nike", category: "Jordan", secondaryCategory: "Retro" }), 0, t)).toBe(
      "Nike · Jordan › Retro",
    );
    expect(ruleLabel(rule("r1", {}), 3, t)).toBe("Regola 4");
  });
});

describe("scopeSummary", () => {
  it("says a store term covers its sub-terms, and KicksDB-priced products only", () => {
    expect(scopeSummary({ storeCategory: 12, storeTermName: "Saldi" }, t)).toBe(
      "categoria del negozio «Saldi» con le sue sotto-categorie, solo i prodotti col prezzo da KicksDB",
    );
    expect(scopeSummary({ storeBrand: 7 }, t)).toBe(
      "brand del negozio n. 7 con i suoi sotto-brand, solo i prodotti col prezzo da KicksDB",
    );
  });

  it("tells the shop's brand from the catalog's", () => {
    expect(scopeSummary({ brand: "Nike" }, t)).toBe("brand «Nike»");
    expect(scopeSummary({}, t)).toBe(t.sumEverything);
  });
});

describe("storeTermsOf", () => {
  it("gives the one kept name to the category when a rule names both", () => {
    expect(storeTermsOf({ storeCategory: 1, storeBrand: 2, storeTermName: "Saldi" })).toEqual([
      { taxonomy: "category", id: 1, name: "Saldi" },
      { taxonomy: "brand", id: 2, name: null },
    ]);
    expect(storeTermsOf({ brand: "Nike" })).toEqual([]);
  });
});

describe("storeTermScope", () => {
  it("writes the picked term, clears the other taxonomy and keeps the path as the label", () => {
    expect(storeTermScope(term("brand", 9, "Nike › Off-White"))).toEqual({
      storeCategory: undefined,
      storeBrand: 9,
      storeTermName: "Nike › Off-White",
    });
  });

  it("bounds the label as the server does", () => {
    expect(storeTermScope(term("category", 1, "x".repeat(250))).storeTermName).toHaveLength(200);
  });
});

describe("findStoreTermRule", () => {
  const rules = [
    rule("general", {}),
    rule("sized", { storeCategory: 12, sizeMin: 36 }),
    rule("saldi", { storeCategory: 12, storeTermName: "Saldi" }),
    rule("nike", { storeBrand: 12 }),
  ];

  it("finds the rule that is exactly the term, label aside", () => {
    expect(findStoreTermRule(rules, "category", 12)?.id).toBe("saldi");
    expect(findStoreTermRule(rules, "brand", 12)?.id).toBe("nike");
  });

  it("does not count a narrower rule on the term, nor the other taxonomy's id", () => {
    expect(findStoreTermRule([rules[1]], "category", 12)).toBeUndefined();
    expect(findStoreTermRule(rules, "category", 99)).toBeUndefined();
  });

  it("ignores fields an edit cleared", () => {
    expect(findStoreTermRule([rule("a", { storeCategory: 3, brand: undefined })], "category", 3)?.id).toBe("a");
  });
});

describe("ruledTermIds", () => {
  it("collects the terms rules name, per taxonomy", () => {
    const rules = [rule("a", { storeCategory: 1 }), rule("b", { storeBrand: 2, sizeMin: 40 }), rule("c", {})];
    expect([...ruledTermIds(rules, "category")]).toEqual([1]);
    expect([...ruledTermIds(rules, "brand")]).toEqual([2]);
  });
});

describe("pickableTerms", () => {
  const terms = [
    term("category", 3, "Saldi › Nike"),
    term("category", 4, "Sneakers"),
    term("category", 1, "Saldi"),
    term("category", 5, "Saldi Estivi"),
  ];

  it("lists terms in tree order, a sub-term right under its parent", () => {
    expect(pickableTerms(terms, "").map((x) => x.id)).toEqual([1, 3, 5, 4]);
  });

  it("finds a term by any part of its path, case aside", () => {
    expect(pickableTerms(terms, " NIKE ").map((x) => x.id)).toEqual([3]);
    expect(pickableTerms(terms, "saldi").map((x) => x.id)).toEqual([1, 3, 5]);
  });
});
