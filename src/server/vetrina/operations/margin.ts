import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AppConfig, ProductScopeAxes } from "@core/config";
import { winningMarkupRuleId } from "@core/config";
import type { SourceProduct } from "@core/core-spine";
import type { MarginPreview, OperationInput, OperationPreview, TermMarginState } from "@/lib/vetrina/catalog-ops";
import { skuKey } from "@/lib/skus";
import { getAnyBySkus } from "@/server/catalog/repo";
import { requestCheck } from "@/server/collections/runner";
import { demoMode } from "@/server/collections/store";
import { getActiveConfig, saveActiveConfig } from "@/server/config/repo";
import { db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { catalogProducts, storeIndex, type OperationUndoOutcome, type VetrinaOperationRow } from "@/server/db/schema";
import { activeFeedSkus, GS_FEED } from "@/server/feeds/repo";
import { followSaleRuleFor, manualPriceFor, skusPinnedTo, type StoreOverrides } from "@/server/overrides/model";
import { getOverrides } from "@/server/overrides/repo";
import { forgetStoreTerms, skusUnderStoreTerm, withStoreTerms } from "@/server/pricing/store-terms";
import { resolveFromModel, sourceEuSize } from "@/server/store-json/match";
import { getSnapshotInfo, getSnapshotProductsBySkus } from "@/server/store-json/repo";
import { runPriceSync } from "@/server/sync/price-sync";
import { ancestorIds, readCatalogTrees, type CatalogTrees } from "@/server/vetrina/catalog";
import { VetrinaError } from "@/server/vetrina/source";
import { chunks, termKeyOf } from "./context";
import { messageOf } from "./live";
import {
  assessMarginSubject,
  findTermMarginRule,
  marginMove,
  marginPriceWords,
  sameRule,
  summarizeMargin,
  termMarginOf,
  undoTermMargin,
  withTermMargin,
  type MarginOutcome,
  type MarginSubject,
  type MarginTerm,
} from "./margin-plan";
import { bump, labelParams, reasonCounts, type Reason } from "./plan";
import type { Assessment } from "./preview";
import * as repo from "./repo";
import type { RunCtx } from "./writes";
import { words, type Words } from "./words";

/**
 * "Cambia il ricarico" (docs/vetrina-catalog.md §3.4): a category's or a
 * brand's margin, as a pricing rule scoped to the store term
 * (RuleScope.storeCategory / storeBrand) in the Hub's own rule list — then
 * the term's products repriced by the ordinary sync, which reads the store
 * before writing (runPriceSync with the live check): a lock, a sale price,
 * a price changed on WordPress stand exactly as against every other sync
 * (§3.2). The engine keeps the margin on every sync after.
 *
 * It acts on the products the Hub prices from the market (KicksDB) only: a
 * supplier's price (GoldenSneakers) already holds the supplier's margin and
 * passes through, and a store-only product has no Hub price at all — the
 * engine never lets a store-term rule match either (core/config.ts), and
 * the preview says how many it leaves.
 *
 * The preview computes each product's prices with the engine itself, under
 * the rules in force and under the draft, for the same market prices; the
 * apply saves the rule (filing the one it replaced, for "Annulla") and walks
 * the term's products through the sync a slice at a time, so the progress
 * pill moves.
 */

/** Products a preview names. */
const SAMPLE = 20;
/** Products whose catalog entries (every size's market prices) a preview holds at once. */
const READ_CHUNK = 200;
/**
 * Products whose store sizes a preview reads at once: each read unrolls the
 * whole snapshot in SQL whatever it asks for, so as few reads as memory
 * allows — a term's sizes are a few megabytes at most.
 */
const SNAPSHOT_CHUNK = 2000;
/** SKUs per reprice step: the sync plans them in one step, and the pill moves after each. */
const REPRICE_CHUNK = 100;

type Input = Extract<OperationInput, { kind: "margin" }>;
type Owner = "market" | "supplier" | "store";

const termOf = (input: Pick<Input, "taxonomy" | "termId">): MarginTerm => ({
  taxonomy: input.taxonomy,
  id: input.termId,
});
const storeScope = (term: MarginTerm) => (term.taxonomy === "category" ? { storeCategory: term.id } : { storeBrand: term.id });

/** The term's name now, and its ancestors' (the nearest first); refused when the store no longer has it. */
function termFacts(trees: CatalogTrees, term: MarginTerm, w: Words): { name: string; ancestors: { id: number; name: string }[] } {
  const tree = trees[term.taxonomy];
  const name = tree.terms.get(term.id)?.name;
  if (!name) throw new VetrinaError("not_found", w.error.termGone, 404);
  const ancestors = ancestorIds(term.id, tree.parents)
    .reverse()
    .map((id) => ({ id, name: tree.terms.get(id)?.name ?? `#${id}` }));
  return { name, ancestors };
}

/* ---------------------------------------------------------------- *
 * Who prices the term's products
 * ---------------------------------------------------------------- */

interface TermProducts {
  /** The term's SKUs the Hub prices from the market: all a margin here acts on. */
  market: string[];
  supplier: number;
  storeOnly: number;
  /** The catalog's light row of each market SKU: what the rule a product falls under is decided on. */
  axes: Map<string, ProductScopeAxes>;
  overrides: StoreOverrides | null;
}

/** The catalog's identity columns for these SKUs (canonical, as the catalog keys them) — no jsonb. */
async function catalogAxes(market: string, skus: readonly string[]): Promise<Map<string, ProductScopeAxes>> {
  const out = new Map<string, ProductScopeAxes>();
  for (const part of chunks(skus, 1000)) {
    const rows = await db
      .select({
        sku: catalogProducts.sku,
        title: catalogProducts.title,
        brand: catalogProducts.brand,
        source: catalogProducts.source,
        category: catalogProducts.category,
        secondaryCategory: catalogProducts.secondaryCategory,
        model: catalogProducts.model,
      })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.market, market), inArray(catalogProducts.sku, [...part])));
    for (const r of rows) out.set(r.sku, r);
  }
  return out;
}

