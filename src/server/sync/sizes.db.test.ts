import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Real-SQL tests of the sizes a store product is missing: a size the feed
 * sells that the product on WooCommerce does not have. The plan has always
 * listed them ("create" rows, the tab's "new"); until now no apply wrote them,
 * so a product published while the supplier listed one size kept one size.
 * Opt-in, like the other DB suites:
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://…@localhost:…/… REDIS_URL=… npm test
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

interface FakeVariation {
  id: number;
  sku: string;
  regular_price: string;
  manage_stock: boolean;
  stock_quantity: number;
  global_unique_id?: string;
  attributes: unknown;
}

const store = vi.hoisted(() => ({
  products: new Map<number, FakeVariation[]>(),
  parents: new Map<number, { attributes: unknown[] }>(),
  nextId: 100,
  creates: 0,
}));

vi.mock("@/server/woo/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/woo/client")>();
  const client = {
    getAllVariations: async (productId: number) => structuredClone(store.products.get(productId) ?? []),
    getProduct: async (productId: number) =>
      store.parents.has(productId) ? { id: productId, ...structuredClone(store.parents.get(productId)!) } : null,
    updateProduct: async (productId: number, body: { attributes?: unknown[] }) => {
      if (body.attributes) store.parents.set(productId, { attributes: structuredClone(body.attributes) });
    },
    batchVariations: async (
      productId: number,
      payload: { create?: Record<string, unknown>[]; update?: Record<string, unknown>[] },
    ) => {
      const sizes = store.products.get(productId) ?? [];
      const create = (payload.create ?? []).map((row) => {
        store.creates += 1;
        const id = store.nextId++;
        const attrs = row.attributes as { option: string }[];
        sizes.push({
          id,
          sku: String(row.sku),
          regular_price: String(row.regular_price),
          manage_stock: row.manage_stock === true,
          stock_quantity: Number(row.stock_quantity ?? 0),
          attributes: [{ name: "pa_taglia", option: attrs[0].option }],
        });
        return { id };
      });
      const update = (payload.update ?? []).map((row) => {
        const v = sizes.find((s) => s.id === row.id);
        if (!v) return { id: row.id as number, error: { code: "invalid", message: "Invalid ID." } };
        if (row.regular_price != null) v.regular_price = String(row.regular_price);
        if (row.stock_quantity != null) v.stock_quantity = Number(row.stock_quantity);
        return { id: row.id as number };
      });
      store.products.set(productId, sizes);
      return { create, update, delete: [] };
    },
  };
  return { ...real, wooConfigured: () => true, getWooClient: () => client };
});

const load = async () => ({
  ...(await import("drizzle-orm")),
  ...(await import("@/server/db/client")),
  ...(await import("@/server/db/schema")),
  ...(await import("@/server/store-json/repo")),
  ...(await import("./ledger")),
  ...(await import("./price-sync")),
  ...(await import("@/server/actions/preview")),
  ...(await import("@/server/woo/apply")),
});

const SKU = "AR3566-002";
const size = (id: number, eu: string, qty: number): FakeVariation => ({
  id,
  sku: `${SKU}-EU${eu}`,
  regular_price: "138.00",
  manage_stock: true,
  stock_quantity: qty,
  attributes: [{ name: "pa_taglia", option: eu }],
});
const feedRow = (eu: string, quantity: number) => ({
  feed: "goldensneakers",
  sku: SKU,
  euNorm: eu,
  sizeLabel: eu,
  quantity,
  active: true,
  presentedPrice: 138,
  offerPrice: 87,
  productName: "Nike Shox TL",
  brandName: "Nike",
});
const labels = () => store.products.get(1)!.map((v) => (v.attributes as { option: string }[])[0].option).sort();

async function walk(skus: string[]) {
  const { startStoreSync, advanceStoreSync } = await load();
  let progress = (await startStoreSync(undefined, skus)).progress!;
  while (!progress.done) progress = (await advanceStoreSync(progress.runId)).progress!;
  return progress;
}

