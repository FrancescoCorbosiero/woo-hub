import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedPricingRule } from "@core/config";
import type { SourceProduct } from "@core/core-spine";
import type { OperationInput, OperationView } from "@/lib/vetrina/catalog-ops";

/**
 * "Cambia il ricarico" end to end (phase 4), against real SQL, a stand-in
 * store and a stand-in KicksDB: the preview prices the term's products with
 * the engine, the action saves the term's rule in the Hub's config and the
 * ordinary sync writes the new prices — a size on sale and a locked size
 * keep theirs, the supplier's product is never touched — and "Annulla" puts
 * the rule from before back and reprices again. Opt-in, like every
 * *.db.test.ts: a THROWAWAY Postgres with the migrations applied. It empties
 * vetrina_operations, store_overrides, price_ledger and the snapshot, puts
 * back the config it found, and removes its own index, catalog and feed rows.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://…@localhost:…/… REDIS_URL=… npx vitest run --no-file-parallelism <this file>
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

interface FakeVariation {
  id: number;
  sku: string;
  regular_price: string;
  sale_price: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  attributes: { name: string; option: string }[];
}

const KICKS = "MRG-KICKS-1"; // priced by KicksDB, filed under the sub-category
const FEED = "MRG-FEED-1"; // priced by the GoldenSneakers feed
const STORE = "MRG-STORE-1"; // store-only: priced by hand in the shop
// The store's categories: 920 Sneakers › 921 Nike › 922 Nike Off-White.
const SNEAKERS = 920;
const NIKE = 921;
const OFF_WHITE = 922;
const K_ID = 9201;
const F_ID = 9202;
const S_ID = 9203;

const store = vi.hoisted(() => ({
  products: new Map<number, FakeVariation[]>(),
  categories: [] as {
    id: number;
    name: string;
    slug: string;
    parent: number;
  }[],
  client: null as unknown,
}));
const kicks = vi.hoisted(() => ({ products: new Map<string, SourceProduct>(), down: false }));
const checks = vi.hoisted(() => ({ requested: 0 }));

vi.hoisted(() => {
  const client = {
    getAllVariations: async (productId: number) => structuredClone(store.products.get(productId) ?? []),
    batchVariations: async (productId: number, payload: { update?: Record<string, unknown>[] }) => {
      const sizes = store.products.get(productId) ?? [];
      const update = (payload.update ?? []).map((row) => {
        const v = sizes.find((s) => s.id === row.id);
        if (!v)
          return {
            id: row.id as number,
            error: { code: "invalid", message: "Invalid ID." },
          };
        if (row.regular_price != null) v.regular_price = String(row.regular_price);
        return { id: row.id as number };
      });
      return { create: [], update, delete: [] };
    },
    updateProduct: async () => undefined,
    listCategories: async () => structuredClone(store.categories),
    listBrands: async () => [],
  };
  store.client = client;
});

vi.mock("@/server/woo/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/woo/client")>();
  return {
    ...real,
    wooConfigured: () => true,
    getWooClient: () => store.client,
  };
});

vi.mock("@/server/collections/store", () => ({
  storeReady: () => true,
  demoMode: () => false,
  storeClient: async () => store.client,
}));

vi.mock("@/server/collections/runner", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/collections/runner")>();
  // The index and the automatic categories catching up are their own business: here, only that it is asked.
  return { ...real, requestCheck: () => void (checks.requested += 1) };
});

vi.mock("@/server/adapters/kicksdb", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/adapters/kicksdb")>();
  const source = {
    getPricesBatch: async (skus: string[]) => {
      if (kicks.down) throw new Error("KicksDB down");
      return skus
        .map((s) => kicks.products.get(s.toUpperCase()))
        .filter((p): p is SourceProduct => p != null)
        .map((p) => structuredClone(p));
    },
    getProduct: async () => [],
    findBySku: async (sku: string) => structuredClone(kicks.products.get(sku.toUpperCase()) ?? null),
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
  ...(await import("@/server/overrides/repo")),
  ...(await import("@/server/overrides/model")),
  ...(await import("@/server/pricing/store-terms")),
  ...(await import("./service")),
  ...(await import("./runner")),
});

/** A KicksDB product: three sizes at a 100 € ask. */
const kicksProduct: SourceProduct = {
  stockxId: "sx-mrg-1",
  sku: KICKS,
  title: "Nike Off-White Dunk",
  brand: "Nike",
  image: "",
  market: "IT",
  currency: "EUR",
  variants: ["42", "43", "44"].map((eu) => ({
    stockxVariantId: `mrg-${eu}`,
    sizeLabel: eu,
    sizeType: "eu",
    sizes: [{ system: "eu", size: eu }],
    offers: [{ deliveryType: "standard" as const, lowestAsk: 100, asks: 5 }],
  })),
};

