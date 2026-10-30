import "server-only";
import { and, desc, eq, gte, inArray, lt, ne, notInArray, sql, type SQL } from "drizzle-orm";
import type { ProductScopeAxes } from "@core/config";
import type { SourceProduct } from "@core/core-spine";
import { db } from "@/server/db/client";
import { catalogProducts, feedItems, mediaJobs, storeSnapshot } from "@/server/db/schema";
import { countOf } from "@/server/db/rows";
import { SNAPSHOT_ID } from "@/server/store-json/repo";
import { skuKey } from "@/lib/skus";
import { chunkArray } from "@/lib/chunk";
import { classifyTitle } from "./classify";

/**
 * Return catalog entries for the given SKUs that are still FRESH (fetched within
 * ttlSeconds), keyed by canonical SKU. Stale or missing SKUs are simply absent,
 * so the caller refetches and upserts them.
 *
 * Best-effort: the catalog is a cache, so a DB error (e.g. the table not yet
 * migrated) degrades to "no cache" rather than failing the whole preview.
 */
export async function getFreshBySkus(
  market: string,
  skus: string[],
  ttlSeconds: number,
): Promise<Map<string, SourceProduct>> {
  const out = new Map<string, SourceProduct>();
  if (skus.length === 0) return out;

  const keys = skus.map(skuKey);
  const threshold = new Date(Date.now() - ttlSeconds * 1000);

  try {
    const rows = await db
      .select()
      .from(catalogProducts)
      .where(
        and(
          eq(catalogProducts.market, market),
          inArray(catalogProducts.sku, keys),
          gte(catalogProducts.fetchedAt, threshold),
          // The store mirror is inventory, never a price source: a "woo" row
          // must read as a cache MISS so the normal KicksDB fetch happens
          // (and, when verified, flips the row to kicksdb).
          ne(catalogProducts.source, "woo"),
        ),
      );
    for (const r of rows) out.set(r.sku, r.data);
  } catch (e) {
    console.warn("[catalog] read skipped (cache unavailable):", describeDbError(e));
  }
  return out;
}

/** Load catalog products by SKU regardless of freshness (used by apply). */
export async function getAnyBySkus(
  market: string,
  skus: string[],
): Promise<Map<string, SourceProduct>> {
  const out = new Map<string, SourceProduct>();
  if (skus.length === 0) return out;
  try {
    const rows = await db
      .select()
      .from(catalogProducts)
      .where(
        and(
          eq(catalogProducts.market, market),
          inArray(catalogProducts.sku, skus.map(skuKey)),
          // Same as getFreshBySkus: "woo" rows are the store's own mirror —
          // apply/rebuild must never treat them as a source of truth.
          ne(catalogProducts.source, "woo"),
        ),
      );
    for (const r of rows) out.set(r.sku, r.data);
  } catch (e) {
    console.warn("[catalog] read skipped (cache unavailable):", describeDbError(e));
  }
  return out;
}

/** Total number of unique SKUs known in the catalog for a market (the catalog size). */
export async function countCatalog(market: string): Promise<number> {
  try {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(catalogProducts)
      .where(eq(catalogProducts.market, market));
    return rows[0]?.n ?? 0;
  } catch (e) {
    console.warn("[catalog] count skipped (cache unavailable):", describeDbError(e));
    return 0;
  }
}

/**
 * List every known-fetchable SKU for a market (the whole catalog), lightest
 * columns only, ordered brand then SKU. Best-effort: a DB error degrades to an
 * empty list rather than failing the page.
 */
export async function listCatalogEntries(
  market: string,
): Promise<{ sku: string; title: string; brand: string }[]> {
  try {
    return await db
      .select({
        sku: catalogProducts.sku,
        title: catalogProducts.title,
        brand: catalogProducts.brand,
      })
      .from(catalogProducts)
      .where(eq(catalogProducts.market, market))
      .orderBy(catalogProducts.brand, catalogProducts.sku);
  } catch (e) {
    console.warn("[catalog] list skipped (cache unavailable):", describeDbError(e));
    return [];
  }
}

/**
 * Every product's scope axes, straight off the denormalized columns — no
 * jsonb, no variants. This is what "which rule prices what" is computed from:
 * a whole-catalog read that stays cheap enough to run on demand when the
 * margins editor opens.
 */