/**
 * The term's products — its sub-terms' included, as the store index files
 * them — by who prices them, as the sync and the Margins tab's coverage
 * decide it: the supplier's feed owns what it lists (unless a product was
 * handed back to KicksDB); a SKU the catalog does not hold from a source is
 * store-only; the rest the Hub prices from the market.
 */
async function termProducts(term: MarginTerm, market: string): Promise<TermProducts> {
  const skus = [...new Set((await skusUnderStoreTerm(storeScope(term))).map(skuKey))];
  const [rows, feed, overrides] = await Promise.all([catalogAxes(market, skus), activeFeedSkus(GS_FEED), getOverrides().catch(() => null)]);
  const feedSkus = new Set([...feed].map(skuKey));
  const pinned = new Set((overrides ? skusPinnedTo(overrides, "kicksdb") : []).map(skuKey));
  const owner = (sku: string): Owner => {
    if (feedSkus.has(sku) && !pinned.has(sku)) return "supplier";
    const row = rows.get(sku);
    if (!row || row.source === "woo") return "store";
    return ((row.source ?? "").trim().toLowerCase() || "kicksdb") === "kicksdb" ? "market" : "supplier";
  };
  const out: TermProducts = {
    market: [],
    supplier: 0,
    storeOnly: 0,
    axes: new Map(),
    overrides,
  };
  for (const sku of skus) {
    const who = owner(sku);
    if (who === "supplier") out.supplier += 1;
    else if (who === "store") out.storeOnly += 1;
    else {
      out.market.push(sku);
      out.axes.set(sku, rows.get(sku)!);
    }
  }
  return out;
}

/**
 * Of the term's market products, those its margin decides — the margin it
 * has, or the one it would get (the same rule, set) — where no more
 * specific rule takes them; judged per product, as the Margins tab counts.
 */
async function appliesTo(products: TermProducts, config: AppConfig, term: MarginTerm, name: string): Promise<number> {
  if (products.market.length === 0) return 0;
  // Any percent: who a rule prices does not depend on its margin.
  const change = withTermMargin(config.pricingRules, term, name, 0);
  const axes = await withStoreTerms([...products.axes.values()], change.rules);
  return axes.filter((a) => winningMarkupRuleId(a, change.rules) === change.after!.id).length;
}

async function marginState(
  config: AppConfig,
  term: MarginTerm,
  facts: { name: string; ancestors: { id: number; name: string }[] },
  products: TermProducts,
  applies: number | null,
): Promise<TermMarginState> {
  return {
    ...termMarginOf(config.pricingRules, term, facts.ancestors),
    priced: products.market.length,
    applies: applies ?? (await appliesTo(products, config, term, facts.name)),
    supplier: products.supplier,
    storeOnly: products.storeOnly,
  };
}

