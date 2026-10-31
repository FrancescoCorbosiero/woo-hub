import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { ProductSource } from "@/lib/vetrina/catalog";
import { skuKey } from "@/lib/skus";
import { demoMode } from "@/server/collections/store";
import { getActiveConfig } from "@/server/config/repo";
import { db } from "@/server/db/client";
import { catalogProducts, feedItems, storeIndex } from "@/server/db/schema";
import { GS_FEED } from "@/server/feeds/repo";
import { skusPinnedTo } from "@/server/overrides/model";
import { getOverrides } from "@/server/overrides/repo";
import { demoShop } from "./fixture-source";

/**
 * Where each product of the shop comes from: the colour the owner tells it
 * by, the catalog's "Provenienza" chips, and the one rule "Elimina" follows.
 * Decided by SKU, from what the Hub knows:
 *
 *   the supplier's feed carries it now      → goldensneakers  ("Elimina" refuses it)
 *   pinned to KicksDB's prices in the Hub   → kicksdb
 *   the feed listed it, no longer does      → delisted
 *   the catalog holds it from KicksDB       → kicksdb
 *   the catalog holds it from the feed      → delisted
 *   anything else                           → woo (made in the shop)
 *
 * The feed comes first, a pin included: the feed decides what is in the
 * shop, and the moment the Hub forgets a product it carries, the feed's next
 * sync registers it again and Publish offers it — the very reason "Elimina"
 * refuses it. A pin only decides who prices a product the feed has let go.
 * The sync reads the same facts (src/server/feeds/owner.ts): a delisted
 * product it keeps at stock 0, a pinned one it prices from KicksDB.
 *
 * Read strictly: a fact that cannot be read fails the answer, rather than
 * colour a supplier's product as one "Elimina" may take.
 */

export interface SourceFacts {
  /** SKUs (canonical) the feed carries now: at least one size active. */
  carried: ReadonlySet<string>;
  /** SKUs the feed has listed, carried now or not. */
  listed: ReadonlySet<string>;
  /** The catalog's own source of each SKU: kicksdb, goldensneakers, woo. */
  catalog: ReadonlyMap<string, string>;
  /** SKUs the Hub prices from KicksDB whatever the feed says (the product drawer's switch). */
  pinned: ReadonlySet<string>;
}

export function productSource(sku: string, facts: SourceFacts): ProductSource {
  const key = skuKey(sku);
  // No SKU: nothing can link it to a source.
  if (!key) return "woo";
  if (facts.carried.has(key)) return "goldensneakers";
  if (facts.pinned.has(key)) return "kicksdb";
  if (facts.listed.has(key)) return "delisted";
  const catalog = facts.catalog.get(key);
  if (catalog === "kicksdb") return "kicksdb";
  if (catalog === "goldensneakers") return "delisted";
  return "woo";
}

/** What tells the shop's products apart, read once for an answer. */
export async function readSourceFacts(): Promise<SourceFacts> {
  if (demoMode()) return demoSourceFacts();
  // The overrides are read best-effort, as everywhere: a pin only tells kicksdb from delisted, both of which "Elimina" takes.
  const [feed, catalog, overrides] = await Promise.all([readFeedCoverage(), readCatalogSources(), getOverrides()]);
  return { ...feed, catalog, pinned: new Set((overrides ? skusPinnedTo(overrides, "kicksdb") : []).map(skuKey)) };
}

/** Every SKU the feed has listed, and whether any of its sizes is active. */
async function readFeedCoverage(): Promise<Pick<SourceFacts, "carried" | "listed">> {
  const rows = await db
    .select({ sku: feedItems.sku, carried: sql<boolean>`bool_or(${feedItems.active})` })
    .from(feedItems)
    .where(eq(feedItems.feed, GS_FEED))
    .groupBy(feedItems.sku);
  const carried = new Set<string>();
  const listed = new Set<string>();
  for (const row of rows) {
    const key = skuKey(row.sku);
    listed.add(key);
    if (row.carried) carried.add(key);
  }
  return { carried, listed };
}

/** The catalog's source of the SKUs the shop has: the catalog itself also holds every product still to publish. */
async function readCatalogSources(): Promise<Map<string, string>> {
  const { source } = await getActiveConfig();
  const onStore = db
    .select({ sku: sql<string>`upper(btrim(${storeIndex.sku}))` })
    .from(storeIndex)
    .where(ne(storeIndex.sku, ""));
  const rows = await db
    .select({ sku: catalogProducts.sku, source: catalogProducts.source })
    .from(catalogProducts)
    .where(and(eq(catalogProducts.market, source.market), inArray(catalogProducts.sku, onStore)));
  return new Map(rows.map((row) => [skuKey(row.sku), row.source]));
}

/**
 * The demo shop's own sources: the Hub's feed and catalog are the real
 * shop's, whose SKUs the demo's may share, so the demo carries its own.
 */
function demoSourceFacts(): SourceFacts {
  const carried = new Set<string>();
  const listed = new Set<string>();
  const catalog = new Map<string, string>();
  for (const p of demoShop().products) {
    const key = skuKey(p.sku);
    if (p.source === "goldensneakers") carried.add(key);
    if (p.source === "goldensneakers" || p.source === "delisted") {
      listed.add(key);
      catalog.set(key, "goldensneakers");
    }
    if (p.source === "kicksdb") catalog.set(key, "kicksdb");
  }
  return { carried, listed, catalog, pinned: new Set() };
}