describe.skipIf(!enabled)("sizes a store product is missing (real SQL, stand-in store)", () => {
  beforeEach(async () => {
    const { db, feedItems, priceLedger, storeOverrides, saveSnapshot } = await load();
    await db.delete(feedItems);
    await db.delete(priceLedger);
    await db.delete(storeOverrides);
    store.products.set(1, [size(11, "36", 3)]);
    store.parents.set(1, { attributes: [{ id: 3, name: "pa_taglia", options: ["36"], variation: true, visible: true }] });
    store.nextId = 100;
    store.creates = 0;
    await saveSnapshot(
      {
        products: [
          { id: 1, sku: SKU, name: "Nike Shox TL", attributes: structuredClone(store.parents.get(1)!.attributes), variations: structuredClone(store.products.get(1)) },
        ],
      } as never,
      "rest",
    );
    await db.insert(feedItems).values([feedRow("36", 3), feedRow("38", 23), feedRow("40", 22), feedRow("41", 0)]);
  });

  it("the feed cycle adds the in-stock sizes the feed lists, and the next one has nothing left to add", async () => {
    const { runPriceSync, getSnapshotProductsByIds, db, priceLedger } = await load();
    const run = await runPriceSync({ skus: [SKU], liveCheck: true, addSizes: "feed" });
    expect(run.outcome?.sizes.added).toBe(2); // 38 and 40; 41 is sold out
    expect(labels()).toEqual(["36", "38", "40"]);
    expect(store.parents.get(1)!.attributes[0]).toMatchObject({ options: ["36", "38", "40"] });
    expect(store.products.get(1)!.find((v) => v.sku.endsWith("EU38"))).toMatchObject({ regular_price: "138.00", stock_quantity: 23 });

    // The Hub's copy learned them, and the ledger watches their prices.
    const [snap] = await getSnapshotProductsByIds([1]);
    expect(snap.variations).toHaveLength(3);
    expect((await db.select().from(priceLedger)).map((r) => r.euSize).sort()).toEqual(["36", "38", "40"]);

    const next = await runPriceSync({ skus: [SKU], liveCheck: true, addSizes: "feed" });
    expect(next.outcome).toBeNull();
    expect(store.creates).toBe(2);
  });

  it("more sizes than the cap: the prices and stock are written, the sizes wait for the Sync tab", async () => {
    const { runPriceSync, db, feedItems } = await load();
    await db.update(feedItems).set({ presentedPrice: 160 }); // 36 needs a new price (past the 3% threshold)
    const run = await runPriceSync({ skus: [SKU], liveCheck: true, maxChanges: 2, addSizes: "feed" });
    expect(run.capped).toBeNull();
    expect(run.sizesHeld).toBe(2);
    expect(run.outcome?.updated).toBe(1);
    expect(store.products.get(1)!.find((v) => v.id === 11)?.regular_price).toBe("160.00");
    expect(store.creates).toBe(0);
  });

  it("a size that reached the store after the plan is not created twice", async () => {
    const { runPriceSync } = await load();
    // Someone adds 38 in WordPress; the Hub's copy has not seen it.
    store.products.get(1)!.push(size(50, "38", 1));
    const run = await runPriceSync({ skus: [SKU], liveCheck: true, addSizes: "feed" });
    expect(run.outcome?.sizes.added).toBe(1);
    expect(labels()).toEqual(["36", "38", "40"]);
  });

  it("without addSizes nothing is added — the Vetrina's and the store-edit list's prices-only runs", async () => {
    const { runPriceSync } = await load();
    const run = await runPriceSync({ skus: [SKU], liveCheck: true });
    expect(run.report.totals?.create).toBe(2);
    expect(store.creates).toBe(0);
  });

  it("the Sync tab adds what is ticked, and the dry run says so first", async () => {
    const { applySync } = await load();
    const progress = await walk([SKU]);
    const runId = progress.runId;
    const base = { runId, priceScope: "all" as const, sanitize: true, backfillGtins: true, addSizes: "all" as const };

    const dry = await applySync({ ...base, dryRun: true });
    expect(dry.sizes.planned).toBe(2);
    expect(dry.sizes.sample.map((s) => s.sizeLabel)).toEqual(["38", "40"]);
    expect(store.creates).toBe(0);

    // The operator unticks 40.
    const live = await applySync({
      ...base,
      dryRun: false,
      excluded: [{ planId: (await planIdOf(runId))!, variantIds: [`gs:${SKU}:40`] }],
    });
    expect(live.status).toBe("applied");
    expect(live.sizes.added).toBe(1);
    expect(labels()).toEqual(["36", "38"]);
  });
});

async function planIdOf(runId: string): Promise<string | undefined> {
  const { planRunIds } = await import("@/server/plans/repo");
  return (await planRunIds(runId))[0];
}