/** A category's or brand's margin, for its screen's "Ricarico" row. */
export async function loadTermMargin(input: Pick<Input, "taxonomy" | "termId">): Promise<TermMarginState> {
  const w = words();
  const term = termOf(input);
  const [trees, config] = await Promise.all([readCatalogTrees(), getActiveConfig()]);
  const facts = termFacts(trees, term, w);
  return marginState(config, term, facts, await termProducts(term, config.source.market), null);
}

/* ---------------------------------------------------------------- *
 * Preview
 * ---------------------------------------------------------------- */

/** Why it cannot be applied, in the owner's words; null when it can. */
async function refusalOf(input: Input, config: AppConfig, name: string, w: Words): Promise<string | null> {
  // The demo shop's terms are not the Hub's: a rule on one of their ids
  // would land on the real shop's products filed under the same id.
  if (demoMode()) return w.error.marginDemo;
  const own = findTermMarginRule(config.pricingRules, termOf(input))?.rule ?? null;
  if (input.percent == null && !own) return w.error.marginNone(name);
  if (input.percent != null && own?.enabled && own.markupPercent === input.percent && own.markupBands == null && own.markupFixed == null) {
    return w.error.marginSame(name, input.percent);
  }
  // The sync writes to the variations it matched in the snapshot: without one, nothing can be repriced.
  if ((await getSnapshotInfo()) == null) return w.error.marginNoSnapshot;
  return null;
}

/**
 * The sizes the shop sells of a product (all of the source's when the
 * snapshot does not hold it), with their locks and — where the product
 * follows the sale rule — the sizes on sale, whose regular price the plan holds.
 */
function subjectOf(
  product: SourceProduct,
  store: Awaited<ReturnType<typeof getSnapshotProductsBySkus>>,
  overrides: StoreOverrides | null,
): MarginSubject {
  const sold = store.has(skuKey(product.sku)) ? resolveFromModel(store, product) : null;
  const followsSales = overrides ? followSaleRuleFor(overrides, product.sku) : true;
  return {
    product,
    sizes: product.variants
      .filter((v) => sold == null || sold.has(v.stockxVariantId))
      .map((variant) => {
        const eu = sourceEuSize(variant);
        return {
          variant,
          locked: overrides != null && eu != null && manualPriceFor(overrides, product.sku, eu) != null,
          onSale: followsSales && sold?.get(variant.stockxVariantId)?.saleActive === true,
        };
      }),
  };
}

/** The shop's names and ids of these SKUs, from the store index: what the preview's sample shows. */
async function indexNames(skus: readonly string[]): Promise<Map<string, { id: number; name: string }>> {
  const out = new Map<string, { id: number; name: string }>();
  if (skus.length === 0) return out;
  const res = await db.execute(sql`
    select ${storeIndex.productId} as "id", ${storeIndex.name} as "name", upper(trim(${storeIndex.sku})) as "key"
    from ${storeIndex}
    where upper(trim(${storeIndex.sku})) in (select jsonb_array_elements_text(${JSON.stringify(skus)}::jsonb))
  `);
  for (const r of rowsOf<{ id: number; name: string; key: string }>(res)) if (!out.has(r.key)) out.set(r.key, r);
  return out;
}

/**
 * What the margin would do (`live`), or — for an action starting — only
 * what its label, its refusals and its progress need, without pricing the
 * term's products again.
 */
