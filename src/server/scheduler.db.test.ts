import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SourceProduct } from "@core/core-spine";
import { DEFAULT_AUTOMATION } from "@/lib/automation";

/**
 * Real-SQL test of the scheduler's store syncs with the KicksDB prices
 * included (Automatic sync: dailyStoreSync), on a shop with both sources: the
 * daily run writes the KicksDB-priced products a few at a time
 * (storeMaxChanges a run) and leaves the feed's products to the feed cycle,
 * which writes them a quarter of an hour later. The settings are saved in the
 * config, as the Feeds tab saves them, and read back by the scheduler.
 * The scheduler itself runs, on fake timers; the store and KicksDB are
 * stand-ins, and so are the steps around the sync (pull, feed download,
 * re-pricing, categories, photos). Opt-in, like the other DB suites:
 *
 *   DATABASE_URL=postgres://…@localhost:…/hub_test npm run test:db
 *
 * It empties scheduler_runs, and the feed and the ledger, like the others,
 * and puts back the config it found.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

interface FakeVariation {
  id: number;
  sku: string;
  regular_price: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  attributes: { name: string; option: string }[];
}

const FEED = "SCH-FEED-1";
const FEED_ID = 9201;
const KICKS = ["SCH-KICKS-1", "SCH-KICKS-2", "SCH-KICKS-3"];
const KICKS_IDS = [9202, 9203, 9204];

const store = vi.hoisted(() => ({ products: new Map<number, FakeVariation[]>() }));
const kicks = vi.hoisted(() => ({ products: new Map<string, SourceProduct>() }));

vi.mock("@/server/woo/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/woo/client")>();
  const client = {
    getAllVariations: async (productId: number) => structuredClone(store.products.get(productId) ?? []),
    batchVariations: async (productId: number, payload: { update?: Record<string, unknown>[] }) => {
      const sizes = store.products.get(productId) ?? [];
      const update = (payload.update ?? []).map((row) => {
        const v = sizes.find((s) => s.id === row.id);
        if (!v) return { id: row.id as number, error: { code: "invalid", message: "Invalid ID." } };
        if (row.regular_price != null) v.regular_price = String(row.regular_price);
        if (row.stock_quantity != null) v.stock_quantity = Number(row.stock_quantity);
        return { id: row.id as number };
      });
      return { create: [], update, delete: [] };
    },
    updateProduct: async () => undefined,
  };
  return { ...real, wooConfigured: () => true, getWooClient: () => client };
});

vi.mock("@/server/adapters/kicksdb", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/adapters/kicksdb")>();
  const source = {
    getPricesBatch: async (skus: string[]) =>
      skus.map((s) => kicks.products.get(s.toUpperCase())).filter((p): p is SourceProduct => p != null).map((p) => structuredClone(p)),
    getProduct: async () => [],
    findBySku: async (sku: string) => structuredClone(kicks.products.get(sku.toUpperCase()) ?? null),
  };
  return { ...real, kicksdbConfigured: () => true, getSource: () => source };
});

// The steps around the sync: done, with nothing to say. Only the scheduler
// imports these, so they stand in whole.
vi.mock("@/server/woo/pull", () => ({
  getLatestPullRun: async () => null,
  pullInFlight: () => false,
  runFullPull: async () => ({ status: "done", productsFetched: 4 }),
}));
vi.mock("@/server/feeds/goldensneakers", () => ({
  gsConfigured: () => true,
  syncGoldenSneakersFromApi: async () => ({ skus: 1, added: 0, updated: 0, deactivated: 0 }),
}));
vi.mock("@/server/actions/feeds", () => ({
  runKicksdbRefresh: async () => ({ ok: true, refreshed: 0, requested: 0, remainingStale: 0 }),
}));
vi.mock("@/server/collections/runner", () => ({ runFull: async () => null, runCheck: async () => null }));
vi.mock("@/server/catalog/enrich", () => ({
  backfillCatalogMetadata: async () => ({ scanned: 0, enriched: 0, missed: 0 }),
}));
vi.mock("@/server/woo/media", () => ({ drainMedia: async () => ({ steps: 0, more: false, unreachable: null }) }));

const load = async () => ({
  ...(await import("drizzle-orm")),
  ...(await import("@/server/db/client")),
  ...(await import("@/server/db/schema")),
  ...(await import("@/server/store-json/repo")),
  ...(await import("@/server/automation/settings")),
  ...(await import("./scheduler")),
});

const size = (sku: string, id: number, eu: string, price: string, managed: boolean): FakeVariation => ({
  id,
  sku: `${sku}-EU${eu}`,
  regular_price: price,
  manage_stock: managed,
  stock_quantity: managed ? 3 : null,
  attributes: [{ name: "pa_taglia", option: eu }],
});

/** A KicksDB product: two sizes at a 200 € ask — far from the store's 100 €. */
const kicksProduct = (sku: string): SourceProduct => ({
  stockxId: `sx-${sku}`,
  sku,
  title: sku,
  brand: "Nike",
  image: "",
  market: "IT",
  currency: "EUR",
  variants: ["42", "43"].map((eu) => ({
    stockxVariantId: `${sku}-${eu}`,
    sizeLabel: eu,
    sizeType: "eu",
    sizes: [{ system: "eu", size: eu }],
    offers: [{ deliveryType: "standard" as const, lowestAsk: 200, asks: 5 }],
  })),
});

