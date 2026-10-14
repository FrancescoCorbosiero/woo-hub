import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedPricingRule } from "@core/config";
import type { SourceProduct } from "@core/core-spine";

/**
 * Real-SQL test of a margin set on one of the shop's own categories (phase 4,
 * "Cambia il ricarico"): the store index says where the shop files each
 * product, the store's tree gives the term's ancestors, and the sync — the
 * same runPriceSync the Vetrina's reprice runs, with the live check — writes
 * the rule's price to the KicksDB-priced product and leaves the supplier's
 * price on the GoldenSneakers product in the same category. Opt-in, like the
 * other DB suites:
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://…@localhost:…/… REDIS_URL=… npm test
 *
 * KicksDB and the store are stand-ins; everything else is the real thing.
 * The suite puts back the config it found, and removes its own index and
 * catalog rows.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

interface FakeVariation {
  id: number;
  sku: string;
  regular_price: string;
  sale_price?: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  attributes: { name: string; option: string }[];
}

const KICKS = "STM-KICKS-1"; // priced by KicksDB
const FEED = "STM-FEED-1"; // priced by the GoldenSneakers feed
// The store's categories: 910 Sneakers › 911 Nike › 912 Nike Off-White.
const SNEAKERS = 910;
const NIKE = 911;
const OFF_WHITE = 912;
// Store product ids of their own: other suites leave index rows behind.
const K_ID = 9101;
const F_ID = 9102;

const store = vi.hoisted(() => ({
  products: new Map<number, FakeVariation[]>(),
  categories: [] as { id: number; name: string; slug: string; parent: number }[],
  /** The store's category listing fails (a 5xx after retries, a timeout). */
  treeDown: false,
}));

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
    listCategories: async () => {
      if (store.treeDown) throw Object.assign(new Error("Bad gateway"), { status: 502 });
      return structuredClone(store.categories);
    },
    listBrands: async () => [],
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
    fetchPricesRaw: async () => ({ data: [] }),
  };
  return { ...real, kicksdbConfigured: () => true, getSource: () => source };
});

const load = async () => ({
  ...(await import("drizzle-orm")),
  ...(await import("@/server/db/client")),
  ...(await import("@/server/db/schema")),
  ...(await import("@/server/store-json/repo")),
  ...(await import("@/server/config/repo")),
  ...(await import("@/server/config/defaults")),
  ...(await import("@/server/catalog/repo")),
  ...(await import("@/server/sync/price-sync")),
  ...(await import("@/server/actions/config")),
  ...(await import("@/server/config/rule-list")),
  ...(await import("@/components/catalog/drawer-data")),
  ...(await import("@/server/actions/debug")),
  ...(await import("./store-terms")),
});

/** A KicksDB product: two sizes at a 100 € ask. */
const kicksProduct: SourceProduct = {
  stockxId: "sx-stm-1",
  sku: KICKS,
  title: "Nike Off-White Dunk",
  brand: "Nike",
  image: "",
  market: "IT",
  currency: "EUR",
  variants: ["42", "43"].map((eu) => ({
    stockxVariantId: `stm-${eu}`,
    sizeLabel: eu,
    sizeType: "eu",
    sizes: [{ system: "eu", size: eu }],
    offers: [{ deliveryType: "standard" as const, lowestAsk: 100, asks: 5 }],
  })),
};

const size = (sku: string, id: number, eu: string, price: string, managed: boolean): FakeVariation => ({
  id,
  sku: `${sku}-EU${eu}`,
  regular_price: price,
  manage_stock: managed,
  stock_quantity: managed ? 3 : null,
  attributes: [{ name: "pa_taglia", option: eu }],
});

const feedRow = (eu: string) => ({
  feed: "goldensneakers",
  sku: FEED,
  euNorm: eu,
  sizeLabel: eu,
  quantity: 3,
  active: true,
  presentedPrice: 138,
  offerPrice: 90,
  productName: "Nike Off-White Blazer",
  brandName: "Nike",
});

