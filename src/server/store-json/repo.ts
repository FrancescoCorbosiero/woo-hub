import "server-only";
import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { storeSnapshot } from "@/server/db/schema";
import { countOf, rowsOf } from "@/server/db/rows";
import type { StoreModel, StoreProductModel } from "./model";

/**
 * The snapshot is a single row. Exported because anything querying the blob in
 * SQL must key on the SAME id — a hardcoded guess elsewhere silently matches
 * nothing, and "nothing" is indistinguishable from "the store is empty".
 */
export const SNAPSHOT_ID = "current";
const SINGLETON = SNAPSHOT_ID;

export type SnapshotSource = "upload" | "rest";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Every write to the snapshot goes through here, one at a time.
 *
 * The snapshot is ONE jsonb value, and a patch is a read-modify-write of all
 * of it. Two at once — two publish batches finishing together, a batch the
 * proxy gave up on still finishing beside the next one, a batch and a sync
 * apply — both read the same old value, and the second write silently drops
 * the first one's products: the store has them, the Hub does not, and Publish
 * offers them again. Reproduced: two batches of 6 at a time, five times over,
 * created 60 products and left 30 in the snapshot.
 *
 * A transaction-scoped advisory lock queues the writers; each statement after
 * it reads what the previous writer committed.
 */
