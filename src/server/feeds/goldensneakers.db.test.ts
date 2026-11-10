import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Real-SQL tests of the GoldenSneakers sync's writes: the feed rows and the
 * feed's catalog rows. The sync runs every quarter of an hour, and almost
 * all of the feed is as the last one left it: those rows must not be
 * rewritten (a row Postgres rewrote has a new xmin, whatever its values).
 * Opt-in: they need a THROWAWAY Postgres with the migrations applied, and
 * they empty feed_items, catalog_products and ingestion_runs. Run with
 *
 *   DATABASE_URL=postgres://…@localhost:…/hub_test npm run test:db
 *
 * Imports are dynamic because the db client validates the environment on load.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

const load = async () => ({
  ...(await import("drizzle-orm")),
  ...(await import("@/server/db/client")),
  ...(await import("@/server/db/schema")),
  ...(await import("@/server/db/rows")),
  ...(await import("@/server/config/repo")),
  ...(await import("@/server/catalog/repo")),
  ...(await import("./goldensneakers")),
});

const IMAGE = (sku: string) => `https://media.goldensneakers.net/products/images/2913_${sku}/raw/c67b5534062a.png`;

/** A feed row as the GS API sends it. */
const row = (id: number, sku: string, eu: string, quantity = 2, extra: Record<string, unknown> = {}) => ({
  id,
  sku,
  product_name: `adidas Samba OG ${sku}`,
  brand_name: "Adidas",
  barcode: `40679076${String(id).padStart(5, "0")}`,
  size_us: "8",
  size_eu: eu,
  offer_price: 70,
  presented_price: 119.9,
  available_quantity: quantity,
  image_full_url: IMAGE(sku),
  ...extra,
});

/** Two products, three sizes each. */
const FEED = [
  row(1, "JS3801", "40"),
  row(2, "JS3801", "41"),
  row(3, "JS3801", "42"),
  row(4, "JI2756", "40"),
  row(5, "JI2756", "41"),
  row(6, "JI2756", "42"),
];

/** Every feed and catalog row's version, by key. */
async function versions(): Promise<Map<string, string>> {
  const { db, sql, rowsOf } = await load();
  const res = await db.execute(sql`
    select 'feed:' || sku || ':' || eu_norm as k, xmin::text as v from feed_items
    union all
    select 'catalog:' || sku as k, xmin::text as v from catalog_products
  `);
  return new Map(rowsOf<{ k: string; v: string }>(res).map((r) => [r.k, r.v]));
}

/** The keys whose row was rewritten between two readings. */
const rewritten = (before: Map<string, string>, after: Map<string, string>) =>
  [...after].filter(([k, v]) => before.get(k) !== v).map(([k]) => k).sort();