export async function listProductScopeAxes(market: string): Promise<ProductScopeAxes[]> {
  try {
    return await db
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
      .where(eq(catalogProducts.market, market));
  } catch (e) {
    console.warn("[catalog] scope axes skipped (cache unavailable):", describeDbError(e));
    return [];
  }
}

/** A catalog product as the Publisher lists it: enough to decide, no jsonb. */
export interface PublishCandidate {
  sku: string;
  title: string;
  brand: string;
  image: string;
  source: string;
  category: string;
  secondaryCategory: string;
  minAsk: number | null;
  variantCount: number;
  addedAt: string;
  /**
   * At least one size the Publisher can turn into an EU size (see euSized).
   * Without one, Publish refuses the product ("no EU-sized variants"), unless
   * the supplier feed owns it and brings its own sizes.
   */
  euSized: boolean;
}

/**
 * True when some variant of the catalog row has a size the Publisher can
 * create: an EU entry in its conversions, or an EU-system label — the test
 * the rebuild planner applies per variant (euSize, else the label when the
 * size type is EU; then humanEuSize's formats). Read from the stored jsonb so
 * the list and the dock count skip, without a store call, what Publish would
 * only refuse: StockX bundles ("A/B" SKUs), raffle listings, apparel S–XL.
 */
const EU_SIZE_RE = String.raw`^\s*(eu\s*)?(\d+\s+\d+/\d+|\d+-\d+-\d+|\d+[.,-]\d+|\d+)\s*$`;
export const euSized = (data: SQL) => sql`exists (
  select 1 from jsonb_array_elements(case when jsonb_typeof(${data}->'variants') = 'array'
                                          then ${data}->'variants' else '[]'::jsonb end) as v
  where exists (
          select 1 from jsonb_array_elements(case when jsonb_typeof(v->'sizes') = 'array' then v->'sizes' else '[]'::jsonb end) as s
          where (s->>'system' ~* '(^|[^a-z])eu([^a-z]|$)' or s->>'system' = 'euro')
            and s->>'size' ~* ${EU_SIZE_RE}
        )
     or (v->>'sizeType' ~* 'eu' and v->>'sizeLabel' ~* ${EU_SIZE_RE})
)`;

/**
 * Every catalog product that could be published to the store, newest first.
 *
 * Excludes source "woo": those rows ARE the store mirror, so offering to
 * publish them would mean creating a second copy of a product that already
 * exists. Rows with no variants are excluded too — a parent with no sizes is
 * an unsellable shell. Store presence is subtracted by the caller, which
 * holds the snapshot.
 */
export async function listPublishCandidates(market: string): Promise<PublishCandidate[]> {
  try {
    const rows = await db
      .select({
        sku: catalogProducts.sku,
        title: catalogProducts.title,
        brand: catalogProducts.brand,
        image: catalogProducts.image,
        source: catalogProducts.source,
        category: catalogProducts.category,
        secondaryCategory: catalogProducts.secondaryCategory,
        minAsk: catalogProducts.minAsk,
        variantCount: catalogProducts.variantCount,
        addedAt: catalogProducts.addedAt,
        euSized: sql<boolean>`${euSized(sql`${catalogProducts.data}`)}`.mapWith(Boolean),
      })
      .from(catalogProducts)
      .where(
        and(
          eq(catalogProducts.market, market),
          ne(catalogProducts.source, "woo"),
          gte(catalogProducts.variantCount, 1),
        ),
      )
      .orderBy(desc(catalogProducts.addedAt));
    return rows.map((r) => ({ ...r, addedAt: r.addedAt.toISOString() }));
  } catch (e) {
    console.warn("[catalog] publish candidates skipped (cache unavailable):", describeDbError(e));
    return [];
  }
}

/**
 * How many catalog products the store does NOT carry yet — counted in SQL.
 *
 * The Sync tab shows this so an almost-idle sync on a fresh shop reads as
 * "nothing is published yet" instead of "the sync is broken". It is ONE
 * integer, and it used to be obtained by loading every catalog row and the
 * entire store snapshot into the heap. That runs on every render of the tab,
 * and a store pull re-renders it once per product page — which is how a long
 * pull walked the dev server into an out-of-memory crash.
 *
 * Matches the Publish tab's list exactly (listPublishTargets), or the number
 * would disagree with the list it describes: a feed product the feed no longer
 * carries is not counted while it is off the store — Publish refuses it until
 * the feed tracks it again. It stays in the catalog all the same, and a copy
 * already on the store stays there at stock 0. Best-effort: 0 on any error.
 */
