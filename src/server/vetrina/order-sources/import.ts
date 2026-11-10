import "server-only";
import { skuKey as catalogKey } from "@/lib/skus";
import type { OrderSourceItem, SourceLookup, SourceImport } from "@/lib/vetrina/order-sources";
import { getSource as kicksdb, kicksdbConfigured } from "@/server/adapters/kicksdb";
import { getAnyBySkus } from "@/server/catalog/repo";
import { growCatalogFromSkus } from "@/server/catalog/service";
import { requestCheck } from "@/server/collections/runner";
import { dbCatalogStore } from "@/server/catalog/store";
import { demoMode } from "@/server/collections/store";
import { getActiveConfig } from "@/server/config/repo";
import { words } from "@/server/vetrina/operations/words";
import { VetrinaError } from "@/server/vetrina/source";
import { wooConfigured } from "@/server/woo/client";
import { publishProducts } from "@/server/woo/publish";
import { isWriter, NOT_WRITER } from "@/server/writer";
import { catalogSpellings, closest } from "./compare-model";
import { getSource } from "./service";

/**
 * The products a source names that the shop lacks, brought in
 * (docs/order-sources.md, "Importare i mancanti"): found on KicksDB — by SKU,
 * or by name for an item that has none (a page's titles rarely show the
 * style code) — and published through Publish itself, as its tab does: the
 * same checks (a product the store already has is left alone), the same
 * prices (the engine's, the margins'), the photos queued. A SKU KicksDB does
 * not confirm is never published.
 */

/** Items looked up per request: each is a KicksDB search. */
export const MAX_LOOKUP = 10;
/** SKUs imported per request: each is a product made on the store, its sizes and photos. */
export const MAX_IMPORT = 25;
function lookupReady(): void {
  if (demoMode()) throw new VetrinaError("invalid", words().source.importDemo, 400);
  if (!kicksdbConfigured()) throw new VetrinaError("not_configured", words().source.kicksdbOff, 503);
}

/** One item's KicksDB products: by its SKU when it has one (one exact answer), else by its name. */
async function lookupOne(item: OrderSourceItem, market: string, source: ReturnType<typeof kicksdb>) {
  if (item.sku) {
    const product = await source.findBySku(item.sku, market);
    if (product || !item.name) return product ? [{ product, score: 1 }] : [];
  }
  return closest(item.name ?? "", await source.searchByName(item.name ?? "", market));
}

/**
 * The products KicksDB has for some of a source's items (by position, at
 * most MAX_LOOKUP): for each, up to three, closest first — whether the Hub's
 * catalog has it already, too. Nothing is saved: the one chosen is imported
 * by its SKU.
 */
export async function lookupItems(id: string, positions: readonly number[]): Promise<SourceLookup[]> {
  lookupReady();
  const row = await getSource(id);
  const market = (await getActiveConfig()).source.market;
  const source = kicksdb(await getActiveConfig());
  const wanted = [...new Set(positions)].slice(0, MAX_LOOKUP);
  const out: SourceLookup[] = [];
  for (const position of wanted) {
    const item = row.items[position - 1];
    if (!item) throw new VetrinaError("invalid", words().source.itemGone, 400);
    try {
      const found = await lookupOne(item, market, source);
      const known = await getAnyBySkus(market, found.map((m) => m.product.sku));
      out.push({
        position,
        name: item.name,
        sku: item.sku,
        matches: found.map(({ product, score }) => ({
          sku: product.sku,
          title: product.title,
          brand: product.brand,
          image: product.image,
          score,
          inCatalog: known.has(catalogKey(product.sku)),
        })),
        error: null,
      });
    } catch (e) {
      console.warn(`[order-sources] lookup of item ${position} failed: ${e instanceof Error ? e.message : String(e)}`);
      out.push({ position, name: item.name, sku: item.sku, matches: [], error: words().source.lookupFailed });
    }
  }
  return out;
}

/**
 * Import these SKUs (at most MAX_IMPORT): each the Hub's catalog lacks is
 * confirmed on KicksDB first and joins it (a dry run included: the catalog is
 * the Hub's own, never the store), then all are published — or, on a dry
 * run, said as Publish would make them. A product the store already has is
 * left as it is.
 */
export async function importSkus(skus: readonly string[], opts: { dryRun: boolean }): Promise<SourceImport> {
  if (demoMode()) throw new VetrinaError("invalid", words().source.importDemo, 400);
  if (!wooConfigured()) throw new VetrinaError("not_configured", words().term.notConfigured, 503);
  if (!opts.dryRun && !isWriter()) throw new VetrinaError("not_configured", NOT_WRITER, 503);
  const asked = [...new Map(skus.map((s) => s.trim()).filter(Boolean).map((s) => [catalogKey(s), s])).values()].slice(0, MAX_IMPORT);
  if (asked.length === 0) throw new VetrinaError("invalid", words().source.importEmpty, 400);

  const config = await getActiveConfig();
  const market = config.source.market;
  // As the catalog holds each: as written, or with its spaces as dashes.
  const known = await getAnyBySkus(market, [...new Set(asked.flatMap(catalogSpellings))]);
  const resolved = new Map<string, string>();
  const unknown: string[] = [];
  for (const sku of asked) {
    const hit = catalogSpellings(sku).find((k) => known.has(k));
    if (hit) resolved.set(sku, hit);
    else unknown.push(sku);
  }

  const notFound: string[] = [];
  const unreachable: string[] = [];
  if (unknown.length > 0) {
    if (!kicksdbConfigured()) notFound.push(...unknown);
    else {
      const growth = await growCatalogFromSkus(kicksdb(config), dbCatalogStore, unknown, market);
      for (const j of growth.joined) resolved.set(j.requested, j.sku);
      notFound.push(...growth.rejected);
      unreachable.push(...growth.failed.map((f) => f.sku));
      // Asked twice in two spellings, or already there under another: what the catalog has, by now.
      const late = unknown.filter((s) => !resolved.has(s) && !growth.rejected.includes(s) && !growth.failed.some((f) => f.sku === s));
      if (late.length > 0) {
        const again = await getAnyBySkus(market, late.flatMap(catalogSpellings));
        for (const sku of late) {
          const hit = catalogSpellings(sku).find((k) => again.has(k));
          if (hit) resolved.set(sku, hit);
          else notFound.push(sku);
        }
      }
    }
  }

  const toPublish = [...new Set(resolved.values())];
  const outcome = toPublish.length > 0 ? await publishProducts(toPublish, { dryRun: opts.dryRun }) : null;
  // The products made, read into the Hub's copy of the store: the comparison finds them in the shop.
  if (outcome && !opts.dryRun && outcome.created + outcome.completed + outcome.reimported > 0) requestCheck();
  return {
    dryRun: opts.dryRun,
    products: (outcome?.products ?? []).map((p) => ({
      sku: p.sku,
      title: p.title,
      action: p.action,
      productId: p.storeProductId,
      permalink: p.permalink,
      sizes: p.sizes.length,
      reason: p.reason,
      error: p.error,
    })),
    created: outcome?.created ?? 0,
    skipped: outcome?.skipped ?? 0,
    failed: outcome?.failed ?? 0,
    notFound,
    unreachable,
    kicksdb: kicksdbConfigured(),
  };
}