export async function assessMargin(input: Input, opts: { live: boolean }): Promise<Assessment> {
  const w = words();
  const term = termOf(input);
  const termKey = termKeyOf(term.taxonomy, term.id);
  // Read afresh: a product moved into the term a moment ago (a categorize
  // action patches the index at once) belongs to it now.
  forgetStoreTerms();
  const [trees, config] = await Promise.all([readCatalogTrees(), getActiveConfig()]);
  const facts = termFacts(trees, term, w);
  const refusal = await refusalOf(input, config, facts.name, w);
  const products = await termProducts(term, config.source.market);
  const label = labelParams(input, {
    count: products.market.length,
    term: facts.name,
  });
  // The rule saved first, then each product: never zero steps, so a margin
  // on a term the Hub prices nothing of can still be removed.
  const total = products.market.length + 1;

  const untouched = new Map<Reason, number>();
  bump(untouched, w.untouched.supplier, products.supplier);
  bump(untouched, w.untouched.storeOnly, products.storeOnly);
  if (!opts.live || refusal) {
    const preview: OperationPreview = {
      kind: "margin",
      changes: 0,
      untouched: reasonCounts(untouched),
      sample: [],
      warnings: refusal ? [refusal] : [],
    };
    return { preview, label, termKey, total, refusal };
  }

  const change = withTermMargin(config.pricingRules, term, facts.name, input.percent);
  const draft: AppConfig = { ...config, pricingRules: change.rules };
  const ids = {
    current: change.before?.enabled ? change.before.id : null,
    draft: change.after?.id ?? null,
  };
  // Every store-term rule of either list reads the products' terms.
  const termRules = [...config.pricingRules, ...change.rules];
  const outcomes: MarginOutcome[] = [];
  const moved: {
    sku: string;
    outcome: Extract<MarginOutcome, { kind: "covered" }>;
    change: number;
  }[] = [];
  for (const slice of chunks(products.market, SNAPSHOT_CHUNK)) {
    const store = await getSnapshotProductsBySkus(slice);
    for (const part of chunks(slice, READ_CHUNK)) {
      const catalog = await getAnyBySkus(config.source.market, part);
      const priced = await withStoreTerms([...catalog.values()], termRules);
      for (const product of priced) {
        const outcome = assessMarginSubject(subjectOf(product, store, products.overrides), config, draft, ids);
        outcomes.push(outcome);
        if (outcome.kind === "covered" && marginMove(outcome) !== "same") {
          const before = outcome.before.reduce((s, p) => s + p, 0);
          const after = outcome.after.reduce((s, p) => s + p, 0);
          moved.push({
            sku: skuKey(product.sku),
            outcome,
            change: before > 0 ? Math.abs(after / before - 1) : 0,
          });
        }
      }
    }
  }
  const summary = summarizeMargin(outcomes);
  bump(untouched, w.untouched.otherRule, summary.otherRule);
  bump(untouched, w.untouched.noQuote, summary.noQuote);

  // The products the margin moves most, first: where it bites is what the owner weighs.
  const shown = moved.sort((a, b) => b.change - a.change).slice(0, SAMPLE);
  const names = await indexNames(shown.map((m) => m.sku));
  const sample = shown.map((m, i) => ({
    id: names.get(m.sku)?.id ?? -(i + 1),
    name: names.get(m.sku)?.name || m.sku,
    ...marginPriceWords(m.outcome, w),
  }));

  const warnings = [
    summary.lockedSizes > 0 ? w.warning.lockedSizes(summary.lockedSizes) : null,
    summary.saleSizes > 0 ? w.warning.saleSizes(summary.saleSizes) : null,
  ].filter((text): text is string => text != null);
  const margin: MarginPreview = {
    percent: input.percent,
    current: await marginState(config, term, facts, products, summary.applies),
    applies: summary.applies,
    up: summary.up,
    down: summary.down,
    same: summary.same,
    averageChange: summary.averageChange,
    lockedSizes: summary.lockedSizes,
    saleSizes: summary.saleSizes,
  };
  return {
    preview: {
      kind: "margin",
      changes: summary.up + summary.down,
      untouched: reasonCounts(untouched),
      sample,
      warnings,
      margin,
    },
    label,
    termKey,
    total,
    refusal: null,
  };
}

/* ---------------------------------------------------------------- *
 * Apply and undo
 * ---------------------------------------------------------------- */

/** What a reprice did: products whose prices it wrote, sizes the store refused, products the market did not answer for. */
interface Repriced {
  written: number;
  refused: number;
  unanswered: number;
}

/**
 * The term's market products through the ordinary sync, a slice at a time:
 * plan with the rules as saved now, read each product again, write, record
 * (runPriceSync with the live check, docs §3.2). A slice that cannot be
 * planned or written stops the run: the rule stands, and the next sync
 * aligns the prices. Products KicksDB did not answer for (an outage the
 * sync rides out when the supplier's feed is in play) are counted, not
 * written: the next sync prices them.
 */