async function withSnapshotWriteLock<T>(write: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('store-hub:store_snapshot'))`);
    return write(tx);
  });
}

/**
 * The field a patched product carries: when the Hub last wrote it into the
 * snapshot. A full pull keeps whatever was patched after it started (see
 * saveSnapshotKeepingPatches) — a product read before the Hub wrote it is
 * older than the patch, and putting it back made the Hub's own write look
 * like an edit made in WordPress.
 */
export const PATCHED_AT = "hub_patched_at";

/**
 * The field that says how old a product's copy is: when the store was last
 * known to look as the copy says, its prices included. A pull stamps the time
 * it started (the product was read at some point after it); a long apply, the
 * time of each product's own write. A patch of a few fields (a sale learned)
 * leaves it as it was: the rest of the copy is no newer for it. A price the
 * Hub wrote after it is what the store holds, whatever the copy says (see
 * snapshotCopyTime and planChunk in actions/preview.ts).
 */
export const AS_OF = "hub_as_of";

/**
 * Where the snapshot remembers the products the Hub took out of it, by id:
 * when (see removeSnapshotProducts). Like a patch, a removal made after a
 * pull started outlives that pull; the pull after it no longer reads them.
 */
const REMOVED = "hub_removed";

/** A product's stamp, as epoch ms; null when it has none. */
function stampOf(product: StoreProductModel, key: string): number | null {
  const at = (product as Record<string, unknown>)[key];
  const t = typeof at === "string" ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** When the snapshot was saved whole (no snapshot: null). */
async function savedAtIn(tx: Tx): Promise<Date | null> {
  const rows = await tx
    .select({ at: storeSnapshot.uploadedAt })
    .from(storeSnapshot)
    .where(eq(storeSnapshot.id, SINGLETON))
    .limit(1);
  return rows[0]?.at ?? null;
}

/** Keep a product's copy time before a patch of a few fields stamps it as patched now. */
function freezeCopyTime(product: StoreProductModel, savedAt: Date | null): void {
  if (stampOf(product, AS_OF) != null) return;
  const at = snapshotCopyTime(product, savedAt);
  if (at != null) (product as Record<string, unknown>)[AS_OF] = new Date(at).toISOString();
}

/**
 * Rewrite the snapshot's product list as the products `keep` matches plus
 * `incoming`, under the write lock's transaction. Postgres does the swap; only
 * the changed products cross the wire. Returns the new product count, or null
 * when there is no snapshot (nothing pulled yet — no "on the store" to correct).
 *
 * The snapshot's date is NOT moved: it says when the store was last read
 * whole. A patch covers the few products just written, and dating the whole
 * copy by it made a day-old copy read as fresh.
 */
async function rewriteProducts(
  tx: Tx,
  keep: SQL,
  incoming: StoreModel["products"],
  /** The incoming products carry their own PATCHED_AT: the time the store was as they say. */
  stamped = false,
): Promise<number | null> {
  const product = stamped ? sql`p` : sql`p || jsonb_build_object(${PATCHED_AT}::text, now())`;
  const res = await tx.execute(sql`
    with incoming as (
      select ${product} as product
      from jsonb_array_elements(${JSON.stringify(incoming)}::jsonb) as p
    ),
    kept as (
      select p as product
      from ${storeSnapshot} s, jsonb_array_elements(s.data->'products') as p
      where s.id = ${SINGLETON} and (${keep})
    ),
    merged as (
      select coalesce(jsonb_agg(product), '[]'::jsonb) as arr
      from (select product from kept union all select product from incoming) t
    )
    update ${storeSnapshot} s
    set data = jsonb_set(
                 jsonb_set(s.data, '{products}', m.arr),
                 '{product_count}',
                 to_jsonb(jsonb_array_length(m.arr))
               ),
        product_count = jsonb_array_length(m.arr)
    from merged m
    where s.id = ${SINGLETON}
    returning s.product_count as n
  `);
  return rowsOf<{ n: number | string }>(res).length === 0 ? null : countOf(res);
}

/** A product's store id in SQL, -1 for none: a product without one is never matched by id. */
const productId = sql`coalesce((p->>'id')::bigint, -1)`;

export interface SnapshotInfo {
  siteUrl: string | null;
  productCount: number;
  source: SnapshotSource;
  uploadedAt: string;
}

/**
 * Replace the single active store snapshot. `source` records the transport that
 * produced it: "rest" (pulled from the Woo REST API) or "upload" (file fallback).
 */
export async function saveSnapshot(
  model: StoreModel,
  source: SnapshotSource = "upload",
): Promise<void> {
  await withSnapshotWriteLock((tx) =>
    tx
    .insert(storeSnapshot)
    .values({
      id: SINGLETON,
      siteUrl: model.site_url ?? null,
      productCount: model.products.length,
      source,
      data: model,
    })
    .onConflictDoUpdate({
      target: storeSnapshot.id,
      set: {
        siteUrl: sql`excluded.site_url`,
        productCount: sql`excluded.product_count`,
        source: sql`excluded.source`,
        data: sql`excluded.data`,
        uploadedAt: sql`now()`,
      },
    }),
  );
}

/**
 * Replace the snapshot with a full pull — keeping the products the Hub
 * patched since `since` (the pull's start).
 *
 * A pull reads the store over minutes, product page by product page, while
 * the feed cycle, Publish and the Vetrina keep writing. A product the pull
 * read before one of those writes is older than the patch the write left in
 * the snapshot; swapping the whole copy in at the end put the old prices
 * back, and the next plan took the Hub's own write for a price changed in
 * WordPress. The patch is what the writer read live or wrote: it wins.
 *
 * The read and the swap happen under the snapshot's write lock, so a patch
 * landing meanwhile waits and goes on top.
 */
export async function saveSnapshotKeepingPatches(
  model: StoreModel,
  since: Date,
  source: SnapshotSource = "rest",
): Promise<{ kept: number }> {
  return withSnapshotWriteLock(async (tx) => {
    const res = await tx.execute(sql`
      select p as product
      from ${storeSnapshot} s, jsonb_array_elements(s.data->'products') as p
      where s.id = ${SINGLETON}
        and p ? ${PATCHED_AT}
        and (p->>${PATCHED_AT})::timestamptz >= ${since.toISOString()}::timestamptz
    `);
    const patched = rowsOf<{ product: StoreProductModel }>(res).map((r) => r.product);
    const ids = new Set(patched.map((p) => p.id));
    const keys = new Set(patched.map((p) => (p.sku ?? "").trim().toUpperCase()).filter(Boolean));
    // Taken out of the copy after the pull started: the pull may have read them first.
    const gone = await tx.execute(sql`
      select key as id
      from ${storeSnapshot} s, jsonb_each_text(coalesce(s.data->${REMOVED}, '{}'::jsonb))
      where s.id = ${SINGLETON} and value::timestamptz >= ${since.toISOString()}::timestamptz
    `);
    const removed = new Set(rowsOf<{ id: string }>(gone).map((r) => Number(r.id)));
    const readSince = since.toISOString();
    const products = [
      ...model.products
        .filter((p) => !ids.has(p.id) && !removed.has(p.id) && !keys.has((p.sku ?? "").trim().toUpperCase()))
        .map((p) => ({ ...p, [AS_OF]: readSince })),
      ...patched,
    ];
    const data = { ...model, product_count: products.length, products };
    await tx
      .insert(storeSnapshot)
      .values({ id: SINGLETON, siteUrl: model.site_url ?? null, productCount: products.length, source, data })
      .onConflictDoUpdate({
        target: storeSnapshot.id,
        set: {
          siteUrl: sql`excluded.site_url`,
          productCount: sql`excluded.product_count`,
          source: sql`excluded.source`,
          data: sql`excluded.data`,
          uploadedAt: sql`now()`,
        },
      });
    return { kept: patched.length };
  });
}

export async function getActiveSnapshot(): Promise<StoreModel | null> {
  const rows = await db
    .select()
    .from(storeSnapshot)
    .where(eq(storeSnapshot.id, SINGLETON))
    .limit(1);
  return rows.length ? (rows[0].data as StoreModel) : null;
}

/**
 * Every SKU the store snapshot carries, normalized — extracted IN SQL.
 *
 * The callers that need this need ONLY this: "does the store already have
 * product X". Answering it by deserializing the snapshot pulled the whole blob
 * into the heap — 9.5 MB of JSON for a 3000-product shop, several times that
 * as a live object graph — on every render that asked. The Sync tab asks on
 * every server action, and a store pull fires one per product page, so a long
 * pull turned into hundreds of multi-megabyte allocations racing the collector:
 * "Ineffective mark-compacts near heap limit", and the dev server died.
 *
 * A few thousand short strings instead. Best-effort: an empty set on any error
 * means "the store has nothing", which is what no snapshot already means.
 */
export async function listStoreSkus(): Promise<Set<string>> {
  try {
    const res = await db.execute(sql`
      select distinct upper(trim(p->>'sku')) as sku
      from ${storeSnapshot}, jsonb_array_elements(${storeSnapshot.data}->'products') as p
      where ${storeSnapshot.id} = ${SINGLETON} and coalesce(trim(p->>'sku'), '') <> ''
    `);
    const out = new Set<string>();
    for (const r of rowsOf<{ sku?: string | null }>(res)) if (r.sku) out.add(r.sku);
    return out;
  } catch (e) {
    console.warn("[snapshot] store SKUs skipped:", e instanceof Error ? e.message : e);
    return new Set();
  }
}

/**
 * Store SKUs with no sizes at all — on every product that carries them.
 *
 * A publish that broke half-way leaves exactly this: the parent was created,
 * its sizes never were. Such a product sells nothing, so Publish does not
 * count it as published (it lists it again, and the run gives it its sizes).
 */
export async function listSizelessStoreSkus(): Promise<Set<string>> {
  try {
    const res = await db.execute(sql`
      select upper(trim(p->>'sku')) as sku
      from ${storeSnapshot}, jsonb_array_elements(${storeSnapshot.data}->'products') as p
      where ${storeSnapshot.id} = ${SINGLETON} and coalesce(trim(p->>'sku'), '') <> ''
      group by 1
      having max(case when jsonb_typeof(p->'variations') = 'array'
                      then jsonb_array_length(p->'variations') else 0 end) = 0
    `);
    return new Set(rowsOf<{ sku: string }>(res).map((r) => r.sku));
  } catch (e) {
    console.warn("[snapshot] sizeless SKUs skipped:", e instanceof Error ? e.message : e);
    return new Set();
  }
}

/**
 * How many store SKUs appear on MORE than one product — the dashboard's
 * duplicate banner. Computed in SQL over the jsonb so the dashboard never
 * loads the multi-MB snapshot blob. Best-effort: 0 on any error.
 */
export async function countDuplicateSkus(): Promise<number> {
  try {
    const res = await db.execute(sql`
      select count(*)::int as n from (
        select upper(trim(p->>'sku')) as k
        from ${storeSnapshot}, jsonb_array_elements(${storeSnapshot.data}->'products') as p
        where ${storeSnapshot.id} = ${SINGLETON} and coalesce(trim(p->>'sku'), '') <> ''
        group by 1
        having count(*) > 1
      ) g
    `);
    return countOf(res);
  } catch {
    return 0;
  }
}

export async function getSnapshotInfo(): Promise<SnapshotInfo | null> {
  const rows = await db
    .select({
      siteUrl: storeSnapshot.siteUrl,
      productCount: storeSnapshot.productCount,
      source: storeSnapshot.source,
      uploadedAt: storeSnapshot.uploadedAt,
    })
    .from(storeSnapshot)
    .where(eq(storeSnapshot.id, SINGLETON))
    .limit(1);
  if (!rows.length) return null;
  return {
    siteUrl: rows[0].siteUrl,
    productCount: rows[0].productCount,
    source: rows[0].source,
    uploadedAt: rows[0].uploadedAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Patching the snapshot without ever holding it                       */
/* ------------------------------------------------------------------ */

/**
 * The snapshot's products for these SKUs, unrolled from the jsonb IN SQL.
 *
 * Every write path — publish, rebuild, apply — needs the handful of products
 * it is about to change, and used to get them by deserializing the entire
 * store: 140 MB of JSON for a 20 000-product shop, several times that as a
 * live object graph. That is per call, and the Publish tab makes one call per
 * batch, back to back.
 */
export async function getSnapshotProductsBySkus(
  skus: string[],
): Promise<Map<string, StoreModel["products"][number]>> {
  const out = new Map<string, StoreModel["products"][number]>();
  if (skus.length === 0) return out;
  const keys = [...new Set(skus.map((s) => s.trim().toUpperCase()))].filter(Boolean);
  if (keys.length === 0) return out;
  try {
    const res = await db.execute(sql`
      select upper(trim(coalesce(p->>'sku', ''))) as key, p as product
      from ${storeSnapshot}, jsonb_array_elements(${storeSnapshot.data}->'products') as p
      where ${storeSnapshot.id} = ${SINGLETON}
        and upper(trim(coalesce(p->>'sku', ''))) in (
          select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)
        )
    `);
    for (const r of rowsOf<{ key: string; product: unknown }>(res)) {
      if (!out.has(r.key)) out.set(r.key, r.product as StoreModel["products"][number]);
    }
    return out;
  } catch (e) {
    console.warn("[snapshot] product read skipped:", e instanceof Error ? e.message : e);
    return out;
  }
}

/**
 * The snapshot's products with these store ids, unrolled from the jsonb IN SQL
 * and ordered by id — the apply's read: it needs the products its run covers,
 * not the store. Best-effort: [] when unreadable, which reads as "the snapshot
 * has nothing to say about them", as no snapshot already does.
 */
export async function getSnapshotProductsByIds(ids: number[]): Promise<StoreProductModel[]> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return [];
  try {
    const res = await db.execute(sql`
      select p as product
      from ${storeSnapshot} s, jsonb_array_elements(s.data->'products') as p
      where s.id = ${SINGLETON}
        and ${productId} in (select jsonb_array_elements_text(${JSON.stringify(unique)}::jsonb)::bigint)
      order by ${productId}
    `);
    return rowsOf<{ product: StoreProductModel }>(res).map((r) => r.product);
  } catch (e) {
    console.warn("[snapshot] product read skipped:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Every store SKU in its ORIGINAL spelling, deduped by canonical key.
 *
 * listStoreSkus answers "does the store carry this", which only needs the
 * canonical form. A preview needs the spelling too: these strings are sent
 * back out to the price source, and upper-casing a style code on the way is
 * not this app's decision to make.
 */
export async function listStoreSkuSpellings(): Promise<string[]> {
  try {
    const res = await db.execute(sql`
      select distinct on (upper(trim(p->>'sku'))) p->>'sku' as sku
      from ${storeSnapshot}, jsonb_array_elements(${storeSnapshot.data}->'products') as p
      where ${storeSnapshot.id} = ${SINGLETON} and coalesce(trim(p->>'sku'), '') <> ''
      order by upper(trim(p->>'sku'))
    `);
    return rowsOf<{ sku?: string | null }>(res)
      .map((r) => r.sku)
      .filter((s): s is string => !!s);
  } catch (e) {
    console.warn("[snapshot] store SKU list skipped:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Replace (or append) these products inside the stored snapshot, keyed by
 * canonical SKU, WITHOUT the blob ever entering this process.
 *
 * This is the write half of the same problem. Patching used to mean: read the
 * whole store into memory, map over every product to swap a few, then hand the
 * whole thing back to the driver to re-serialize. On a 20 000-product store
 * that is ~140 MB in and ~140 MB out per call, and publishing a selection is
 * one call per batch — enough churn, next to a dev server's own footprint, to
 * lose the collector and die on "Ineffective mark-compacts near heap limit".
 *
 * Postgres does the swap. What crosses the wire is only the products that
 * actually changed. Best-effort, like the patch it replaces: a snapshot that
 * cannot be updated is stale, never fatal to the write that just succeeded.
 *
 * Returns the resulting product count, or null when there is no snapshot to
 * patch (nothing has been pulled yet — there is no "on the store" to correct).
 */
export async function upsertSnapshotProducts(
  products: StoreModel["products"],
): Promise<number | null> {
  if (products.length === 0) return null;
  // Keyed by canonical SKU; a product without one replaces nothing (it is added).
  const keys = [...new Set(products.map((p) => (p.sku ?? "").trim().toUpperCase()).filter(Boolean))];
  try {
    return await withSnapshotWriteLock((tx) =>
      rewriteProducts(
        tx,
        sql`upper(trim(coalesce(p->>'sku', ''))) not in (select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))`,
        products,
      ),
    );
  } catch (e) {
    console.warn("[snapshot] patch skipped:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** One product of a long apply, as the store had it right after its write. */
export interface AsOfPatch {
  product: StoreProductModel;
  asOf: Date;
  /**
   * The write's own fields, laid over a copy patched after it by a patch of a
   * few fields (a sale learned meanwhile), instead of replacing that copy.
   * Omitted: the product replaces the copy (a cleanup changed its sizes).
   */
  wrote?: (product: StoreProductModel) => void;
}

/**
 * Write products as the store was at a given moment each — a long apply's
 * products, each as it stood right after its own write:
 *  - a copy taken after that moment (another write that landed while the
 *    apply was still going, a pull started after it) is the newer word and
 *    stays: putting the older copy over it made the newer write look like a
 *    WordPress edit to the next plan;
 *  - a copy patched after it in a few fields only (a sale learned) keeps
 *    them, and takes the write's own fields on top;
 *  - otherwise the product replaces the copy, dated by its own write, so a
 *    pull that started after it replaces it (see saveSnapshotKeepingPatches).
 */
export async function upsertSnapshotProductsAsOf(entries: AsOfPatch[]): Promise<number | null> {
  if (entries.length === 0) return null;
  const ids = [...new Set(entries.map((e) => e.product.id).filter((id) => Number.isInteger(id) && id > 0))];
  const inIds = (list: number[]) =>
    sql`${productId} in (select jsonb_array_elements_text(${JSON.stringify(list)}::jsonb)::bigint)`;
  try {
    return await withSnapshotWriteLock(async (tx) => {
      const savedAt = await savedAtIn(tx);
      const res = await tx.execute(sql`
        select ${productId} as id, p->>${AS_OF} as as_of, p->>${PATCHED_AT} as patched_at
        from ${storeSnapshot} s, jsonb_array_elements(s.data->'products') as p
        where s.id = ${SINGLETON} and ${inIds(ids)}
      `);
      const stamps = new Map<number, StoreProductModel>();
      for (const r of rowsOf<{ id: number | string; as_of: string | null; patched_at: string | null }>(res)) {
        stamps.set(Number(r.id), { [AS_OF]: r.as_of ?? undefined, [PATCHED_AT]: r.patched_at ?? undefined } as never);
      }
      const replace: StoreProductModel[] = [];
      const merge = new Map<number, AsOfPatch>();
      for (const e of entries) {
        const at = e.asOf.getTime();
        const current = stamps.get(e.product.id);
        const copied = current ? snapshotCopyTime(current, savedAt) : null;
        if (copied != null && copied > at) continue;
        const patched = current ? stampOf(current, PATCHED_AT) : null;
        if (patched != null && patched > at && e.wrote) merge.set(e.product.id, e);
        else replace.push({ ...e.product, [AS_OF]: e.asOf.toISOString(), [PATCHED_AT]: e.asOf.toISOString() });
      }
      const merged: StoreProductModel[] = [];
      if (merge.size > 0) {
        const rows = await tx.execute(sql`
          select p as product
          from ${storeSnapshot} s, jsonb_array_elements(s.data->'products') as p
          where s.id = ${SINGLETON} and ${inIds([...merge.keys()])}
        `);
        for (const { product } of rowsOf<{ product: StoreProductModel }>(rows)) {
          const e = merge.get(product.id);
          if (!e?.wrote) continue;
          freezeCopyTime(product, savedAt);
          e.wrote(product);
          merged.push(product);
        }
      }
      const incoming = [...replace, ...merged];
      if (incoming.length === 0) return null;
      const keys = [...new Set(incoming.map((p) => (p.sku ?? "").trim().toUpperCase()).filter(Boolean))];
      return rewriteProducts(
        tx,
        sql`upper(trim(coalesce(p->>'sku', ''))) not in (select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))`,
        incoming,
        true,
      );
    });
  } catch (e) {
    console.warn("[snapshot] patch skipped:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * When the snapshot's copy of a product was taken, at the earliest (see
 * AS_OF): its own stamp, else its last patch, else when the copy was saved.
 */
export function snapshotCopyTime(product: StoreProductModel, savedAt: Date | null): number | null {
  return stampOf(product, AS_OF) ?? stampOf(product, PATCHED_AT) ?? (savedAt ? savedAt.getTime() : null);
}

/**
 * Change one product of the snapshot, found by store id: read, changed and
 * written back under the write lock, so nothing written meanwhile is lost —
 * where loading the whole snapshot to edit one price, then saving all of it,
 * put back everything as it was at the load. False when the product is not
 * in the snapshot.
 */
export async function patchSnapshotProduct(
  storeProductId: number,
  change: (product: StoreProductModel) => void,
): Promise<boolean> {
  return withSnapshotWriteLock(async (tx) => {
    const res = await tx.execute(sql`
      select p as product
      from ${storeSnapshot} s, jsonb_array_elements(s.data->'products') as p
      where s.id = ${SINGLETON} and ${productId} = ${storeProductId}
      limit 1
    `);
    const product = rowsOf<{ product: StoreProductModel }>(res)[0]?.product;
    if (!product) return false;
    freezeCopyTime(product, await savedAtIn(tx));
    change(product);
    await rewriteProducts(tx, sql`${productId} <> ${storeProductId}`, [product]);
    return true;
  });
}

/**
 * Change many products of the snapshot at once, found by store id — those
 * without a SKU too: read, changed and written back in ONE pass under the
 * write lock, as patchSnapshotProduct does for one. Reading them first and
 * writing them later lost whatever landed in between (a pull's swap, a
 * publish batch). Returns how many it changed; 0 when none is in the
 * snapshot, or there is none.
 */
export async function patchSnapshotProducts(
  storeProductIds: readonly number[],
  change: (product: StoreProductModel) => void,
): Promise<number> {
  const ids = [...new Set(storeProductIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return 0;
  const wanted = sql`${productId} in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::bigint)`;
  return withSnapshotWriteLock(async (tx) => {
    const res = await tx.execute(sql`
      select p as product
      from ${storeSnapshot} s, jsonb_array_elements(s.data->'products') as p
      where s.id = ${SINGLETON} and ${wanted}
    `);
    const products = rowsOf<{ product: StoreProductModel }>(res).map((r) => r.product);
    if (products.length === 0) return 0;
    const savedAt = await savedAtIn(tx);
    for (const product of products) {
      freezeCopyTime(product, savedAt);
      change(product);
    }
    await rewriteProducts(tx, sql`not (${wanted})`, products);
    return products.length;
  });
}

/**
 * Drop products from the snapshot by store id (a duplicate just trashed, a
 * product deleted from the Vetrina), and remember when: a pull reading the
 * store right now may have read them before they went, and must not bring
 * them back (see saveSnapshotKeepingPatches).
 */
export async function removeSnapshotProducts(storeProductIds: number[]): Promise<void> {
  if (storeProductIds.length === 0) return;
  const now = new Date().toISOString();
  const removed = Object.fromEntries(storeProductIds.map((id) => [String(id), now]));
  await withSnapshotWriteLock(async (tx) => {
    await rewriteProducts(
      tx,
      sql`${productId} not in (select jsonb_array_elements_text(${JSON.stringify(storeProductIds)}::jsonb)::bigint)`,
      [],
    );
    await tx.execute(sql`
      update ${storeSnapshot} s
      set data = s.data || jsonb_build_object(${REMOVED}::text, coalesce(s.data->${REMOVED}, '{}'::jsonb) || ${JSON.stringify(removed)}::jsonb)
      where s.id = ${SINGLETON}
    `);
  });
}
