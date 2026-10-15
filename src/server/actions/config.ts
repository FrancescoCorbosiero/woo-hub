"use server";

import { z } from "zod";
import type { AppConfig, ScopedPricingRule } from "@core/config";
import { MAX_PRICING_RULES, resolveEffectiveRule, scopeTargetsSizes, winningMarkupRuleId } from "@core/config";
import type { SourceProduct, SourceVariant } from "@core/core-spine";
import { computePrice } from "@core/core-spine";
import { listProductScopeAxes } from "@/server/catalog/repo";
import { getActiveConfig, updateActiveConfig } from "@/server/config/repo";
import { buildDefaultConfig } from "@/server/config/defaults";
import { pricingRulesVersion } from "@/server/config/rule-list";
import { activeFeedSkus, GS_FEED } from "@/server/feeds/repo";
import { getOverrides } from "@/server/overrides/repo";
import { skusPinnedTo } from "@/server/overrides/model";
import { withStoreTerms } from "@/server/pricing/store-terms";
import { demoMode } from "@/server/collections/store";
import { skuKey } from "@/lib/skus";
import { pricingSummary, type PricingSummary } from "@/server/config/summary";

/**
 * Restore the DEFAULT margin from defaults.ts — the dynamic banded catch-all
 * and the GoldenSneakers passthrough — and keep every scoped rule the operator
 * wrote. Reset lives on a bar that edits the general rule, so it must mean
 * "put the default back", not "delete the Yeezy Foam rule I built last week".
 */
export async function resetPricingToDefaults(): Promise<PricingSummary> {
  // One locked read-modify-write: a scoped rule saved a moment ago (a
  // category's margin from the Vetrina) is among the ones kept.
  const fresh = await updateActiveConfig((current) => {
    const kept = current.pricingRules.filter(
      (r) => Object.keys(r.scope).length > 0 && r.scope.source !== "goldensneakers",
    );
    const defaults = buildDefaultConfig(current.connection);
    return { ...defaults, pricingRules: [...defaults.pricingRules, ...kept] };
  });
  return pricingSummary(fresh);
}

const PricingInputSchema = z.object({
  markupPercent: z.number().min(0).max(1000),
  vatRatePercent: z.number().min(0).max(100),
  roundingMode: z.enum(["none", "integer", "charm", "nearest"]),
  increment: z.number().min(0).optional(),
  minAsks: z.number().int().min(0),
  minDeltaPercent: z.number().min(0).max(100),
});
export type PricingInput = z.infer<typeof PricingInputSchema>;