async function repriceTerm(ctx: RunCtx, term: MarginTerm, market: string): Promise<Repriced> {
  const w = words();
  const { market: skus } = await termProducts(term, market);
  ctx.tally.total = skus.length + 1;
  ctx.tally.done = 1;
  await ctx.step();
  const out: Repriced = { written: 0, refused: 0, unanswered: 0 };
  try {
    for (const part of chunks(skus, REPRICE_CHUNK)) {
      let synced: Awaited<ReturnType<typeof runPriceSync>>;
      try {
        synced = await runPriceSync({ skus: part, liveCheck: true });
      } catch (e) {
        throw new VetrinaError("failed", w.error.repriceFailed(messageOf(e)));
      }
      const { outcome, report } = synced;
      if (outcome && outcome.updated > 0) out.written += outcome.products;
      out.refused += outcome?.failedTotal ?? 0;
      out.unanswered += report.stats?.unanswered ?? 0;
      ctx.tally.done += part.length;
      await ctx.step();
    }
  } finally {
    // The index learns the new prices, and the automatic categories whose
    // rule reads a price look again — after a run stopped half-way too.
    if (out.written > 0) requestCheck();
  }
  return out;
}

/**
 * "Applica": the term's rule set (or removed), the one it replaces filed
 * first — before the save, like every value an action changes, so a run
 * cut off right after it stays undoable — then the reprice.
 */
export async function runMargin(ctx: RunCtx, input: Input): Promise<void> {
  const w = words();
  if (demoMode()) throw new VetrinaError("invalid", w.error.marginDemo, 400);
  const term = termOf(input);
  const { name } = termFacts(await readCatalogTrees(), term, w);
  // A product moved into the term a moment ago is repriced with it.
  forgetStoreTerms();
  const config = await getActiveConfig();
  const change = withTermMargin(config.pricingRules, term, name, input.percent);
  const ruleChanged = !sameRule(change.before, change.after);
  if (ruleChanged) {
    await repo.fileMarginRecord(ctx.op.id, change);
    await saveActiveConfig({ ...config, pricingRules: change.rules });
    // The rule is a change of its own: "Annulla" is offered even when no price had to move.
    ctx.tally.changed = 1;
  }
  const { written, refused, unanswered } = await repriceTerm(ctx, term, config.source.market);
  ctx.tally.changed = Math.max(ctx.tally.changed, written);
  ctx.tally.failed = refused;
  // Saved, but prices the owner expects to see moved did not: said, rather
  // than a "done" over prices that have not changed. It stays undoable.
  if (unanswered > 0) throw new VetrinaError("failed", w.error.repriceUnanswered(unanswered));
}

/** The term's name for an undo: the store's now, else the one the label kept (a term deleted since still has its rule taken back). */
async function undoName(op: VetrinaOperationRow, term: MarginTerm): Promise<string> {
  try {
    return termFacts(await readCatalogTrees(), term, words()).name;
  } catch {
    return op.labelParams?.term || `#${term.id}`;
  }
}

/**
 * Refused before an undo is queued, as a homepage pin's undo is when its
 * section changed since: the term's rule is no longer what the action left
 * — someone set it again, here or on the Hub's Margins tab — and that newer
 * word stands.
 */
export async function checkMarginUndo(op: VetrinaOperationRow): Promise<void> {
  if (op.input.kind !== "margin") return;
  const record = await repo.marginRecordOf(op.id);
  if (!record) return;
  const term = termOf(op.input);
  const config = await getActiveConfig();
  if (undoTermMargin(config.pricingRules, term, record).verdict === "changed") {
    throw new VetrinaError("stale", words().error.marginChanged(await undoName(op, term)), 409);
  }
}

/**
 * "Annulla": the rule from before put back (or the new one removed) — only
 * while the term's rule is still what the action left — then the reprice
 * again. Products whose prices it wrote back count as restored. Products
 * the market did not answer for are left to the next sync: the rule is
 * back either way, which is what the undo is about.
 */
export async function undoMargin(ctx: RunCtx): Promise<OperationUndoOutcome> {
  const input = ctx.op.input;
  if (input.kind !== "margin") return { restored: 0, kept: 0, failed: 0 };
  const term = termOf(input);
  const record = await repo.marginRecordOf(ctx.op.id);
  forgetStoreTerms();
  const config = await getActiveConfig();
  if (record) {
    const undo = undoTermMargin(config.pricingRules, term, record);
    if (undo.verdict === "changed") {
      throw new VetrinaError("stale", words().error.marginChanged(await undoName(ctx.op, term)), 409);
    }
    if (undo.verdict === "restore") await saveActiveConfig({ ...config, pricingRules: undo.rules });
  }
  const { written, refused } = await repriceTerm(ctx, term, config.source.market);
  return { restored: written, kept: 0, failed: refused };
}
