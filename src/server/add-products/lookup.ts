import "server-only";
import type { SourceProduct } from "@core/core-spine";
import { LOOKUP_BATCH, type AddLookup, type AddRoute } from "@/lib/add-products";
import { skuKey } from "@/lib/skus";
import { getSource as kicksdb, kicksdbConfigured } from "@/server/adapters/kicksdb";
import { getAnyBySkus } from "@/server/catalog/repo";
import { demoMode } from "@/server/collections/store";
import { getActiveConfig } from "@/server/config/repo";
import { gsFeedStatus, type GsOwnedProduct } from "@/server/feeds/owner";
import { getOverrides } from "@/server/overrides/repo";
import { getSnapshotProductsBySkus } from "@/server/store-json/repo";
import { sourceEuSize } from "@/server/store-json/match";
import { catalogSpellings } from "@/server/vetrina/order-sources/compare-model";
import { words } from "@/server/vetrina/operations/words";
import { VetrinaError } from "@/server/vetrina/source";
import { wooConfigured } from "@/server/woo/client";
import { failedMediaSkus, openMediaSkus } from "@/server/woo/media";
import { recalled, remember } from "./kicks-memory";

/**
 * "Aggiungi prodotti", the look-up (src/lib/add-products.ts): what the Hub
 * knows of each code, read in the order the routes are tried — the shop
 * first (nothing is ever added twice), then the supplier's feed, the Hub's
 * catalog, and KicksDB last, the one that costs a call. Nothing is written:
 * KicksDB's answers are only remembered for a while, for the add to reuse.
 */

/** The EU sizes a source product would get on the shop. */
export function euSizes(product: SourceProduct): number {
  return new Set(product.variants.map(sourceEuSize).filter((eu): eu is string => eu != null)).size;
}

/** The feed's sizes in stock: the ones the shop would sell. */
function feedSizes(owned: GsOwnedProduct): number {
  const inStock = Object.values(owned.stockBySize).filter((quantity) => quantity > 0).length;
  return inStock > 0 ? inStock : euSizes(owned.product);
}

/** What a look-up reads about the codes, gathered before any is decided. */
export interface LookupFacts {
  /** On the shop, by canonical code: its id (null when only the photo queue knows it) and name. */
  onStore: ReadonlyMap<string, { id: number | null; title: string | null }>;
  /** Carried by the feed now. */
  feed: ReadonlyMap<string, GsOwnedProduct>;
  /** Listed by the feed once, carried no more. */
  delisted: ReadonlySet<string>;
  /** The Hub's catalog, KicksDB's and the feed's rows (never the shop's mirror). */
  catalog: ReadonlyMap<string, SourceProduct>;
  /** KicksDB's answers: a product, null for "no such product", "unreachable" when it did not answer. */
  kicksdb: ReadonlyMap<string, SourceProduct | null | "unreachable">;
}

/** One code's route, from the facts — pure. */
export function routeOne(sku: string, facts: LookupFacts): AddLookup {
  const spellings = catalogSpellings(sku);
  const pick = <T>(map: ReadonlyMap<string, T>) => {
    for (const key of spellings) if (map.has(key)) return map.get(key) as T;
    return undefined;
  };
  const answer = (route: AddRoute, product: SourceProduct | null, sizes = product ? euSizes(product) : 0): AddLookup => ({
    sku,
    route,
    title: product?.title || null,
    brand: product?.brand || null,
    image: product?.image || null,
    sizes,
    productId: null,
  });

  const onStore = pick(facts.onStore);
  if (onStore) {
    const known = pick(facts.catalog) ?? pick(facts.feed)?.product ?? null;
    return { ...answer("onStore", known, 0), title: onStore.title || known?.title || null, productId: onStore.id };
  }
  const feed = pick(facts.feed);
  if (feed) return answer("feed", feed.product, feedSizes(feed));
  const catalog = pick(facts.catalog);
  if (spellings.some((key) => facts.delisted.has(key))) return answer("delisted", catalog ?? null, 0);
  if (catalog) {
    // A feed's row the feed no longer lists anywhere: its last word is all there is.
    if ((catalog.source ?? "kicksdb") !== "kicksdb") return answer("delisted", catalog, 0);
    return euSizes(catalog) > 0 ? answer("catalog", catalog) : answer("noSizes", catalog);
  }
  const found = pick(facts.kicksdb);
  if (found === "unreachable") return answer("unreachable", null);
  if (found) return euSizes(found) > 0 ? answer("kicksdb", found) : answer("noSizes", found);
  return answer("unknown", null);
}

async function forEachLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const worker = async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
}

/**
 * Look these codes up (at most LOOKUP_BATCH: the screen sends a long paste a
 * batch at a time). KicksDB is asked only about the codes nothing else
 * knows, and only when the Hub has a KicksDB account: without one, those
 * are made by hand.
 */
export async function lookupProducts(skus: readonly string[]): Promise<AddLookup[]> {
  if (demoMode()) throw new VetrinaError("invalid", words().add.demo, 400);
  if (!wooConfigured()) throw new VetrinaError("not_configured", words().term.notConfigured, 503);
  const asked = [...new Map(skus.map((s) => s.trim()).filter(Boolean).map((s) => [skuKey(s), s])).values()].slice(0, LOOKUP_BATCH);
  if (asked.length === 0) return [];

  const config = await getActiveConfig();
  const market = config.source.market;
  const spellings = [...new Set(asked.flatMap(catalogSpellings))];
  const overrides = await getOverrides().catch(() => null);
  const [onShop, queued, failedPhotos, feed, catalog] = await Promise.all([
    getSnapshotProductsBySkus(spellings),
    openMediaSkus().catch(() => new Set<string>()),
    failedMediaSkus().catch(() => new Set<string>()),
    gsFeedStatus(spellings, market, overrides),
    getAnyBySkus(market, spellings),
  ]);

  const onStore = new Map<string, { id: number | null; title: string | null }>();
  for (const [key, product] of onShop) onStore.set(key, { id: product.id, title: product.name ?? null });
  // Made, and hidden until its first photo: the shop has it, the copy does not yet.
  for (const key of spellings) {
    if (!onStore.has(key) && (queued.has(key) || failedPhotos.has(key))) onStore.set(key, { id: null, title: null });
  }

  const facts: LookupFacts = { onStore, feed: feed.owned, delisted: feed.delisted, catalog, kicksdb: new Map() };
  const answers = facts.kicksdb as Map<string, SourceProduct | null | "unreachable">;
  const unknown = asked.filter((sku) => routeOne(sku, facts).route === "unknown");
  if (unknown.length > 0 && kicksdbConfigured()) {
    const source = kicksdb(config);
    await forEachLimit(unknown, 6, async (sku) => {
      const key = skuKey(sku);
      const known = recalled(market, sku);
      if (known !== undefined) {
        answers.set(key, known);
        return;
      }
      try {
        const product = await source.findBySku(sku, market);
        remember(market, sku, product);
        answers.set(key, product);
      } catch (e) {
        console.warn(`[add-products] KicksDB look-up of ${sku} failed: ${e instanceof Error ? e.message : String(e)}`);
        answers.set(key, "unreachable");
      }
    });
  }
  return asked.map((sku) => routeOne(sku, facts));
}