const size = (sku: string, id: number, eu: string, price: string, sale = ""): FakeVariation => ({
  id,
  sku: `${sku}-EU${eu}`,
  regular_price: price,
  sale_price: sale,
  manage_stock: false,
  stock_quantity: null,
  attributes: [{ name: "pa_taglia", option: eu }],
});

const indexRow = (productId: number, sku: string, category: { id: number; slug: string; name: string }) => ({
  productId,
  sku,
  name: `Prodotto ${sku}`,
  type: "variable",
  status: "publish",
  categories: [category],
  tags: [],
  brands: [],
  attributes: [],
});

const price = (productId: number, variationId: number) => store.products.get(productId)!.find((v) => v.id === variationId)!.regular_price;

const nikeMargin = (percent: number | null): OperationInput => ({
  kind: "margin",
  taxonomy: "category",
  termId: NIKE,
  percent,
});

async function run(input: OperationInput): Promise<OperationView> {
  const { startOperation, idle, loadOperation } = await load();
  const started = await startOperation(input);
  await idle();
  return loadOperation(started.id);
}

async function undo(id: string): Promise<OperationView> {
  const { undoOperation, idle, loadOperation } = await load();
  await undoOperation(id);
  await idle();
  return loadOperation(id);
}

async function termRules(): Promise<ScopedPricingRule[]> {
  const { getActiveConfig } = await load();
  return (await getActiveConfig()).pricingRules.filter((r) => r.scope.storeCategory != null);
}