describe.skipIf(!enabled)("the GoldenSneakers sync's writes (real SQL)", () => {
  async function empty() {
    const { db, feedItems, catalogProducts, ingestionRuns } = await load();
    await db.delete(feedItems);
    await db.delete(catalogProducts);
    await db.delete(ingestionRuns);
  }
  beforeEach(empty);
  // The suites share one database, file after file: nothing of this one's feed reaches the next.
  afterAll(empty);

  it("writes nothing when the feed is as the last sync left it", async () => {
    const { syncGoldenSneakers } = await load();
    const first = await syncGoldenSneakers(FEED);
    expect(first).toMatchObject({ rows: 6, skus: 2, added: 6, updated: 0, deactivated: 0, catalogRegistered: 2 });
    const before = await versions();
    expect(before.size).toBe(8);

    const again = await syncGoldenSneakers(FEED);
    expect(rewritten(before, await versions())).toEqual([]);
    expect(again).toMatchObject({ rows: 6, added: 0, updated: 0, deactivated: 0, catalogRegistered: 2 });
  });

  it("rewrites only the sizes that moved, and their product's catalog row", async () => {
    const { syncGoldenSneakers, getAnyBySkus, getActiveConfig } = await load();
    await syncGoldenSneakers(FEED);
    const before = await versions();

    const moved = FEED.map((r) => (r.id === 2 ? { ...r, available_quantity: 7 } : r));
    expect(await syncGoldenSneakers(moved)).toMatchObject({ added: 0, updated: 1, deactivated: 0 });
    expect(rewritten(before, await versions())).toEqual(["catalog:JS3801", "feed:JS3801:41"]);

    // The catalog row carries the feed's new word.
    const market = (await getActiveConfig()).source.market;
    const product = (await getAnyBySkus(market, ["JS3801"])).get("JS3801");
    const size41 = product?.variants.find((v) => v.sizeLabel === "41");
    expect(size41?.offers[0]?.asks).toBe(7);
  });

  it("switches off a size the feed dropped, and on again when it returns", async () => {
    const { db, feedItems, syncGoldenSneakers } = await load();
    await syncGoldenSneakers(FEED);
    const before = await versions();

    const dropped = FEED.filter((r) => r.id !== 6);
    expect(await syncGoldenSneakers(dropped)).toMatchObject({ added: 0, updated: 0, deactivated: 1 });
    expect(rewritten(before, await versions())).toEqual(["catalog:JI2756", "feed:JI2756:42"]);
    const off = (await db.select().from(feedItems)).filter((r) => !r.active).map((r) => `${r.sku}:${r.euNorm}`);
    expect(off).toEqual(["JI2756:42"]);

    expect(await syncGoldenSneakers(FEED)).toMatchObject({ added: 0, updated: 1, deactivated: 0 });
    expect((await db.select().from(feedItems)).every((r) => r.active)).toBe(true);
  });

  it("keeps a known image when a sync brings none, and writes nothing for it", async () => {
    const { db, feedItems, syncGoldenSneakers } = await load();
    await syncGoldenSneakers(FEED);
    const before = await versions();
    const blank = FEED.map((r) => ({ ...r, image_full_url: "" }));
    // The raw row differs (no image), so the sizes are rewritten — with the image kept.
    await syncGoldenSneakers(blank);
    expect((await db.select().from(feedItems)).every((r) => r.image === IMAGE(r.sku))).toBe(true);
    // And the next identical sync writes nothing at all.
    const settled = await versions();
    expect(rewritten(before, settled).length).toBeGreaterThan(0);
    await syncGoldenSneakers(blank);
    expect(rewritten(settled, await versions())).toEqual([]);
  });

  it("the feed's catalog rows stay fresh while the feed carries them, however old their fetchedAt", async () => {
    const { db, sql, catalogProducts, syncGoldenSneakers, getFreshBySkus, getActiveConfig, upsertCatalog } = await load();
    const market = (await getActiveConfig()).source.market;
    await syncGoldenSneakers(FEED);
    // Not rewritten for two days: the feed did not change them.
    await db.update(catalogProducts).set({ fetchedAt: sql`now() - interval '2 days'` });
    expect([...(await getFreshBySkus(market, ["JS3801", "JI2756"], 900)).keys()].sort()).toEqual(["JI2756", "JS3801"]);

    // A product the feed no longer carries goes stale like any other row.
    await syncGoldenSneakers(FEED.filter((r) => r.sku !== "JI2756"));
    expect([...(await getFreshBySkus(market, ["JS3801", "JI2756"], 900)).keys()]).toEqual(["JS3801"]);

    // A KicksDB row's freshness is still its fetchedAt.
    await upsertCatalog(market, [
      { stockxId: "x1", sku: "HUBTEST-KDB-1", title: "Dunk", brand: "Nike", image: "", market, currency: "EUR", variants: [] },
    ]);
    await db.update(catalogProducts).set({ fetchedAt: sql`now() - interval '2 days'` }).where(sql`${catalogProducts.sku} = 'HUBTEST-KDB-1'`);
    expect((await getFreshBySkus(market, ["HUBTEST-KDB-1"], 900)).size).toBe(0);
  });

  it("a KicksDB fetch still refreshes its rows, changed or not (the default)", async () => {
    const { db, sql, catalogProducts, getActiveConfig, upsertCatalog, getFreshBySkus } = await load();
    const market = (await getActiveConfig()).source.market;
    const dunk = { stockxId: "x1", sku: "HUBTEST-KDB-1", title: "Dunk", brand: "Nike", image: "", market, currency: "EUR", variants: [] };
    expect(await upsertCatalog(market, [dunk])).toBe(1);
    await db.update(catalogProducts).set({ fetchedAt: sql`now() - interval '2 days'` });
    expect(await upsertCatalog(market, [dunk])).toBe(1);
    expect((await getFreshBySkus(market, ["HUBTEST-KDB-1"], 900)).size).toBe(1);
    // The same product registered as a mirror's would be left alone.
    expect(await upsertCatalog(market, [dunk], { unchanged: "skip" })).toBe(0);
  });
});