const indexRow = (productId: number, sku: string, category: { id: number; slug: string; name: string }) => ({
  productId,
  sku,
  name: sku,
  type: "variable",
  status: "publish",
  categories: [category],
  tags: [],
  brands: [],
  attributes: [],
});

const NIKE_MARGIN: ScopedPricingRule = {
  id: "store-category-911",
  scope: { storeCategory: NIKE, storeTermName: "Nike" },
  enabled: true,
  markupPercent: 25,
};

const price = (productId: number, variationId: number) =>
  store.products.get(productId)!.find((v) => v.id === variationId)!.regular_price;

describe.skipIf(!enabled)("a margin on a store category (real SQL, stand-in store and KicksDB)", () => {
  let savedConfig: unknown[] = [];

  beforeAll(async () => {
    const { db, config } = await load();
    savedConfig = await db.select().from(config);
  });

  afterAll(async () => {
    const { db, config, storeIndex, catalogProducts, feedItems, inArray } = await load();
    await db.delete(config);
    if (savedConfig.length > 0) await db.insert(config).values(savedConfig as never);
    await db.delete(storeIndex).where(inArray(storeIndex.productId, [K_ID, F_ID]));
    await db.delete(catalogProducts).where(inArray(catalogProducts.sku, [KICKS, FEED]));
    await db.delete(feedItems).where(inArray(feedItems.sku, [FEED]));
  });

  beforeEach(async () => {
    const {
      db,
      config,
      feedItems,
      priceLedger,
      storeOverrides,
      storeIndex,
      catalogProducts,
      saveSnapshot,
      saveActiveConfig,
      buildDefaultConfig,
      inArray,
      forgetStoreTerms,
      upsertCatalog,
    } = await load();
    await db.delete(feedItems);
    await db.delete(priceLedger);
    await db.delete(storeOverrides);
    await db.delete(storeIndex).where(inArray(storeIndex.productId, [K_ID, F_ID]));
    await db.delete(catalogProducts).where(inArray(catalogProducts.sku, [KICKS, FEED]));

    // The house rules as shipped, plus the owner's "Ricarico 25%" on Nike.
    await db.delete(config);
    const cfg = buildDefaultConfig({
      kicksDbApiKey: "",
      woo: { baseUrl: process.env.WOO_BASE_URL ?? "", consumerKey: "", consumerSecret: "" },
      marketToCurrency: { IT: "EUR" },
    });
    cfg.pricingRules.push(NIKE_MARGIN);
    await saveActiveConfig(cfg);

    store.categories = [
      { id: SNEAKERS, name: "Sneakers", slug: "sneakers", parent: 0 },
      { id: NIKE, name: "Nike", slug: "nike", parent: SNEAKERS },
      { id: OFF_WHITE, name: "Nike Off-White", slug: "nike-off-white", parent: NIKE },
    ];
    // Both products at 135,99 / 150 — neither is the price the rule asks for.
    store.products.set(K_ID, [size(KICKS, 11, "42", "135.99", false), size(KICKS, 12, "43", "135.99", false)]);
    store.products.set(F_ID, [size(FEED, 21, "42", "150.00", true)]);
    await saveSnapshot(
      {
        products: [
          { id: K_ID, sku: KICKS, name: "Nike Off-White Dunk", variations: structuredClone(store.products.get(K_ID)) },
          { id: F_ID, sku: FEED, name: "Nike Off-White Blazer", variations: structuredClone(store.products.get(F_ID)) },
        ],
      } as never,
      "rest",
    );
    // Both filed under the SUB-category: the Nike rule reaches them through the tree.
    const offWhite = { id: OFF_WHITE, slug: "nike-off-white", name: "Nike Off-White" };
    await db.insert(storeIndex).values([indexRow(K_ID, KICKS, offWhite), indexRow(F_ID, FEED, offWhite)]);
    await db.insert(feedItems).values([feedRow("42")]);
    kicks.products.set(KICKS, kicksProduct);
    // KicksDB knew the feed's product first: the catalog row says "kicksdb",
    // the feed owns it all the same.
    await upsertCatalog("IT", [kicksProduct, { ...kicksProduct, stockxId: "sx-stm-2", sku: FEED }]);
    forgetStoreTerms();
    store.treeDown = false;
  });

  it("the sync writes the rule's price to the KicksDB product, the supplier's to the feed product", async () => {
    const { runPriceSync, skusUnderStoreTerm } = await load();

    // The term's SKUs, sub-category included, whoever prices them.
    const skus = await skusUnderStoreTerm({ storeCategory: NIKE });
    expect(skus.sort()).toEqual([FEED, KICKS].sort());

    const run = await runPriceSync({ skus, liveCheck: true });
    // 100 € ask: Nike's 25 % → 125 → the house charm rounding, 125,99 — not
    // the house 35 % band (135,99, what the store showed).
    expect(price(K_ID, 11)).toBe("125.99");
    expect(price(K_ID, 12)).toBe("125.99");
    // The feed's presented price passes through, untouched by the margin
    // (138 × 1,25 would be 172,50).
    expect(price(F_ID, 21)).toBe("138.00");
    expect(run.outcome?.updated).toBe(3);

    // A second run has nothing left to write.
    const again = await runPriceSync({ skus, liveCheck: true });
    expect(again.outcome).toBeNull();
  });

  it("without the rule the same sync writes the house price: the rule is what moved it", async () => {
    const { runPriceSync, getActiveConfig, saveActiveConfig } = await load();
    const cfg = await getActiveConfig();
    cfg.pricingRules = cfg.pricingRules.filter((r) => r.id !== NIKE_MARGIN.id);
    await saveActiveConfig(cfg);
    store.products.get(K_ID)!.forEach((v) => (v.regular_price = "120.00"));
    const { saveSnapshot } = await load();
    await saveSnapshot(
      {
        products: [
          { id: K_ID, sku: KICKS, name: "Nike Off-White Dunk", variations: structuredClone(store.products.get(K_ID)) },
          { id: F_ID, sku: FEED, name: "Nike Off-White Blazer", variations: structuredClone(store.products.get(F_ID)) },
        ],
      } as never,
      "rest",
    );
    await runPriceSync({ skus: [KICKS], liveCheck: true });
    expect(price(K_ID, 11)).toBe("135.99");
  });

  it("the drawer and the Margins tab's coverage agree with the sync", async () => {
    const { loadDrawerData, getActiveConfig, pricingRuleCoverage } = await load();
    const cfg = await getActiveConfig();

    const drawer = await loadDrawerData("IT", KICKS, cfg);
    expect(drawer?.variants.map((v) => v.proposed)).toEqual([125.99, 125.99]);
    expect(drawer?.appliedRule).toMatchObject({
      id: NIKE_MARGIN.id,
      scopeLabel: "Nike",
      storeTerm: { taxonomy: "category", id: NIKE, name: "Nike" },
    });
    // The feed product's sheet shows the supplier's price and rule.
    const feedDrawer = await loadDrawerData("IT", FEED, cfg);
    expect(feedDrawer?.owner).toBe("goldensneakers");
    expect(feedDrawer?.variants.map((v) => v.proposed)).toEqual([138]);
    expect(feedDrawer?.appliedRule?.id).toBe("goldensneakers-passthrough");

    // Coverage: the rule prices the KicksDB product only — the feed owns the
    // other one even though KicksDB registered its catalog row.
    const { coverage } = await pricingRuleCoverage();
    const byId = new Map(coverage.map((c) => [c.ruleId, c]));
    expect(byId.get(NIKE_MARGIN.id)?.products).toBe(1);
    expect(byId.get(NIKE_MARGIN.id)?.examples[0]).toEqual({ ask: 100, price: 125.99 });
    expect(byId.get("goldensneakers-passthrough")?.products).toBeGreaterThanOrEqual(1);

    // The price audit proposes what the sync writes, from the cached and the live product alike.
    const { auditPrices } = await load();
    const audit = await auditPrices({ sku: KICKS });
    expect(audit.ok).toBe(true);
    expect(audit.rows?.map((r) => [r.proposedFromStored, r.proposedFromLive])).toEqual([
      [125.99, 125.99],
      [125.99, 125.99],
    ]);
  });

  it("saving the rule list keeps the store term (a Margins tab save never widens it to the whole shop)", async () => {
    const { savePricingRules, getActiveConfig, pricingRulesVersion } = await load();
    const cfg = await getActiveConfig();
    const saved = await savePricingRules(cfg.pricingRules, pricingRulesVersion(cfg.pricingRules));
    expect(saved.ok).toBe(true);
    const kept = (await getActiveConfig()).pricingRules.find((r) => r.id === NIKE_MARGIN.id);
    expect(kept?.scope).toEqual({ storeCategory: NIKE, storeTermName: "Nike" });
  });

  it("no index row, no store-term price: a product the index does not hold keeps the house rules", async () => {
    const { db, storeIndex, eq, runPriceSync, forgetStoreTerms } = await load();
    await db.delete(storeIndex).where(eq(storeIndex.sku, KICKS));
    forgetStoreTerms();
    await runPriceSync({ skus: [KICKS], liveCheck: true });
    expect(price(K_ID, 11)).toBe("135.99"); // already the house price: nothing moved
  });

  it("a cold process that cannot read the category tree holds the price rather than write the general one", async () => {
    // The margin was applied before: the store shows the rule's 125,99.
    store.products.get(K_ID)!.forEach((v) => (v.regular_price = "125.99"));
    const { saveSnapshot } = await load();
    await saveSnapshot(
      {
        products: [
          { id: K_ID, sku: KICKS, name: "Nike Off-White Dunk", variations: structuredClone(store.products.get(K_ID)) },
          { id: F_ID, sku: FEED, name: "Nike Off-White Blazer", variations: structuredClone(store.products.get(F_ID)) },
        ],
      } as never,
      "rest",
    );
    // A process that never read the tree: no last good copy anywhere (the
    // store-terms cache and the taxonomy listings' are both per process).
    const globals = globalThis as { __storeHubStoreTermsV2?: unknown; __storeHubTaxonomyCache?: Map<string, unknown> };
    delete globals.__storeHubStoreTermsV2;
    globals.__storeHubTaxonomyCache?.clear();
    vi.resetModules();
    store.treeDown = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { runPriceSync, loadDrawerData, getActiveConfig, STORE_TERMS_HELD_NOTE } = await load();
      // Filed under "Nike › Off-White" only: without the tree, the Nike rule
      // cannot know it is its own. The general price (135,99) would undo the margin.
      const run = await runPriceSync({ skus: [KICKS, FEED], liveCheck: true });
      expect(price(K_ID, 11)).toBe("125.99");
      expect(price(K_ID, 12)).toBe("125.99");
      // The supplier's product is no store-term rule's: written as ever.
      expect(price(F_ID, 21)).toBe("138.00");
      expect(run.report.warning).toContain(STORE_TERMS_HELD_NOTE);

      // The drawer still shows a price, flagged.
      const drawer = await loadDrawerData("IT", KICKS, await getActiveConfig());
      expect(drawer?.storeTermsUnknown).toBe(true);

      // The store answers again: the next sync (after the short retry) sees the tree.
      store.treeDown = false;
      const { forgetStoreTerms } = await load();
      forgetStoreTerms();
      const again = await runPriceSync({ skus: [KICKS], liveCheck: true });
      expect(again.report.warning ?? "").not.toContain(STORE_TERMS_HELD_NOTE);
      expect(price(K_ID, 11)).toBe("125.99");
    } finally {
      warn.mockRestore();
    }
  });
});