/** Update the general pricing rule (markup / VAT / rounding / minAsks / min delta) and save. */
export async function updatePricing(
  input: PricingInput,
): Promise<{ ok: boolean; error?: string; summary?: PricingSummary }> {
  const parsed = PricingInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const d = parsed.data;

  try {
    // Into the list as it is now, under the config's lock: only the general
    // rule's fields change, and every other rule stays as the last writer left it.
    const cfg = await updateActiveConfig((current) => {
      const cfg = structuredClone(current);
      const rule = cfg.pricingRules[0] ?? {
        id: "general",
        scope: {},
        enabled: true,
        sourceDeliveryType: "standard" as const,
      };
      rule.markupPercent = d.markupPercent;
      // Saving an explicit flat markup switches banded pricing off — the operator
      // chose a single percent. "Reset" restores the banded defaults.
      delete rule.markupBands;
      rule.minAsks = d.minAsks;
      // 0 = off (reprice on any change) — stored as absence, like maxDeltaPercent.
      if (d.minDeltaPercent > 0) rule.minDeltaPercent = d.minDeltaPercent;
      else delete rule.minDeltaPercent;
      rule.rounding = {
        mode: d.roundingMode,
        ...(d.increment != null ? { increment: d.increment } : {}),
      };
      // VAT is added on top ONLY when the operator sets a rate here; 0 means the
      // markup is the total uplift (VAT inside the price) — the banded default.
      rule.tax = { priceIncludesVat: d.vatRatePercent > 0, vatRatePercent: d.vatRatePercent };
      if (cfg.pricingRules.length === 0) cfg.pricingRules.push(rule);
      return cfg;
    });
    return { ok: true, summary: pricingSummary(cfg) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------------------------------------------------ */
/* Margin rules admin (/pricing): full CRUD over the scoped rule list  */
/* ------------------------------------------------------------------ */

const ScopeSchema = z.object({
  source: z.string().max(64).optional(),
  brand: z.string().max(128).optional(),
  // The catalog's navigation axes — a rule scoped to a product FAMILY.
  category: z.string().max(128).optional(),
  secondaryCategory: z.string().max(128).optional(),
  model: z.string().max(128).optional(),
  sku: z.string().max(64).optional(),
  sizeType: z.string().max(32).optional(),
  sizeMin: z.number().min(0).max(100).optional(),
  sizeMax: z.number().min(0).max(100).optional(),
  // The shop's own category or brand (WooCommerce term ids) — a margin set
  // from the Vetrina, or on the Margins tab. The name is a label only.
  storeCategory: z.number().int().positive().optional(),
  storeBrand: z.number().int().positive().optional(),
  storeTermName: z.string().max(200).optional(),
});

const BandSchema = z.object({
  upTo: z.number().positive().nullable(),
  percent: z.number().min(-100).max(1000),
});

const RuleSchema = z.object({
  id: z.string().min(1).max(64),
  enabled: z.boolean(),
  scope: ScopeSchema,
  sourceDeliveryType: z.enum(["standard", "express_standard", "express_expedited"]).optional(),
  markupPercent: z.number().min(-100).max(1000).optional(),
  markupFixed: z.number().min(-10000).max(10000).optional(),
  markupBands: z.array(BandSchema).max(20).optional(),
  floor: z.number().min(0).optional(),
  minAsks: z.number().int().min(0).optional(),
  rounding: z
    .object({
      mode: z.enum(["none", "integer", "charm", "nearest"]),
      increment: z.number().min(0).optional(),
    })
    .optional(),
  tax: z
    .object({ priceIncludesVat: z.boolean(), vatRatePercent: z.number().min(0).max(100) })
    .optional(),
  minDeltaPercent: z.number().min(0).max(100).optional(),
  maxDeltaPercent: z.number().min(0).max(1000).optional(),
  outlierFloorPercent: z.number().min(0).max(100).optional(),
  minMarginFixed: z.number().min(0).max(10000).optional(),
});

const RulesSchema = z.array(RuleSchema).min(1).max(MAX_PRICING_RULES);

/** Strip empty-string scope fields so "" never over-constrains a rule. */
function cleanScope(scope: z.infer<typeof ScopeSchema>): ScopedPricingRule["scope"] {
  const out: ScopedPricingRule["scope"] = {};
  if (scope.source?.trim()) out.source = scope.source.trim();
  if (scope.brand?.trim()) out.brand = scope.brand.trim();
  if (scope.category?.trim()) out.category = scope.category.trim();
  if (scope.secondaryCategory?.trim()) out.secondaryCategory = scope.secondaryCategory.trim();
  if (scope.model?.trim()) out.model = scope.model.trim();
  if (scope.sku?.trim()) out.sku = scope.sku.trim().toUpperCase();
  if (scope.sizeType?.trim()) out.sizeType = scope.sizeType.trim();
  if (scope.sizeMin != null) out.sizeMin = scope.sizeMin;
  if (scope.sizeMax != null) out.sizeMax = scope.sizeMax;
  // Kept through every save: dropping them would turn a category's margin
  // into a rule on the whole shop.
  if (scope.storeCategory != null) out.storeCategory = scope.storeCategory;
  if (scope.storeBrand != null) out.storeBrand = scope.storeBrand;
  if ((out.storeCategory != null || out.storeBrand != null) && scope.storeTermName?.trim()) {
    out.storeTermName = scope.storeTermName.trim();
  }
  return out;
}

export interface SaveRulesResult {
  ok: boolean;
  error?: string;
  /**
   * Refused because the list changed since the editor loaded it (a margin set
   * from the Vetrina, the pricing bar, another tab): nothing was written, and
   * the editor must reload rather than save over the newer list.
   */
  stale?: boolean;
  /**
   * Refused because it names a store category or brand no saved rule named,
   * while the Vetrina runs on its demo shop: the picker offered the demo's
   * ids, which are not the real shop's.
   */
  demo?: boolean;
  /** The list as saved — as the next read returns it. */
  rules?: ScopedPricingRule[];
  /** Its fingerprint (pricingRulesVersion): what the editor sends with its next save. */
  version?: string;
}

/** How many catalog products each rule actually sets the margin for. */
export interface RuleCoverage {
  ruleId: string;
  products: number;
  /** The rule only covers part of each product (it names sizes). */
  sizeScoped: boolean;
  /** What the engine really charges for a product this rule owns: ask → shelf price. */
  examples: { ask: number; price: number | null }[];
}

/** The asks a rule is previewed at — one per band of the default ladder. */
const SAMPLE_ASKS = [100, 300, 600];

/**
 * A product that matches THIS rule and nothing narrower: every axis the scope
 * constrains is filled from the scope, everything else left generic. Resolving
 * against it produces the same effective rule a real product of that family
 * gets — inherited rounding, VAT and safety nets included — so the preview is
 * the engine's own answer rather than a re-implementation of it.
 */
function sampleProductFor(rule: ScopedPricingRule): SourceProduct {
  const s = rule.scope;
  return {
    stockxId: "sample",
    sku: s.sku ?? "SAMPLE-000",
    title: s.model ?? "Sample Product",
    brand: s.brand ?? "Sample",
    image: "",
    market: "IT",
    currency: "EUR",
    ...(s.source ? { source: s.source } : {}),
    ...(s.category ? { category: s.category } : {}),
    ...(s.secondaryCategory ? { secondaryCategory: s.secondaryCategory } : {}),
    // Filed under the rule's own store term (its depth does not matter: no
    // other store term is on the sample to compete with it).
    ...(s.storeCategory != null ? { storeCategories: [{ id: s.storeCategory, depth: 0 }] } : {}),
    ...(s.storeBrand != null ? { storeBrands: [{ id: s.storeBrand, depth: 0 }] } : {}),
    variants: [],
  };
}

function sampleVariantFor(rule: ScopedPricingRule, ask: number): SourceVariant {
  const s = rule.scope;
  const size = s.sizeMin ?? s.sizeMax ?? 42;
  return {
    stockxVariantId: "sample",
    sizeLabel: String(size),
    sizeType: s.sizeType ?? "eu",
    // Deep enough that a minAsks threshold never blanks the preview.
    offers: [{ deliveryType: "standard", lowestAsk: ask, asks: 999 }],
  };
}

/** Run the engine over a synthetic product of the rule's own family. */
function ruleExamples(
  rule: ScopedPricingRule,
  rules: ScopedPricingRule[],
  cfg: AppConfig,
): { ask: number; price: number | null }[] {
  const product = sampleProductFor(rule);
  const probeConfig: AppConfig = { ...cfg, pricingRules: rules };
  return SAMPLE_ASKS.map((ask) => {
    const variant = sampleVariantFor(rule, ask);
    const effective = resolveEffectiveRule(product, variant, probeConfig);
    return { ask, price: effective ? computePrice(variant, effective) : null };
  });
}

/**
 * The catalog's products, each with the source that really prices it. A row
 * KicksDB registered keeps "kicksdb" even when the supplier feed owns the
 * product (src/server/feeds/owner.ts): counted as such, a rule the engine
 * never applies to it — a store category's margin, which feed prices never
 * take — would claim it. Feed coverage minus the products pinned back to
 * KicksDB, as the sync decides; best-effort, like the read it refines.
 */
async function pricedByOwner(market: string): Promise<Awaited<ReturnType<typeof listProductScopeAxes>>> {
  const [axes, feed, overrides] = await Promise.all([
    listProductScopeAxes(market),
    activeFeedSkus(GS_FEED),
    getOverrides().catch(() => null),
  ]);
  if (feed.size === 0) return axes;
  const feedSkus = new Set([...feed].map(skuKey));
  const pinned = new Set((overrides ? skusPinnedTo(overrides, "kicksdb") : []).map(skuKey));
  return axes.map((p) => {
    const key = skuKey(p.sku);
    return feedSkus.has(key) && !pinned.has(key) && p.source !== GS_FEED ? { ...p, source: GS_FEED } : p;
  });
}

/**
 * Answer "is this rule doing anything?" against the real catalog. A rule that
 * covers 0 products is either shadowed by a more specific one or scoped to
 * something no product matches — and until now both looked exactly like a
 * working rule. Counted per product on identity alone; the size-scoped ones
 * are flagged rather than silently counted as whole-product coverage.
 */
export async function pricingRuleCoverage(
  rulesInput?: unknown,
): Promise<{ total: number; coverage: RuleCoverage[] }> {
  const cfg = await getActiveConfig();
  // The editor passes its UNSAVED list so the numbers track what you are
  // typing; anything unparseable falls back to what is actually stored.
  const parsed = rulesInput != null ? RulesSchema.safeParse(rulesInput) : null;
  const rules = (parsed?.success ? (parsed.data as ScopedPricingRule[]) : cfg.pricingRules) ?? [];

  const axes = await withStoreTerms(await pricedByOwner(cfg.source.market), rules);
  const counts = new Map<string, number>();
  for (const p of axes) {
    const id = winningMarkupRuleId(p, rules);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return {
    total: axes.length,
    coverage: rules.map((r) => ({
      ruleId: r.id,
      products: counts.get(r.id) ?? 0,
      sizeScoped: scopeTargetsSizes(r.scope),
      examples: ruleExamples(r, rules, cfg),
    })),
  };
}

/** "category:12", "brand:7" — each store term the rules name. */
function storeTermKeys(rules: readonly ScopedPricingRule[]): Set<string> {
  const out = new Set<string>();
  for (const r of rules) {
    if (r.scope.storeCategory != null) out.add(`category:${r.scope.storeCategory}`);
    if (r.scope.storeBrand != null) out.add(`brand:${r.scope.storeBrand}`);
  }
  return out;
}

/** True when `next` names a store term `current` does not — a rule added, or moved to another term. */
function namesNewStoreTerm(next: readonly ScopedPricingRule[], current: readonly ScopedPricingRule[]): boolean {
  const known = storeTermKeys(current);
  return [...storeTermKeys(next)].some((k) => !known.has(k));
}

const RulesVersion = z.string().regex(/^[0-9a-f]{16}$/);

/**
 * Replace the whole pricing-rule list (the margins editor saves everything at
 * once — rules are one document, and partial saves would allow half-edited
 * precedence). Everything else in the config is left untouched.
 *
 * `version` is the fingerprint of the list the editor loaded (or last saved).
 * The list has other editors — the Vetrina sets a category's or a brand's
 * margin from the phone, the pricing bar the general rule — and a tab opened
 * before one of them and saved after would silently drop (or bring back)
 * what they did. So the save is refused, nothing written, when the stored
 * list no longer has that fingerprint: the operator reloads and sees it.
 * Checked and written under the config's lock, so nothing lands in between.
 */
export async function savePricingRules(input: unknown, version: string): Promise<SaveRulesResult> {
  const parsed = RulesSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}` };
  }
  // A fingerprint is 16 hex characters (pricingRulesVersion): anything else is no list this editor loaded.
  if (!RulesVersion.safeParse(version).success) return { ok: false, stale: true };

  const rules: ScopedPricingRule[] = parsed.data.map((r) => ({
    id: r.id,
    scope: cleanScope(r.scope),
    enabled: r.enabled,
    ...(r.sourceDeliveryType != null ? { sourceDeliveryType: r.sourceDeliveryType } : {}),
    // A rule is percent- OR fixed- OR bands-driven; the editor enforces one,
    // the server keeps whichever fields arrived non-null.
    ...(r.markupPercent != null ? { markupPercent: r.markupPercent } : {}),
    ...(r.markupFixed != null ? { markupFixed: r.markupFixed } : {}),
    ...(r.markupBands != null ? { markupBands: r.markupBands } : {}),
    ...(r.floor != null ? { floor: r.floor } : {}),
    ...(r.minAsks != null ? { minAsks: r.minAsks } : {}),
    ...(r.rounding != null ? { rounding: r.rounding } : {}),
    ...(r.tax != null ? { tax: r.tax } : {}),
    ...(r.minDeltaPercent != null ? { minDeltaPercent: r.minDeltaPercent } : {}),
    ...(r.maxDeltaPercent != null ? { maxDeltaPercent: r.maxDeltaPercent } : {}),
    ...(r.outlierFloorPercent != null ? { outlierFloorPercent: r.outlierFloorPercent } : {}),
    ...(r.minMarginFixed != null ? { minMarginFixed: r.minMarginFixed } : {}),
  }));

  try {
    let refused: "stale" | "demo" | null = null;
    const saved = await updateActiveConfig((current) => {
      if (pricingRulesVersion(current.pricingRules) !== version) {
        refused = "stale";
        return null;
      }
      if (demoMode() && namesNewStoreTerm(rules, current.pricingRules)) {
        refused = "demo";
        return null;
      }
      return { ...current, pricingRules: rules };
    });
    if (refused === "stale") return { ok: false, stale: true };
    if (refused === "demo") return { ok: false, demo: true };
    return { ok: true, rules: saved.pricingRules, version: pricingRulesVersion(saved.pricingRules) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