export async function countUnpublishedCandidates(market: string): Promise<number> {
  try {
    const res = await db.execute(sql`
      with store_skus as (
        -- On the store = carried by a product WITH sizes (see listSizelessStoreSkus).
        select upper(trim(p->>'sku')) as sku,
               max(case when jsonb_typeof(p->'variations') = 'array'
                        then jsonb_array_length(p->'variations') else 0 end) as sizes
        from ${storeSnapshot}, jsonb_array_elements(${storeSnapshot.data}->'products') as p
        where ${storeSnapshot.id} = ${SNAPSHOT_ID} and coalesce(trim(p->>'sku'), '') <> ''
        group by 1
      )
      select count(*)::int as n
      from ${catalogProducts} c
      where c.market = ${market}
        and c.source <> 'woo'
        and c.variant_count >= 1
        and (c.source <> 'goldensneakers' or exists (
          select 1 from ${feedItems} f
          where f.feed = 'goldensneakers' and f.sku = upper(trim(c.sku)) and f.active
        ))
        -- A size Publish can create, or the feed's own sizes: the rest it
        -- would only refuse ("no EU-sized variants"), so it is not offered.
        and (${euSized(sql`c.data`)} or exists (
          select 1 from ${feedItems} f
          where f.feed = 'goldensneakers' and f.sku = upper(trim(c.sku)) and f.active
        ))
        and not exists (
          select 1 from store_skus ss where ss.sku = upper(trim(c.sku)) and ss.sizes > 0
        )
        -- Created and hidden until its photos land, or hidden because none
        -- could be attached: on the store, as the Publish tab counts it —
        -- unless it is the copy's product without sizes.
        and not exists (
          select 1 from ${mediaJobs} m
          where m.sku = upper(trim(c.sku))
            and (m.status = 'pending' or (m.status = 'failed' and m.store_product_id is not null and not exists (
              select 1 from ${mediaJobs} newer where newer.sku = m.sku and newer.created_at > m.created_at
            )))
            and not exists (select 1 from store_skus ss where ss.sku = m.sku and ss.sizes = 0)
        )
    `);
    return countOf(res);
  } catch (e) {
    console.warn("[catalog] unpublished count skipped:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* Who drives each product, and the catalog's own axes in counts       */
/* ------------------------------------------------------------------ */

/**
 * True when GoldenSneakers effectively owns this catalog SKU. Mirrors
 * gsOwnedProducts (src/server/feeds/owner.ts): at least one ACTIVE row, and at
 * least one row with a sellable presented price (the priced row may be a
 * deactivated size — the variant set includes those at qty 0).
 */
const GS_COVERED_SQL = sql<boolean>`(exists (
  select 1 from "feed_items" fi
  where fi."feed" = 'goldensneakers' and fi."active" = true and fi."sku" = ${catalogProducts.sku}
) and exists (
  select 1 from "feed_items" fi
  where fi."feed" = 'goldensneakers' and fi."presented_price" > 0 and fi."sku" = ${catalogProducts.sku}
))`;

/**
 * Effective GS ownership: feed coverage MINUS the SKUs the operator pinned
 * back to KicksDB — the same precedence the sync applies (see
 * src/server/feeds/owner.ts), so the counts never lie about who prices a
 * product.
 */
function gsOwnedSql(pinnedToKicksdb: string[]): SQL<boolean> {
  if (pinnedToKicksdb.length === 0) return GS_COVERED_SQL;
  return sql<boolean>`(${GS_COVERED_SQL} and ${notInArray(catalogProducts.sku, pinnedToKicksdb)})`;
}

export interface CatalogOwnerCounts {
  total: number;
  kicksdb: number;
  goldensneakers: number;
  /** Store-only inventory: registered from the Woo snapshot, no feed linked. */
  woo: number;
}

/**
 * How many catalog products each source currently DRIVES (feed coverage minus
 * manual KicksDB pins) — the dashboard's split of the catalog by price source.
 */
export async function countByOwner(
  market: string,
  pinnedToKicksdb: string[] = [],
): Promise<CatalogOwnerCounts> {
  const gsOwned = gsOwnedSql(pinnedToKicksdb);
  try {
    const rows = await db
      .select({
        total: sql<number>`count(*)::int`,
        goldensneakers: sql<number>`count(*) filter (where ${gsOwned})::int`,
        woo: sql<number>`count(*) filter (where not ${gsOwned} and ${eq(catalogProducts.source, "woo")})::int`,
      })
      .from(catalogProducts)
      .where(eq(catalogProducts.market, market));
    const total = rows[0]?.total ?? 0;
    const goldensneakers = rows[0]?.goldensneakers ?? 0;
    const woo = rows[0]?.woo ?? 0;
    return { total, goldensneakers, woo, kicksdb: total - goldensneakers - woo };
  } catch (e) {
    console.warn("[catalog] owner counts skipped (cache unavailable):", describeDbError(e));
    return { total: 0, kicksdb: 0, goldensneakers: 0, woo: 0 };
  }
}

export interface CategoryCount {
  category: string; // "" = uncategorized (no metadata yet)
  secondaryCategory: string; // "" = none
  count: number;
}

/**
 * Category → sub-category counts for a market (the margin rules' family picker).
 * Rows without metadata come back under category "" — the Uncategorized bucket.
 */
export async function listCategoryCounts(market: string): Promise<CategoryCount[]> {
  try {
    return await db
      .select({
        category: catalogProducts.category,
        secondaryCategory: catalogProducts.secondaryCategory,
        count: sql<number>`count(*)::int`,
      })
      .from(catalogProducts)
      .where(eq(catalogProducts.market, market))
      .groupBy(catalogProducts.category, catalogProducts.secondaryCategory)
      .orderBy(catalogProducts.category, catalogProducts.secondaryCategory);
  } catch (e) {
    console.warn("[catalog] category counts skipped (cache unavailable):", describeDbError(e));
    return [];
  }
}

/**
 * KicksDB-sourced SKUs still missing catalog metadata (category = ''), least
 * recently fetched first — the enrichment backfill's queue. Ordering by
 * fetchedAt keeps SKUs whose metadata the API genuinely lacks rotating to the
 * back (each attempt bumps fetchedAt) instead of monopolizing the daily batch.
 */
export async function listSkusMissingMetadata(market: string, limit: number): Promise<string[]> {
  try {
    const rows = await db
      .select({ sku: catalogProducts.sku })
      .from(catalogProducts)
      .where(
        and(
          eq(catalogProducts.market, market),
          eq(catalogProducts.source, "kicksdb"),
          eq(catalogProducts.category, ""),
        ),
      )
      .orderBy(catalogProducts.fetchedAt)
      .limit(limit);
    return rows.map((r) => r.sku);
  } catch (e) {
    console.warn("[catalog] metadata queue skipped (cache unavailable):", describeDbError(e));
    return [];
  }
}

/** Brands present in a market with per-brand counts (the margin rules' brand picker). */
export async function listBrandCounts(
  market: string,
): Promise<{ brand: string; count: number }[]> {
  try {
    const rows = await db
      .select({ brand: catalogProducts.brand, count: sql<number>`count(*)::int` })
      .from(catalogProducts)
      .where(eq(catalogProducts.market, market))
      .groupBy(catalogProducts.brand)
      .orderBy(catalogProducts.brand);
    return rows.filter((r) => r.brand !== "");
  } catch (e) {
    console.warn("[catalog] brands skipped (cache unavailable):", describeDbError(e));
    return [];
  }
}

export interface CatalogEntry {
  sku: string;
  title: string;
  brand: string;
  source: string; // row provenance: "kicksdb" | "goldensneakers" | "woo"
  image: string;
  minAsk: number | null;
  addedAt: string;
  fetchedAt: string;
  product: SourceProduct;
}

/** One full catalog entry (drawer detail), or null when unknown. */
export async function getCatalogEntry(market: string, sku: string): Promise<CatalogEntry | null> {
  try {
    const rows = await db
      .select()
      .from(catalogProducts)
      .where(and(eq(catalogProducts.market, market), eq(catalogProducts.sku, skuKey(sku))))
      .limit(1);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      sku: r.sku,
      title: r.title,
      brand: r.brand,
      source: r.source,
      image: r.image,
      minAsk: r.minAsk,
      addedAt: r.addedAt.toISOString(),
      fetchedAt: r.fetchedAt.toISOString(),
      product: r.data,
    };
  } catch (e) {
    console.warn("[catalog] entry skipped (cache unavailable):", describeDbError(e));
    return null;
  }
}

/**
 * KicksDB-sourced SKUs whose prices are past the TTL, oldest first (the
 * refresh feed's queue). Feed-sourced entries are refreshed by their own
 * feed's sync, never by KicksDB lookups that would just miss.
 */
export async function listStaleSkus(
  market: string,
  ttlSeconds: number,
  limit: number,
): Promise<string[]> {
  const threshold = new Date(Date.now() - ttlSeconds * 1000);
  try {
    const rows = await db
      .select({ sku: catalogProducts.sku })
      .from(catalogProducts)
      .where(
        and(
          eq(catalogProducts.market, market),
          eq(catalogProducts.source, "kicksdb"),
          lt(catalogProducts.fetchedAt, threshold),
        ),
      )
      .orderBy(catalogProducts.fetchedAt)
      .limit(limit);
    return rows.map((r) => r.sku);
  } catch (e) {
    console.warn("[catalog] stale list skipped (cache unavailable):", describeDbError(e));
    return [];
  }
}

/** How many KicksDB-sourced entries are past the TTL for a market. */
export async function countStale(market: string, ttlSeconds: number): Promise<number> {
  const threshold = new Date(Date.now() - ttlSeconds * 1000);
  try {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(catalogProducts)
      .where(
        and(
          eq(catalogProducts.market, market),
          eq(catalogProducts.source, "kicksdb"),
          lt(catalogProducts.fetchedAt, threshold),
        ),
      );
    return rows[0]?.n ?? 0;
  } catch (e) {
    console.warn("[catalog] stale count skipped (cache unavailable):", describeDbError(e));
    return 0;
  }
}

/** The lowest ask across every variant/offer of a product, or null when unpriced. */
export function minAskOf(p: SourceProduct): number | null {
  let min: number | null = null;
  for (const v of p.variants) {
    for (const o of v.offers) {
      if (o.lowestAsk > 0 && (min == null || o.lowestAsk < min)) min = o.lowestAsk;
    }
  }
  return min;
}

/**
 * Upsert (insert-or-refresh) the products that were just fetched from KicksDB.
 * The denormalized discovery columns (image/minAsk/variantCount) are recomputed
 * on every write; addedAt is only set on first insert (it means "joined the
 * catalog", while fetchedAt means "last refreshed").
 */
export async function upsertCatalog(market: string, products: SourceProduct[]): Promise<void> {
  if (products.length === 0) return;

  const now = new Date();
  const values = products.map((p) => {
    // Sources without metadata (feeds, store-only rows) get the navigation
    // axes derived from the title — real API metadata always wins.
    const derived = p.category ? null : classifyTitle(p.title, p.brand);
    // The derived axes go into the STORED PRODUCT, not only the denormalized
    // columns: pricing rules scoped to a family read category/secondary off
    // the jsonb, so a rule for "Yeezy → Foam RNNR" would never have matched
    // the very feed rows whose family the classifier is what established.
    const stored: SourceProduct = derived
      ? {
          ...p,
          category: p.category || derived.category,
          secondaryCategory: p.secondaryCategory || derived.secondaryCategory,
          gender: p.gender || derived.gender,
        }
      : p;
    return {
    market,
    sku: skuKey(p.sku),
    source: p.source ?? "kicksdb",
    stockxId: p.stockxId,
    title: p.title,
    brand: p.brand,
    image: p.image ?? "",
    category: stored.category ?? "",
    secondaryCategory: stored.secondaryCategory ?? "",
    gender: stored.gender ?? "",
    model: p.model ?? "",
    productType: p.productType ?? "",
    minAsk: minAskOf(p),
    variantCount: p.variants.length,
    data: stored,
    addedAt: now,
    fetchedAt: now,
    updatedAt: now,
    };
  });

  try {
    // Chunked: a whole-store registration can be thousands of rows, and a
    // single multi-row INSERT would overflow Postgres's parameter limit.
    for (const chunk of chunkArray(values, 500)) {
      await db
        .insert(catalogProducts)
        .values(chunk)
        .onConflictDoUpdate({
          target: [catalogProducts.market, catalogProducts.sku],
          set: {
            source: sql`excluded.source`,
            stockxId: sql`excluded.stockx_id`,
            title: sql`excluded.title`,
            brand: sql`excluded.brand`,
            // A refresh without an image must never blank a known-good one;
            // the jsonb copy is patched to match so data.image never diverges
            // from the denormalized column.
            image: sql`case when excluded.image = '' then ${catalogProducts.image} else excluded.image end`,
            category: sql`excluded.category`,
            secondaryCategory: sql`excluded.secondary_category`,
            gender: sql`excluded.gender`,
            model: sql`excluded.model`,
            productType: sql`excluded.product_type`,
            minAsk: sql`excluded.min_ask`,
            variantCount: sql`excluded.variant_count`,
            data: sql`case when excluded.image = '' and ${catalogProducts.image} <> ''
              then jsonb_set(excluded.data, '{image}', to_jsonb(${catalogProducts.image}))
              else excluded.data end`,
            fetchedAt: sql`excluded.fetched_at`,
            updatedAt: sql`excluded.updated_at`,
            // added_at intentionally NOT updated: it records first insert.
          },
        });
    }
  } catch (e) {
    console.warn("[catalog] write skipped (cache unavailable):", describeDbError(e));
  }
}

/**
 * Rotate SKUs the refresh attempted but could not re-price — the bulk endpoint
 * ANSWERED without them (delisted, or the API 500s on the product's own data) —
 * to the back of the stale queue by bumping fetchedAt. The stored prices are
 * kept (a retry has no better data); the entry simply waits a full TTL cycle
 * again instead of permanently clogging the head of the queue and starving
 * every SKU behind it. Never called on an outage: that throws upstream.
 */
export async function touchCatalogSkus(market: string, skus: string[]): Promise<void> {
  if (skus.length === 0) return;
  const now = new Date();
  try {
    for (const part of chunkArray(skus.map(skuKey), 500)) {
      await db
        .update(catalogProducts)
        .set({ fetchedAt: now, updatedAt: now })
        .where(and(eq(catalogProducts.market, market), inArray(catalogProducts.sku, part)));
    }
  } catch (e) {
    console.warn("[catalog] touch skipped (cache unavailable):", describeDbError(e));
  }
}

/**
 * One-shot classification of rows still without navigation metadata: derive
 * category/secondary/gender from the stored title+brand (see classify.ts).
 * Rows the classifier can't place stay uncategorized. Also canonicalizes
 * case-variant duplicate categories ("ReStockX" vs "Restockx") to the most
 * common spelling so the sidebar shows one bucket per category. Runs from the
 * daily scheduler; cheap enough to repeat (it only touches unclassified rows).
 */
export async function recategorizeCatalog(
  market: string,
): Promise<{ classified: number; unified: number; synced: number }> {
  let classified = 0;
  let unified = 0;
  let synced = 0;
  try {
    const rows = await db
      .select({ sku: catalogProducts.sku, title: catalogProducts.title, brand: catalogProducts.brand })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.market, market), eq(catalogProducts.category, "")));

    const updates = rows.flatMap((r) => {
      const derived = classifyTitle(r.title, r.brand);
      return derived ? [{ sku: r.sku, ...derived }] : [];
    });
    for (const u of updates) {
      await db
        .update(catalogProducts)
        .set({
          category: u.category,
          secondaryCategory: u.secondaryCategory,
          // Never blank a gender some other writer already knew.
          ...(u.gender ? { gender: u.gender } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(catalogProducts.market, market), eq(catalogProducts.sku, u.sku)));
      classified += 1;
    }

    // Case-variant dedupe: rewrite every category to its most common spelling.
    const res = await db.execute(sql`
      with canon as (
        select lower("category") as lc,
               (array_agg("category" order by cnt desc, "category"))[1] as best
        from (
          select "category", count(*) as cnt from "catalog_products"
          where "market" = ${market} and "category" <> ''
          group by "category"
        ) variants
        group by lower("category")
        having count(*) > 1
      )
      update "catalog_products" c
      set "category" = canon.best
      from canon
      where c."market" = ${market}
        and lower(c."category") = canon.lc
        and c."category" <> canon.best
    `);
    unified = (res as unknown as { rowCount?: number }).rowCount ?? 0;

    // Mirror the navigation axes back into the stored product. The pricing
    // engine resolves family-scoped rules against the jsonb, while the
    // sidebar reads the columns — a row classified (or case-unified) before
    // this ran shows up under "Yeezy → Foam RNNR" in the catalog and yet
    // matches no rule scoped to it. Idempotent: only diverging rows are
    // touched, and an axis is never blanked by an unknown one.
    const sync = await db.execute(sql`
      update "catalog_products"
      set "data" = jsonb_set(
            jsonb_set(
              case when "gender" <> ''
                then jsonb_set("data", '{gender}', to_jsonb("gender"))
                else "data" end,
              '{category}', to_jsonb("category")),
            '{secondaryCategory}', to_jsonb("secondary_category")),
          "updated_at" = now()
      where "market" = ${market}
        and "category" <> ''
        and (
          coalesce("data"->>'category', '') is distinct from "category"
          or coalesce("data"->>'secondaryCategory', '') is distinct from "secondary_category"
          or ("gender" <> '' and coalesce("data"->>'gender', '') is distinct from "gender")
        )
    `);
    synced = (sync as unknown as { rowCount?: number }).rowCount ?? 0;
  } catch (e) {
    console.warn("[catalog] recategorize skipped:", describeDbError(e));
  }
  return { classified, unified, synced };
}

