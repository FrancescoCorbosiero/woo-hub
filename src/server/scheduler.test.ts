import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationConfig } from "@core/config";
import { DEFAULT_AUTOMATION } from "@/lib/automation";

/**
 * The scheduler follows the Automatic sync settings while it runs: a change
 * saved on the Feeds tab re-arms the timers it concerns — the feed cycle on a
 * new interval, or stopped; the daily run on new times; the orders pull on a
 * new interval, or stopped, or started — and never leaves two timers for one
 * run. Fake timers; the steps stand in, and there is no database (the run
 * history is unavailable, so boot runs the day's missed sync a minute on).
 */

const settings = vi.hoisted(() => ({
  current: null as AutomationConfig | null,
  listener: null as null | ((next: AutomationConfig, previous: AutomationConfig) => void),
}));
vi.mock("@/server/automation/settings", () => ({
  automationNow: () => settings.current,
  loadAutomation: async () => ({ settings: settings.current, saved: true, legacyEnv: [] }),
  onAutomationChange: (listener: (next: AutomationConfig, previous: AutomationConfig) => void) => {
    settings.listener = listener;
  },
  watchAutomation: () => {},
}));

const env = vi.hoisted(() => ({
  SCHEDULER: "on",
  GS_FEED_URL: "https://gs.example.com/api/assortment-flat/" as string | undefined,
  GS_FEED_TOKEN: "t" as string | undefined,
  HUB_ROLE: undefined as "writer" | "web" | undefined,
}));
vi.mock("@/lib/env", () => ({ env }));

// No database: every query throws, and the scheduler carries on without its history.
vi.mock("@/server/db/client", () => ({
  db: new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no database in this test");
      },
    },
  ),
}));

const steps = vi.hoisted(() => ({
  wooConfigured: vi.fn(() => false),
  gsSync: vi.fn(async () => ({ skus: 1, added: 0, updated: 0, deactivated: 0 })),
  backfill: vi.fn(async () => ({ scanned: 0, enriched: 0, missed: 0 })),
  pullOrders: vi.fn(async () => undefined),
}));
vi.mock("@/server/woo/client", () => ({ wooConfigured: steps.wooConfigured }));
vi.mock("@/server/woo/pull", () => ({
  getLatestPullRun: async () => null,
  pullInFlight: () => false,
  runFullPull: async () => ({ status: "done", productsFetched: 0 }),
}));
vi.mock("@/server/woo/media", () => ({ drainMedia: async () => ({ steps: 0, more: false, unreachable: null }) }));
vi.mock("@/server/orders/pull", () => ({ pullRecentOrders: steps.pullOrders }));
vi.mock("@/server/feeds/goldensneakers", () => ({ gsConfigured: () => true, syncGoldenSneakersFromApi: steps.gsSync }));
vi.mock("@/server/adapters/kicksdb", () => ({ kicksdbConfigured: () => false }));
vi.mock("@/server/actions/feeds", () => ({ runKicksdbRefresh: async () => ({ ok: true }) }));
vi.mock("@/server/collections/runner", () => ({ runFull: async () => null, runCheck: async () => null }));
vi.mock("@/server/catalog/enrich", () => ({ backfillCatalogMetadata: steps.backfill }));
vi.mock("@/server/catalog/repo", () => ({
  recategorizeCatalog: async () => ({ classified: 0, unified: 0, synced: 0 }),
}));
vi.mock("@/server/config/repo", () => ({ getActiveConfig: async () => ({ source: { market: "IT" } }) }));
vi.mock("@/server/retention", () => ({
  pruneRunLogs: async () => ({ syncRuns: 0, ingestionRuns: 0, applyRuns: 0, vetrinaOperations: 0, vetrinaProposals: 0 }),
}));
// The store sync's own inputs: the feed's products on the store, and the plan-and-write.
vi.mock("@/server/feeds/repo", () => ({ GS_FEED: "goldensneakers", knownFeedSkus: async () => new Set(["FEED-1"]) }));
vi.mock("@/server/store-json/repo", () => ({ listStoreSkuSpellings: async () => ["FEED-1", "KICKS-1"] }));
const priceSync = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/server/sync/price-sync", () => ({ runPriceSync: priceSync.run }));
// Publish: what the store lacks, and the creating itself.
const publisher = vi.hoisted(() => ({
  page: { hasSnapshot: true, candidates: [] as { sku: string; source: string; onStore: boolean }[] },
  publish: vi.fn(async (skus: string[], _options?: unknown) => ({
    created: skus.length,
    completed: 0,
    products: skus.map((sku) => ({ sku, error: null as string | null })),
  })),
}));
vi.mock("@/server/woo/publish", () => ({
  listPublishTargets: async () => publisher.page,
  publishProducts: (skus: string[], options: unknown) => publisher.publish(skus, options),
}));