const feedRow = (eu: string) => ({
  feed: "goldensneakers",
  sku: FEED,
  euNorm: eu,
  sizeLabel: eu,
  quantity: 3,
  active: true,
  presentedPrice: 160,
  offerPrice: 100,
  productName: "Feed Low",
  brandName: "B",
});

/** Products whose sizes no longer show the store's old price. */
const written = (ids: number[], old: string) =>
  ids.filter((id) => store.products.get(id)!.every((v) => v.regular_price !== old)).length;

// 30 October 2026, 11:05 in Rome: the 04:30 sync never ran, the next feed cycle is at 11:15.
const NOW = new Date("2026-10-30T10:05:00Z");

describe.skipIf(!enabled)("the scheduler's store syncs, KicksDB prices included (real SQL, stand-in store and KicksDB)", () => {
  let savedConfig: unknown[] = [];

  beforeAll(async () => {
    vi.stubEnv("SCHEDULER", "on");
    vi.stubEnv("GS_FEED_URL", "https://gs.example.com/api/assortment-flat/");
    vi.stubEnv("GS_FEED_TOKEN", "test-token");

    const { db, config, feedItems, priceLedger, schedulerRuns, storeOverrides, saveSnapshot, saveAutomation } = await load();
    savedConfig = await db.select().from(config);
    // The Feeds tab's settings: the store follows the feed every 15 minutes, and
    // the daily sync writes the rest, two changes a run. No orders, no categories.
    await saveAutomation({
      ...DEFAULT_AUTOMATION,
      dailyStoreSync: true,
      storeMaxChanges: 2,
      ordersEveryMinutes: 0,
      collectionsEveryMinutes: 0,
    });
    await db.delete(schedulerRuns);
    await db.delete(feedItems);
    await db.delete(priceLedger);
    await db.delete(storeOverrides);
    store.products.set(FEED_ID, [size(FEED, 92011, "42", "138.00", true), size(FEED, 92012, "43", "138.00", true)]);
    KICKS.forEach((sku, i) => {
      const id = KICKS_IDS[i];
      store.products.set(id, [size(sku, id * 10 + 1, "42", "100.00", false), size(sku, id * 10 + 2, "43", "100.00", false)]);
      kicks.products.set(sku, kicksProduct(sku));
    });
    await saveSnapshot(
      {
        products: [FEED, ...KICKS].map((sku, i) => {
          const id = [FEED_ID, ...KICKS_IDS][i];
          return { id, sku, name: sku, variations: structuredClone(store.products.get(id)) };
        }),
      } as never,
      "rest",
    );
    await db.insert(feedItems).values([feedRow("42"), feedRow("43")]);
    // The stand-ins built on the real modules, built now: at the catch-up minute
    // two of the scheduler's timers import them at once, and an import that
    // arrives while one is still being built can get the real module instead.
    await import("@/server/woo/client");
    await import("@/server/adapters/kicksdb");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: NOW });
  });

  afterAll(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    const g = globalThis as Record<string, unknown>;
    for (const key of ["__storeHubScheduler", "__storeHubSchedulerTimers", "__storeHubAutomation"]) delete g[key];
    const { db, config, catalogProducts, feedItems, inArray } = await load();
    await db.delete(feedItems).where(inArray(feedItems.sku, [FEED]));
    await db.delete(catalogProducts).where(inArray(catalogProducts.sku, [FEED, ...KICKS]));
    await db.delete(config);
    if (savedConfig.length > 0) await db.insert(config).values(savedConfig as never);
  });

  // A whole daily run on a database the other suites have filled: more than the default 5 s.
  it("the daily run writes the KicksDB prices in instalments; the feed cycle, the feed's", { timeout: 60_000 }, async () => {
    const { db, schedulerRuns, getSchedulerStatus, startScheduler } = await load();
    startScheduler();
    expect(getSchedulerStatus()).toMatchObject({ autoSync: "all", autoSyncMax: 500, autoSyncStoreMax: 2, feedsEveryMinutes: 15 });

    // Boot finds the 04:30 sync missing and runs it a minute on.
    await vi.waitFor(() => expect(getSchedulerStatus().nextRunAt).not.toBeNull());
    await vi.advanceTimersByTimeAsync(61_000);
    // Done once the next slot is armed: tomorrow's 04:30.
    await vi.waitFor(() => expect(getSchedulerStatus().nextRunAt).toBe(Date.UTC(2026, 9, 31, 3, 30)), {
      timeout: 30_000,
    });

    let status = getSchedulerStatus();
    expect(status.lastError).toBeNull();
    // Three KicksDB products of two changes each, two changes a run: one product
    // written, two waiting. Not refused whole — and not the feed's product.
    expect(status.lastWritten).toBe(2);
    expect(status.lastDeferred).toBe(4);
    expect(written(KICKS_IDS, "100.00")).toBe(1);
    expect(written([FEED_ID], "138.00")).toBe(0);
    const [daily] = await db.select().from(schedulerRuns);
    expect(daily).toMatchObject({ trigger: "catch-up", status: "ok" });
    expect(daily.summary?.storeSync).toMatchObject({ ok: true, count: 2, deferred: 4 });

    // 11:15: the feed cycle writes the feed's product, and only that.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await vi.waitFor(() => expect(getSchedulerStatus().feedsNextAt).toBe(Date.UTC(2026, 9, 30, 10, 30)), {
      timeout: 30_000,
    });
    status = getSchedulerStatus();
    expect(status.feedsError).toBeNull();
    expect(status.feedsLastWritten).toBe(2);
    expect(store.products.get(FEED_ID)!.map((v) => v.regular_price)).toEqual(["160.00", "160.00"]);
    expect(written(KICKS_IDS, "100.00")).toBe(1);
  });

  it("records a run by hand apart from the daily runs: never the day's slot", { timeout: 60_000 }, async () => {
    const { db, eq, schedulerRuns, getSchedulerStatus, syncNow, lastManualRun } = await load();
    expect(syncNow()).toEqual({ started: true, steps: ["gs", "feedSync", "kicksdb", "storeSync"] });
    await vi.waitFor(() => expect(getSchedulerStatus().current).toBeNull(), { timeout: 30_000 });
    const rows = await db.select().from(schedulerRuns).where(eq(schedulerRuns.trigger, "manual"));
    expect(rows).toHaveLength(1);
    // The feed's product is in step already; the KicksDB ones go on, two changes a run.
    const last = await lastManualRun();
    expect(last?.summary.feedSync).toMatchObject({ ok: true, sync: { written: 0 } });
    expect(last?.summary.storeSync).toMatchObject({ ok: true, sync: { written: 2 }, deferred: 2 });
    expect(written(KICKS_IDS, "100.00")).toBe(2);
    // The next daily run is still tomorrow's: a run by hand serves no slot.
    expect(getSchedulerStatus().nextRunAt).toBe(Date.UTC(2026, 9, 31, 3, 30));
  });
});