/** Provenance of existing entries — feed syncs must never overwrite kicksdb rows. */
export async function getCatalogSources(
  market: string,
  skus: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (skus.length === 0) return out;
  try {
    const rows = await db
      .select({ sku: catalogProducts.sku, source: catalogProducts.source })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.market, market), inArray(catalogProducts.sku, skus.map(skuKey))));
    for (const r of rows) out.set(r.sku, r.source);
  } catch (e) {
    console.warn("[catalog] sources skipped (cache unavailable):", describeDbError(e));
  }
  return out;
}

/**
 * A catalog row as kept for a way back: the whole row, its dates as JSON
 * strings once it has been through jsonb.
 */
export type CatalogRowRecord = Omit<typeof catalogProducts.$inferSelect, "addedAt" | "fetchedAt" | "updatedAt"> & {
  addedAt: string | Date;
  fetchedAt: string | Date;
  updatedAt: string | Date;
};

/**
 * Take products out of the catalog, every market's row of each SKU, and
 * answer what was there. The one exception to "entries never leave": a
 * product the owner deleted from the shop ("Elimina"), which no route may
 * offer again. A deliberate import brings it back; "Annulla" puts these rows
 * back (restoreCatalogRows).
 */
export async function takeCatalogRows(skus: string[]): Promise<CatalogRowRecord[]> {
  const keys = [...new Set(skus.map(skuKey).filter(Boolean))];
  if (keys.length === 0) return [];
  return db.delete(catalogProducts).where(inArray(catalogProducts.sku, keys)).returning();
}

/** Put back rows takeCatalogRows took; a row written for the SKU since (an import, a feed) is the newer word, and stays. */
export async function restoreCatalogRows(rows: readonly CatalogRowRecord[]): Promise<void> {
  if (rows.length === 0) return;
  const date = (v: string | Date) => (v instanceof Date ? v : new Date(v));
  await db
    .insert(catalogProducts)
    .values(rows.map((r) => ({ ...r, addedAt: date(r.addedAt), fetchedAt: date(r.fetchedAt), updatedAt: date(r.updatedAt) })))
    .onConflictDoNothing({ target: [catalogProducts.market, catalogProducts.sku] });
}

/** Surface the underlying pg message (drizzle wraps it) for actionable logs. */
function describeDbError(e: unknown): string {
  const cause = (e as { cause?: { message?: string } })?.cause;
  if (cause?.message) return cause.message;
  return e instanceof Error ? e.message : String(e);
}