/** Save new settings, as the Feeds tab does: the listener hears the change. */
function change(patch: Partial<AutomationConfig>): void {
  const previous = settings.current!;
  settings.current = { ...previous, ...patch };
  settings.listener!(settings.current, previous);
}

// 30 October 2026, 11:05 in Rome (UTC+1): the feed cycle's next mark is 11:15.
const NOW = new Date("2026-10-30T10:05:00Z");
const MIN = 60_000;

async function start(patch: Partial<AutomationConfig> = {}) {
  settings.current = { ...DEFAULT_AUTOMATION, ...patch };
  const scheduler = await import("./scheduler");
  scheduler.startScheduler();
  // Boot finds no history: the 04:30 sync runs a minute on, then tomorrow's is armed.
  await vi.advanceTimersByTimeAsync(61_000);
  await vi.waitFor(() => expect(scheduler.getSchedulerStatus().nextRunAt).toBe(Date.UTC(2026, 9, 31, 3, 30)));
  expect(steps.backfill).toHaveBeenCalledTimes(1);
  return scheduler.getSchedulerStatus;
}

describe("the scheduler, when the Automatic sync settings change", () => {
  beforeEach(() => {
    vi.resetModules();
    const g = globalThis as Record<string, unknown>;
    delete g.__storeHubScheduler;
    delete g.__storeHubSchedulerTimers;
    settings.listener = null;
    env.HUB_ROLE = undefined;
    env.GS_FEED_URL = "https://gs.example.com/api/assortment-flat/";
    priceSync.run.mockReset();
    for (const fn of Object.values(steps)) fn.mockClear();
    steps.wooConfigured.mockReturnValue(false);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("moves the next feed cycle to the new interval, and stops it with the store sync", async () => {
    const status = await start();
    expect(status()).toMatchObject({ feedsEveryMinutes: 15, autoSync: "feed", feedsNextAt: Date.UTC(2026, 9, 30, 10, 15) });

    // Every 20 minutes: the 11:15 cycle is gone, the next one is 11:20.
    change({ feedsEveryMinutes: 20 });
    expect(status()).toMatchObject({ feedsEveryMinutes: 20, feedsNextAt: Date.UTC(2026, 9, 30, 10, 20) });
    await vi.advanceTimersByTimeAsync(10 * MIN); // 11:16
    expect(status().feedsLastAt).toBeNull();
    await vi.advanceTimersByTimeAsync(5 * MIN); // 11:21
    await vi.waitFor(() => expect(status().feedsNextAt).toBe(Date.UTC(2026, 9, 30, 10, 40)));
    expect(status().feedsLastAt).not.toBeNull();
    const cycles = steps.gsSync.mock.calls.length;

    // Off: no cycle, nothing written — and none armed behind the screen's back.
    change({ storeSync: false });
    expect(status()).toMatchObject({ feedsEveryMinutes: 0, autoSync: "off", feedsNextAt: null });
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(steps.gsSync).toHaveBeenCalledTimes(cycles);

    // On again: the next mark on the clock, one timer only.
    change({ storeSync: true });
    expect(status().feedsNextAt).toBe(Date.UTC(2026, 9, 30, 11, 40));
    change({ feedsEveryMinutes: 30 });
    expect(status().feedsNextAt).toBe(Date.UTC(2026, 9, 30, 11, 30));
    await vi.advanceTimersByTimeAsync(31 * MIN); // past 12:30 and 12:40
    await vi.waitFor(() => expect(status().feedsNextAt).toBe(Date.UTC(2026, 9, 30, 12, 0)));
    expect(steps.gsSync).toHaveBeenCalledTimes(cycles + 1);
  });

  it("moves the next daily sync to the new times, without running the old slot too", async () => {
    const status = await start({ storeSync: false });
    change({ dailyTimes: ["12:00", "20:00"] });
    expect(status().nextRunAt).toBe(Date.UTC(2026, 9, 30, 11, 0));

    await vi.advanceTimersByTimeAsync(56 * MIN); // 12:01 in Rome
    await vi.waitFor(() => expect(status().nextRunAt).toBe(Date.UTC(2026, 9, 30, 19, 0)));
    expect(steps.backfill).toHaveBeenCalledTimes(2);

    // A new time zone moves it too: it is 11:01 in London, so its 12:00 comes first.
    change({ timeZone: "Europe/London" });
    expect(status().nextRunAt).toBe(Date.UTC(2026, 9, 30, 12, 0));
    // Through tomorrow's 04:30, the old slot: only the new times run, 12:00 and 20:00 in London.
    await vi.advanceTimersByTimeAsync(18 * 60 * MIN);
    await vi.waitFor(() => expect(status().nextRunAt).toBe(Date.UTC(2026, 9, 31, 12, 0)));
    expect(steps.backfill).toHaveBeenCalledTimes(4);
  });

  it("stops the orders pull at 0, and starts it again a minute after it is turned back on", async () => {
    steps.wooConfigured.mockReturnValue(true);
    const status = await start({ storeSync: false });
    // The first pull, a minute after boot; the next one 15 minutes on.
    expect(steps.pullOrders).toHaveBeenCalledTimes(1);

    change({ ordersEveryMinutes: 0 });
    expect(status().ordersEveryMinutes).toBe(0);
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(steps.pullOrders).toHaveBeenCalledTimes(1);

    change({ ordersEveryMinutes: 5 });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(steps.pullOrders).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(steps.pullOrders).toHaveBeenCalledTimes(3);

    // A shorter interval while one is armed: the next turn moves, and there is only one.
    change({ ordersEveryMinutes: 2 });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(steps.pullOrders).toHaveBeenCalledTimes(8);
  });

  it("follows the limits and the store sync's reach without re-arming anything", async () => {
    const status = await start();
    const next = status().feedsNextAt;
    change({ maxChanges: 50, storeMaxChanges: 5000, dailyStoreSync: true });
    expect(status()).toMatchObject({ autoSyncMax: 50, autoSyncStoreMax: 5000, autoSync: "all", feedsNextAt: next });
  });
});

/** A plan-and-write that wrote `updated` changes, kept `kept` prices changed on the store and added `added` sizes. */
const wrote = (updated: number, kept = 0, added = 0) => ({
  outcome: { updated, variations: updated, failedTotal: 0, failed: [], keptStoreEdits: kept, sizes: { added } },
  capped: null,
  sizesHeld: null,
  deferred: null,
});

describe("Sincronizza ora: the automatic sync, now, by hand", () => {
  beforeEach(() => {
    vi.resetModules();
    const g = globalThis as Record<string, unknown>;
    delete g.__storeHubScheduler;
    delete g.__storeHubSchedulerTimers;
    settings.listener = null;
    env.HUB_ROLE = undefined;
    env.GS_FEED_URL = "https://gs.example.com/api/assortment-flat/";
    priceSync.run.mockReset();
    publisher.page = { hasSnapshot: true, candidates: [] };
    publisher.publish.mockClear();
    delete (globalThis as Record<string, unknown>).__storeHubPublishRefused;
    for (const fn of Object.values(steps)) fn.mockClear();
    steps.wooConfigured.mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("writes the feed's changes even with the automatic store sync off, and says what it did", async () => {
    const heartbeat = vi.spyOn(globalThis, "fetch");
    const status = await start({ storeSync: false, feedsHeartbeatUrl: "https://hc-ping.com/feeds" });
    expect(status()).toMatchObject({ autoSync: "off", feedsEveryMinutes: 0 });
    priceSync.run.mockResolvedValue(wrote(12, 2, 1));

    const { syncNow } = await import("./scheduler");
    expect(syncNow()).toEqual({ started: true, steps: ["gs", "publish", "feedSync"] });
    // One at a time: a second press is told one is going, and follows it.
    expect(status().current).toMatchObject({ kind: "manual", steps: ["gs", "publish", "feedSync"] });
    expect(syncNow()).toEqual({ started: false, reason: "running" });

    await vi.waitFor(() => expect(status().current).toBeNull());
    expect(status().lastManual).toMatchObject({
      error: null,
      summary: {
        gs: { ok: true, feed: { added: 0, updated: 0, deactivated: 0 } },
        feedSync: { ok: true, sync: { written: 12, added: 1, kept: 2, failed: 0, held: 0 } },
      },
    });
    // The feed's products, under the feed's limit; the monitors hear only the scheduled runs.
    expect(priceSync.run).toHaveBeenCalledWith(expect.objectContaining({ skus: ["FEED-1"], maxChanges: 500 }));
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it("writes nothing past the safety limit, and says how many changes it found", async () => {
    const status = await start({ maxChanges: 300 });
    priceSync.run.mockResolvedValue({ outcome: null, capped: 900, sizesHeld: null, deferred: null });
    const { syncNow } = await import("./scheduler");
    expect(syncNow().started).toBe(true);
    await vi.waitFor(() => expect(status().current).toBeNull());
    expect(status().lastManual?.summary.feedSync).toMatchObject({ ok: false, capped: { planned: 900, limit: 300 } });
    expect(status().lastManual?.error).toMatch(/900 changes planned/);
  });

  it("does the rest of the store too when the KicksDB prices are included, leaving the feed's products to the feed's pass", async () => {
    const kicksdb = await import("@/server/adapters/kicksdb");
    vi.spyOn(kicksdb, "kicksdbConfigured").mockReturnValue(true);
    // The boot's catch-up writes the store too, now: nothing to write there.
    priceSync.run.mockResolvedValue(wrote(0));
    const status = await start({ dailyStoreSync: true, storeMaxChanges: 40 });
    priceSync.run.mockReset();
    priceSync.run.mockResolvedValueOnce(wrote(3)).mockResolvedValueOnce(wrote(7));
    const { syncNow } = await import("./scheduler");
    expect(syncNow()).toEqual({ started: true, steps: ["gs", "publish", "feedSync", "kicksdb", "storeSync"] });
    await vi.waitFor(() => expect(status().current).toBeNull());
    expect(priceSync.run).toHaveBeenNthCalledWith(1, expect.objectContaining({ skus: ["FEED-1"], instalments: false }));
    expect(priceSync.run).toHaveBeenNthCalledWith(2, expect.objectContaining({ skus: ["KICKS-1"], maxChanges: 40, instalments: true }));
    expect(status().lastManual?.summary.storeSync).toMatchObject({ ok: true, sync: { written: 7 } });
  });

  it("is refused where there is nothing to sync, and in a process that is not the writer", async () => {
    env.GS_FEED_URL = undefined;
    const { syncNow } = await import("./scheduler");
    settings.current = { ...DEFAULT_AUTOMATION };
    expect(syncNow()).toEqual({ started: false, reason: "nothing" });
    env.GS_FEED_URL = "https://gs.example.com/api/assortment-flat/";
    env.HUB_ROLE = "web";
    expect(syncNow()).toEqual({ started: false, reason: "not-writer" });
  });
});

describe("auto-publish: the feed's new products, as soon as the feed lists them", () => {
  const feedProduct = (i: number) => ({ sku: `NEW-${i}`, source: "goldensneakers", onStore: false });

  beforeEach(() => {
    vi.resetModules();
    const g = globalThis as Record<string, unknown>;
    for (const key of ["__storeHubScheduler", "__storeHubSchedulerTimers", "__storeHubPublishRefused"]) delete g[key];
    settings.listener = null;
    env.HUB_ROLE = undefined;
    env.GS_FEED_URL = "https://gs.example.com/api/assortment-flat/";
    priceSync.run.mockReset();
    priceSync.run.mockResolvedValue(wrote(0));
    publisher.publish.mockClear();
    for (const fn of Object.values(steps)) fn.mockClear();
    steps.wooConfigured.mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("publishes the feed's products the store lacks — never a KicksDB pick, never one already there — 20 a run", async () => {
    publisher.page = {
      hasSnapshot: true,
      candidates: [
        ...Array.from({ length: 23 }, (_, i) => feedProduct(i)),
        { sku: "KICKS-PICK", source: "kicksdb", onStore: false },
        { sku: "ON-STORE", source: "goldensneakers", onStore: true },
      ],
    };
    const status = await start();
    publisher.publish.mockClear();
    const { syncNow } = await import("./scheduler");
    syncNow();
    await vi.waitFor(() => expect(status().current).toBeNull());
    const skus = publisher.publish.mock.calls[0][0];
    expect(skus).toHaveLength(20);
    expect(skus).not.toContain("KICKS-PICK");
    expect(skus).not.toContain("ON-STORE");
    expect(publisher.publish.mock.calls[0][1]).toEqual({ dryRun: false });
    expect(status().lastManual?.summary.publish).toMatchObject({ ok: true, published: { created: 20, failed: 0, waiting: 3 } });
  });

  it("leaves a product the store refused alone for the next cycles, and publishes nothing without a copy of the store", async () => {
    publisher.page = { hasSnapshot: true, candidates: [feedProduct(1), feedProduct(2)] };
    publisher.publish.mockImplementation(async (skus: string[]) => ({
      created: skus.filter((sku) => sku !== "NEW-1").length,
      completed: 0,
      products: skus.map((sku) => ({ sku, error: sku === "NEW-1" ? "no EU-sized variants" : null })),
    }));
    const status = await start();
    // The boot's daily run tried both; the store refused NEW-1.
    expect(publisher.publish.mock.calls[0][0]).toEqual(["NEW-1", "NEW-2"]);
    publisher.publish.mockClear();
    const { syncNow } = await import("./scheduler");
    syncNow();
    await vi.waitFor(() => expect(status().current).toBeNull());
    expect(publisher.publish.mock.calls[0][0]).toEqual(["NEW-2"]);

    publisher.page = { hasSnapshot: false, candidates: [feedProduct(3)] };
    publisher.publish.mockClear();
    syncNow();
    await vi.waitFor(() => expect(status().current).toBeNull());
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("publishes nothing unattended with the store sync off, nor with auto-publish off", async () => {
    publisher.page = { hasSnapshot: true, candidates: [feedProduct(1)] };
    // The boot's daily run, store sync off: nothing published.
    await start({ storeSync: false });
    expect(publisher.publish).not.toHaveBeenCalled();
    const { syncNow } = await import("./scheduler");
    settings.current = { ...DEFAULT_AUTOMATION, autoPublish: false };
    expect(syncNow()).toEqual({ started: true, steps: ["gs", "feedSync"] });
  });
});
