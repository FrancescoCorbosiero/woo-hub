import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Real-SQL tests of a product made by hand ("Aggiungi prodotti"): the shop
 * owns it — a "store" pin in the Hub's overrides — and every source honours
 * that, the supplier's feed above all, even when the feed carries the same
 * code: not its owner, not delisted (zeroed), not offered by Publish, not
 * coloured as the feed's. Opt-in, like the other DB suites:
 *
 *   DATABASE_URL=postgres://…@localhost:…/hub_test npm run test:db
 */

const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

vi.mock("@/server/collections/store", () => ({ storeReady: () => true, demoMode: () => false }));

const HANDMADE = "HM-DBTEST1";
const DROPPED = "HM-DBTEST2";
const FEED = "GS-DBTEST3";
const SKUS = [HANDMADE, DROPPED, FEED];

const load = async () => ({
  ...(await import("drizzle-orm")),
  ...(await import("@/server/db/client")),
  ...(await import("@/server/db/schema")),
  ...(await import("@/server/overrides/repo")),
  ...(await import("@/server/overrides/model")),
  ...(await import("@/server/feeds/owner")),
  ...(await import("@/server/vetrina/sources")),
  ...(await import("@/server/woo/publish")),
});

describe.skipIf(!enabled)("a product made by hand (real SQL)", () => {
  afterAll(async () => {
    const { db, catalogProducts, feedItems, storeOverrides, inArray } = await load();
    await db.delete(catalogProducts).where(inArray(catalogProducts.sku, SKUS));
    await db.delete(feedItems).where(inArray(feedItems.sku, SKUS));
    await db.delete(storeOverrides);
  });

  beforeEach(async () => {
    const { db, catalogProducts, feedItems, storeOverrides, inArray, saveOverrides, withProductOwner, emptyOverrides } = await load();
    await db.delete(storeOverrides);
    await db.delete(catalogProducts).where(inArray(catalogProducts.sku, SKUS));
    await db.delete(feedItems).where(inArray(feedItems.sku, SKUS));
    // The feed carries HANDMADE and FEED, and listed DROPPED once.
    const item = (sku: string, active: boolean) => ({
      feed: "goldensneakers",
      sku,
      euNorm: "42",
      sizeLabel: "42",
      quantity: active ? 3 : 0,
      active,
      presentedPrice: 120,
      offerPrice: 80,
      productName: sku,
      brandName: "Nike",
    });
    await db.insert(feedItems).values([item(HANDMADE, true), item(DROPPED, false), item(FEED, true)]);
    // The feed's products are in the catalog, as its sync files them.
    const row = (sku: string) => ({
      market: "IT",
      sku,
      source: "goldensneakers",
      stockxId: `sx-${sku}`,
      title: sku,
      // Publish offers only a product with a size.
      variantCount: 1,
      data: { sku, title: sku, brand: "Nike", image: "", market: "IT", currency: "EUR", source: "goldensneakers", stockxId: `sx-${sku}`, variants: [] } as never,
    });
    await db.insert(catalogProducts).values([row(HANDMADE), row(FEED)]);
    // Two made by hand: one the feed carries, one it dropped.
    await saveOverrides(withProductOwner(withProductOwner(emptyOverrides(), HANDMADE, "store"), DROPPED, "store"));
  });

  it("is never the feed's, nor zeroed as one it dropped", async () => {
    const { gsFeedStatus, getOverrides } = await load();
    const status = await gsFeedStatus(SKUS, "IT", await getOverrides());
    expect([...status.owned.keys()]).toEqual([FEED]);
    expect([...status.delisted]).toEqual([]);
    // Without the pin, the feed would own the one and zero the other.
    const blind = await gsFeedStatus(SKUS, "IT", null);
    expect([...blind.owned.keys()].sort()).toEqual([FEED, HANDMADE].sort());
    expect([...blind.delisted]).toEqual([DROPPED]);
  });

  it("is the shop's own in the catalog's colours", async () => {
    const { readSourceFacts, productSource } = await load();
    const facts = await readSourceFacts();
    expect(productSource(HANDMADE, facts)).toBe("woo");
    expect(productSource(DROPPED, facts)).toBe("woo");
    expect(productSource(FEED, facts)).toBe("goldensneakers");
  });

  it("is never offered by Publish, nor published by the automatic sync", async () => {
    const { listPublishTargets } = await load();
    const page = await listPublishTargets({}, 1000);
    const skus = page.candidates.map((c) => c.sku);
    expect(skus).toContain(FEED);
    expect(skus).not.toContain(HANDMADE);
  });
});