describe.skipIf(!enabled)("a category's margin from the Vetrina (real SQL, stand-in store and KicksDB)", () => {
  let savedConfig: unknown[] = [];

  beforeAll(async () => {
    const { db, config } = await load();
    savedConfig = await db.select().from(config);
  });

  afterAll(async () => {
    const { db, config, storeIndex, catalogProducts, feedItems, inArray } = await load();
    await db.delete(config);
    if (savedConfig.length > 0) await db.insert(config).values(savedConfig as never);
    await db.delete(storeIndex).where(inArray(storeIndex.productId, [K_ID, F_ID, S_ID]));
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
      vetrinaOperations,
      saveSnapshot,
      saveActiveConfig,
      buildDefaultConfig,
      saveOverrides,
      emptyOverrides,
      withVariationPrice,
      inArray,
      forgetStoreTerms,
      upsertCatalog,
    } = await load();
    await db.delete(vetrinaOperations);
    await db.delete(feedItems).where(inArray(feedItems.sku, [FEED]));
    await db.delete(priceLedger);
    await db.delete(storeOverrides);
    await db.delete(storeIndex).where(inArray(storeIndex.productId, [K_ID, F_ID, S_ID]));
    await db.delete(catalogProducts).where(inArray(catalogProducts.sku, [KICKS, FEED]));
    checks.requested = 0;
    kicks.down = false;

    // The house rules as shipped: the 35 % band, charm rounding, the GoldenSneakers passthrough.
    await db.delete(config);
    await saveActiveConfig(
      buildDefaultConfig({
        kicksDbApiKey: "",
        woo: {
          baseUrl: process.env.WOO_BASE_URL ?? "",
          consumerKey: "",
          consumerSecret: "",
        },
        marketToCurrency: { IT: "EUR" },
      }),
    );

    store.categories = [
      { id: SNEAKERS, name: "Sneakers", slug: "sneakers", parent: 0 },
      { id: NIKE, name: "Nike", slug: "nike", parent: SNEAKERS },
      {
        id: OFF_WHITE,
        name: "Nike Off-White",
        slug: "nike-off-white",
        parent: NIKE,
      },
    ];
    // 100 € ask at the house 35 %: 135,99. Size 43 is on sale; size 44's price is the owner's lock.
    store.products.set(K_ID, [size(KICKS, 11, "42", "135.99"), size(KICKS, 12, "43", "135.99", "99.00"), size(KICKS, 13, "44", "199.00")]);
    store.products.set(F_ID, [size(FEED, 21, "42", "150.00")]);
    store.products.set(S_ID, [size(STORE, 31, "42", "89.00")]);
    await saveSnapshot(
      {
        products: [
          {
            id: K_ID,
            sku: KICKS,
            name: "Nike Off-White Dunk",
            variations: structuredClone(store.products.get(K_ID)),
          },
          {
            id: F_ID,
            sku: FEED,
            name: "Nike Blazer",
            variations: structuredClone(store.products.get(F_ID)),
          },
          {
            id: S_ID,
            sku: STORE,
            name: "Nike vintage",
            variations: structuredClone(store.products.get(S_ID)),
          },
        ],
      } as never,
      "rest",
    );
    await saveOverrides(withVariationPrice(emptyOverrides(), KICKS, "44", 199));
    const nike = { id: NIKE, slug: "nike", name: "Nike" };
    await db.insert(storeIndex).values([
      // In the sub-category: Nike's margin reaches it through the tree.
      indexRow(K_ID, KICKS, {
        id: OFF_WHITE,
        slug: "nike-off-white",
        name: "Nike Off-White",
      }),
      indexRow(F_ID, FEED, nike),
      indexRow(S_ID, STORE, nike),
    ]);
    await db.insert(feedItems).values({
      feed: "goldensneakers",
      sku: FEED,
      euNorm: "42",
      sizeLabel: "42",
      quantity: 3,
      active: true,
      presentedPrice: 138,
      offerPrice: 90,
      productName: "Nike Blazer",
      brandName: "Nike",
    });
    kicks.products.set(KICKS, kicksProduct);
    // KicksDB knew the feed's product first: its catalog row says "kicksdb", the feed owns it all the same.
    await upsertCatalog("IT", [kicksProduct, { ...kicksProduct, stockxId: "sx-mrg-2", sku: FEED }]);
    forgetStoreTerms();
  });

  it("the row: the standard margin, and who prices the term's products", async () => {
    const { loadTermMargin } = await load();
    expect(await loadTermMargin("category", NIKE)).toEqual({
      own: null,
      inherited: null,
      standard: { kind: "bands" },
      priced: 1,
      applies: 1,
      supplier: 1,
      storeOnly: 1,
    });
  });

  it("the preview prices the term's products with the engine: 135,99 → 125,99, the rest left and said", async () => {
    const { previewOperation } = await load();
    const preview = await previewOperation(nikeMargin(25));
    expect(preview.margin).toMatchObject({
      percent: 25,
      applies: 1,
      up: 0,
      down: 1,
      same: 0,
      averageChange: -7.4,
      lockedSizes: 1,
      saleSizes: 1,
    });
    expect(preview.changes).toBe(1);
    expect(preview.sample).toHaveLength(1);
    expect(preview.sample[0]).toMatchObject({
      id: K_ID,
      name: `Prodotto ${KICKS}`,
    });
    expect(preview.sample[0].before.replace(/\s/g, " ")).toBe("135,99 €");
    expect(preview.sample[0].after.replace(/\s/g, " ")).toBe("125,99 €");
    expect(preview.untouched).toEqual(
      expect.arrayContaining([
        { reason: "prezzo del fornitore (GoldenSneakers)", count: 1 },
        { reason: "prezzo deciso nel negozio, non dall'Hub", count: 1 },
      ]),
    );
    expect(preview.untouched).toHaveLength(2);
    // Size 44 is locked, size 43 on sale: only 42 moves, and the owner is told why.
    expect(preview.warnings).toEqual([
      "1 taglia ha il prezzo bloccato: lo tiene.",
      "1 taglia è in saldo: il suo prezzo pieno cambia quando finisce il saldo.",
    ]);
  });

  it("applies: the rule saved, the KicksDB product repriced through the sync — sale and lock kept, the supplier untouched — and undone", async () => {
    const view = await run(nikeMargin(25));
    expect(view.status).toBe("done");
    expect(view.label).toBe("Ricarico 25% · Nike");
    expect(view.termKey).toBe(`category:${NIKE}`);
    expect(view.changed).toBe(1);
    expect(view.undoable).toBe(true);
    expect(view.progress).toEqual({ done: 2, total: 2 });

    // The term's own rule, appended after the house rules: it states the margin, and nothing else.
    const { getActiveConfig } = await load();
    const rules = (await getActiveConfig()).pricingRules;
    expect(rules.at(-1)).toEqual({
      id: `store-category-${NIKE}`,
      scope: { storeCategory: NIKE, storeTermName: "Nike" },
      enabled: true,
      markupPercent: 25,
    });
    expect(price(K_ID, 11)).toBe("125.99");
    expect(price(K_ID, 12)).toBe("135.99"); // on sale: the regular price is left alone
    expect(price(K_ID, 13)).toBe("199.00"); // locked
    expect(price(F_ID, 21)).toBe("150.00"); // the supplier's product is never repriced by a margin
    expect(price(S_ID, 31)).toBe("89.00");
    expect(checks.requested).toBeGreaterThan(0);

    const { loadTermMargin } = await load();
    expect(await loadTermMargin("category", NIKE)).toMatchObject({
      own: { kind: "percent", percent: 25 },
      applies: 1,
    });
    // The sub-category's row: Nike's margin, from above.
    expect(await loadTermMargin("category", OFF_WHITE)).toMatchObject({
      own: null,
      inherited: { term: "Nike", value: { kind: "percent", percent: 25 } },
      priced: 1,
      applies: 1,
    });

    const undone = await undo(view.id);
    expect(undone.status).toBe("undone");
    expect(undone.undo).toEqual({ restored: 1, kept: 0, failed: 0 });
    expect(await termRules()).toEqual([]);
    expect(price(K_ID, 11)).toBe("135.99");
    expect(price(K_ID, 13)).toBe("199.00");
  });

  it("changes a margin where it stands, and an undo over a newer margin is refused", async () => {
    const first = await run(nikeMargin(25));
    const second = await run(nikeMargin(30));
    expect(second.status).toBe("done");
    expect(await termRules()).toEqual([
      {
        id: `store-category-${NIKE}`,
        scope: { storeCategory: NIKE, storeTermName: "Nike" },
        enabled: true,
        markupPercent: 30,
      },
    ]);
    expect(price(K_ID, 11)).toBe("130.99");

    // The first one's rule is no longer what it left: the newer word stands.
    const { undoOperation } = await load();
    await expect(undoOperation(first.id)).rejects.toThrow("Il ricarico di «Nike» è cambiato dopo");

    // The second one's undo brings the 25 % back.
    const undone = await undo(second.id);
    expect(undone.status).toBe("undone");
    expect((await termRules())[0]?.markupPercent).toBe(25);
    expect(price(K_ID, 11)).toBe("125.99");
  });

  it("goes back to the standard, and its undo puts the margin back where it was", async () => {
    await run(nikeMargin(25));
    const { getActiveConfig } = await load();
    const at = (await getActiveConfig()).pricingRules.findIndex((r) => r.scope.storeCategory === NIKE);

    const back = await run(nikeMargin(null));
    expect(back.status).toBe("done");
    expect(back.label).toBe("Ricarico standard · Nike");
    expect(await termRules()).toEqual([]);
    expect(price(K_ID, 11)).toBe("135.99");

    await undo(back.id);
    const rules = (await getActiveConfig()).pricingRules;
    expect(rules.findIndex((r) => r.scope.storeCategory === NIKE)).toBe(at);
    expect(price(K_ID, 11)).toBe("125.99");
  });

  it("a reprice that cannot finish: the rule stands, the action says so, and it can still be undone", async () => {
    const { db, feedItems, eq } = await load();
    // KicksDB alone prices this shop now, and does not answer: the sync cannot plan.
    await db.delete(feedItems).where(eq(feedItems.sku, FEED));
    kicks.down = true;
    const view = await run(nikeMargin(25));
    expect(view.status).toBe("failed");
    // Whichever way the sync meets the outage — it stops, or it rides it out with the products unanswered.
    expect(view.error).toMatch(/^Ricarico salvato, ma /);
    expect(view.changed).toBe(1);
    expect(view.undoable).toBe(true);
    expect((await termRules())[0]?.markupPercent).toBe(25);
    expect(price(K_ID, 11)).toBe("135.99");

    kicks.down = false;
    const undone = await undo(view.id);
    expect(undone.status).toBe("undone");
    expect(await termRules()).toEqual([]);
    expect(price(K_ID, 11)).toBe("135.99");
  });

  it("refuses what would change nothing: the margin it has, the standard it follows", async () => {
    const { startOperation, previewOperation } = await load();
    await expect(startOperation(nikeMargin(null))).rejects.toThrow("«Nike» segue già il ricarico standard.");
    await run(nikeMargin(25));
    await expect(startOperation(nikeMargin(25))).rejects.toThrow("«Nike» ha già il ricarico al 25%.");
    const preview = await previewOperation(nikeMargin(25));
    expect(preview.margin).toBeUndefined();
    expect(preview.warnings[0]).toBe("«Nike» ha già il ricarico al 25%.");
  });

  it("a deeper category's margin outranks Nike's for its products", async () => {
    await run({
      kind: "margin",
      taxonomy: "category",
      termId: OFF_WHITE,
      percent: 40,
    });
    expect(price(K_ID, 11)).toBe("140.99");
    const { loadTermMargin, previewOperation } = await load();
    expect(await loadTermMargin("category", NIKE)).toMatchObject({
      own: null,
      priced: 1,
      applies: 0,
    });
    const preview = await previewOperation(nikeMargin(25));
    expect(preview.margin).toMatchObject({ applies: 0 });
    expect(preview.untouched.find((u) => u.reason === "ha un ricarico più specifico")?.count).toBe(1);
    await run(nikeMargin(25));
    expect(price(K_ID, 11)).toBe("140.99");
  });
});
