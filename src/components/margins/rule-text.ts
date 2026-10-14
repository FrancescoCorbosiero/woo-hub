import type { RuleScope, ScopedPricingRule } from "@core/config";
import type { Dictionary } from "@/i18n/dictionary";
import type { CatalogTaxonomy, CatalogTerm } from "@/lib/vetrina/catalog";

/**
 * The Margins tab's words for a rule — its card title and the "Copre:"
 * sentence — and the small decisions behind the store-term picker. Pure, so
 * the claims a card makes about a rule are tested rather than eyeballed.
 */

type Words = Dictionary["margins"];

/** A term of the shop's own categories or brands, as a rule names it. */
export interface RuleStoreTerm {
  taxonomy: CatalogTaxonomy;
  id: number;
  /** The name kept when the rule was saved; null when none was. */
  name: string | null;
}

/**
 * The store terms a scope names. One label is kept per rule, so when a rule
 * names both a category and a brand (possible in a hand-written config, never
 * made here) the name goes with the category and the brand shows by id.
 */
export function storeTermsOf(scope: RuleScope): RuleStoreTerm[] {
  const name = scope.storeTermName?.trim() || null;
  const out: RuleStoreTerm[] = [];
  if (scope.storeCategory != null) out.push({ taxonomy: "category", id: scope.storeCategory, name });
  if (scope.storeBrand != null) {
    out.push({ taxonomy: "brand", id: scope.storeBrand, name: scope.storeCategory != null ? null : name });
  }
  return out;
}

/** "Categoria del negozio «Saldi»" — the rule's store term as its title says it. */
export function storeTermLabel(term: RuleStoreTerm, t: Words): string {
  return term.taxonomy === "category" ? t.storeCategoryRule(term.name, term.id) : t.storeBrandRule(term.name, term.id);
}

/** The card's title: what the rule is about, in the fewest words. */
export function ruleLabel(rule: ScopedPricingRule, index: number, t: Words): string {
  if (rule.id === "general") return t.generalRule;
  if (rule.id === "goldensneakers-passthrough") return t.gsRule;
  const s = rule.scope;
  // A store term leads: it is what the owner set the margin on, and the
  // other axes, when present, only narrow it.
  const store = storeTermsOf(s).map((term) => storeTermLabel(term, t));
  if (store.length === 0 && s.source === "goldensneakers") return t.gsRule;
  const family = [s.category, s.secondaryCategory].filter(Boolean).join(" › ");
  const bits = [
    ...store,
    s.brand,
    family || null,
    s.model && `“${s.model}”`,
    s.sku,
    s.sizeMin != null || s.sizeMax != null ? `${s.sizeMin ?? ""}–${s.sizeMax ?? ""}` : null,
  ].filter(Boolean);
  return bits.length > 0 ? bits.join(" · ") : t.customRule(index + 1);
}

/**
 * The scope as a sentence. A rule is a claim about which products it governs,
 * and reading that claim off six separate inputs is exactly the step where an
 * operator mistakes a name filter for a family one — or a catalog brand for
 * the shop's own brand.
 */
export function scopeSummary(scope: RuleScope, t: Words): string {
  const bits: string[] = [];
  const store = storeTermsOf(scope);
  for (const term of store) {
    bits.push(term.taxonomy === "category" ? t.sumStoreCategory(term.name, term.id) : t.sumStoreBrand(term.name, term.id));
  }
  if (scope.source) bits.push(t.sumSource(scope.source));
  if (scope.brand) bits.push(t.sumBrand(scope.brand));
  if (scope.category) {
    bits.push(
      scope.secondaryCategory
        ? t.sumFamilyPair(scope.category, scope.secondaryCategory)
        : t.sumFamily(scope.category),
    );
  } else if (scope.secondaryCategory) {
    bits.push(t.sumFamily(scope.secondaryCategory));
  }
  if (scope.model) bits.push(t.sumName(scope.model));
  if (scope.sku) bits.push(t.sumSku(scope.sku));
  if (scope.sizeMin != null || scope.sizeMax != null) {
    bits.push(t.sumSizes(scope.sizeMin ?? null, scope.sizeMax ?? null));
  }
  // The exclusion the engine makes on its own (core/config.ts storeTermsPrice):
  // said here, or a category's count would read as "every product in it".
  if (store.length > 0) bits.push(t.sumKicksOnly);
  return bits.length === 0 ? t.sumEverything : t.sumJoin(bits);
}

/** The scope fields a store term is written as; the other taxonomy cleared. */
export function storeTermScope(term: Pick<CatalogTerm, "taxonomy" | "id" | "path">): Partial<RuleScope> {
  return {
    storeCategory: term.taxonomy === "category" ? term.id : undefined,
    storeBrand: term.taxonomy === "brand" ? term.id : undefined,
    // The path, not the bare name: "Saldi › Nike" and a top-level "Nike"
    // are different categories, and the label is all a card or the drawer
    // has to tell them apart. Bounded as the server bounds it.
    storeTermName: term.path.slice(0, 200),
  };
}

/** Scope keys that are only a label, never a filter. */
const LABEL_KEYS = new Set<keyof RuleScope>(["storeTermName"]);

/**
 * The rule that is exactly "this store term" — nothing narrower on it — so
 * choosing the term again leads to that rule instead of adding a twin the
 * list order would silently decide between.
 */
export function findStoreTermRule(
  rules: readonly ScopedPricingRule[],
  taxonomy: CatalogTaxonomy,
  id: number,
): ScopedPricingRule | undefined {
  const key: keyof RuleScope = taxonomy === "category" ? "storeCategory" : "storeBrand";
  return rules.find((r) => {
    if (r.scope[key] !== id) return false;
    return (Object.keys(r.scope) as (keyof RuleScope)[]).every(
      (k) => k === key || LABEL_KEYS.has(k) || r.scope[k] == null,
    );
  });
}

/** Ids of the terms of one taxonomy some rule already names. */
export function ruledTermIds(rules: readonly ScopedPricingRule[], taxonomy: CatalogTaxonomy): Set<number> {
  const ids = new Set<number>();
  for (const r of rules) {
    const id = taxonomy === "category" ? r.scope.storeCategory : r.scope.storeBrand;
    if (id != null) ids.add(id);
  }
  return ids;
}

/** Compare two "A › B" paths level by level, so a sub-term sits right under its parent. */
function comparePaths(a: string, b: string): number {
  const as = a.split(" › ");
  const bs = b.split(" › ");
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const c = as[i].localeCompare(bs[i], "it", { sensitivity: "base" });
    if (c !== 0) return c;
  }
  return as.length - bs.length;
}

/** The picker's rows: the terms whose path holds the query, in tree order. */
export function pickableTerms(terms: readonly CatalogTerm[], query: string): CatalogTerm[] {
  const q = query.trim().toLocaleLowerCase();
  return terms
    .filter((term) => !q || term.path.toLocaleLowerCase().includes(q))
    .sort((a, b) => comparePaths(a.path, b.path));
}
