import { describe, expect, it, vi } from "vitest";
import type { ScopedPricingRule } from "@core/config";
import type { PlanItem } from "@core/core-spine";
import type { IndexedStoreTerms, StoreTermCarrier, StoreTermParents, StoreTermsSource } from "./store-terms";

// The module's own shop instance reads the database and the store: never
// reached here, every test builds its cache over a stand-in source.
vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/collections/store", () => ({
  storeReady: () => false,
  storeClient: async () => ({}),
  demoMode: () => false,
}));

const { expandStoreTerms, needsStoreTerms, storeTermsCache, holdPlanPrices, STORE_TERMS_HELD } = await import(
  "./store-terms"
);

/** Categories: 10 Sneakers › 11 Nike › 12 Nike Off-White; 20 Saldi. Brands: 30 Nike › 31 Nike SB. */
const PARENTS: StoreTermParents = {
  category: new Map([
    [10, 0],
    [11, 10],
    [12, 11],
    [20, 0],
  ]),
  brand: new Map([
    [30, 0],
    [31, 30],
  ]),
};

const RULES: ScopedPricingRule[] = [
  { id: "general", scope: {}, enabled: true, markupPercent: 30 },
  { id: "cat-nike", scope: { storeCategory: 11 }, enabled: true, markupPercent: 25 },
];

function fakeSource(index: IndexedStoreTerms[], parents: StoreTermParents = PARENTS) {
  const calls = { index: 0, parents: 0 };
  const failures = { index: false, parents: false, category: false, brand: false };
  const source: StoreTermsSource = {
    async readIndex() {
      calls.index += 1;
      if (failures.index) throw new Error("index down");
      return structuredClone(index);
    },
    async readTree(taxonomy) {
      calls.parents += 1;
      if (failures.parents || failures[taxonomy]) throw new Error(`${taxonomy} tree down`);
      return parents[taxonomy];
    },
  };
  return { source, calls, failures, index };
}

describe("expandStoreTerms", () => {
  it("adds every ancestor, each with its depth from the top", () => {
    expect(expandStoreTerms([12], PARENTS.category)).toEqual([
      { id: 10, depth: 0 },
      { id: 11, depth: 1 },
      { id: 12, depth: 2 },
    ]);
  });

  it("merges several terms and their shared ancestors once", () => {
    expect(expandStoreTerms([12, 11, 20], PARENTS.category)).toEqual([
      { id: 10, depth: 0 },
      { id: 20, depth: 0 },
      { id: 11, depth: 1 },
      { id: 12, depth: 2 },
    ]);
  });

  it("reads a term the tree does not know as top level, and survives a cycle", () => {
    expect(expandStoreTerms([99], PARENTS.category)).toEqual([{ id: 99, depth: 0 }]);
    const cyclic = new Map([
      [1, 2],
      [2, 1],
    ]);
    const out = expandStoreTerms([1], cyclic);
    expect(out.map((t) => t.id).sort()).toEqual([1, 2]);
  });

  it("ignores ids that are not terms", () => {
    expect(expandStoreTerms([0, -3], PARENTS.category)).toEqual([]);
  });
});

describe("needsStoreTerms", () => {
  it("only when an ENABLED rule is scoped to a store term", () => {
    expect(needsStoreTerms(RULES)).toBe(true);
    expect(needsStoreTerms([RULES[0]])).toBe(false);
    expect(needsStoreTerms([RULES[0], { ...RULES[1], enabled: false }])).toBe(false);
    expect(needsStoreTerms([{ id: "b", scope: { storeBrand: 30 }, enabled: true }])).toBe(true);
  });
});

describe("withStoreTerms", () => {
  const product = (sku: string): StoreTermCarrier & { title: string } => ({ sku, title: sku });

  it("gives each indexed product its store terms with ancestors, by SKU in any spelling", async () => {
    const { source } = fakeSource([{ sku: "dd1391-100 ", categories: [12], brands: [31] }]);
    const cache = storeTermsCache(source);
    const original = product("DD1391-100");
    const [out] = await cache.withStoreTerms([original], RULES);
    expect(out.storeCategories?.map((t) => t.id)).toEqual([10, 11, 12]);
    expect(out.storeBrands).toEqual([
      { id: 30, depth: 0 },
      { id: 31, depth: 1 },
    ]);
    expect(original).not.toHaveProperty("storeCategories"); // a copy: the caller's object is left alone
  });

  it("leaves a product the index does not hold unchanged — no terms, no store-term match", async () => {
    const { source } = fakeSource([{ sku: "OTHER", categories: [12], brands: [] }]);
    const [out] = await storeTermsCache(source).withStoreTerms([product("NEW-1")], RULES);
    expect(out).toEqual(product("NEW-1"));
  });

  it("joins the terms of two store products sharing a SKU", async () => {
    const { source } = fakeSource([
      { sku: "DUP", categories: [12], brands: [] },
      { sku: "dup", categories: [20], brands: [30] },
    ]);
    const [out] = await storeTermsCache(source).withStoreTerms([product("DUP")], RULES);
    expect(out.storeCategories?.map((t) => t.id)).toEqual([10, 20, 11, 12]);
    expect(out.storeBrands?.map((t) => t.id)).toEqual([30]);
  });

  it("reads nothing at all while no rule is scoped to a store term", async () => {
    const { source, calls } = fakeSource([{ sku: "A", categories: [12], brands: [] }]);
    const [out] = await storeTermsCache(source).withStoreTerms([product("A")], [RULES[0]]);
    expect(out).toEqual(product("A"));
    expect(calls).toEqual({ index: 0, parents: 0 });
  });

  it("skips the store's trees when no indexed product has a term", async () => {
    const { source, calls } = fakeSource([{ sku: "A", categories: [], brands: [] }]);
    const [out] = await storeTermsCache(source).withStoreTerms([product("A")], RULES);
    expect(out.storeCategories).toEqual([]);
    expect(calls.parents).toBe(0);
  });

  it("reads once per TTL, shares one read between concurrent callers, and forget() reads again", async () => {
    let now = 0;
    const { source, calls } = fakeSource([{ sku: "A", categories: [12], brands: [] }]);
    const cache = storeTermsCache(source, { ttlMs: 1000, now: () => now });
    await Promise.all([cache.withStoreTerms([product("A")], RULES), cache.withStoreTerms([product("A")], RULES)]);
    expect(calls.index).toBe(1);
    now = 999;
    await cache.withStoreTerms([product("A")], RULES);
    expect(calls.index).toBe(1);
    now = 1000;
    await cache.withStoreTerms([product("A")], RULES);
    expect(calls.index).toBe(2);
    cache.forget();
    await cache.withStoreTerms([product("A")], RULES);
    expect(calls.index).toBe(3);
  });

  it("never fails the pricing: an unreadable index leaves the products as they are", async () => {
    const { source, failures } = fakeSource([{ sku: "A", categories: [12], brands: [] }]);
    failures.index = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [out] = await storeTermsCache(source).withStoreTerms([product("A")], RULES);
    expect(out).toEqual(product("A"));
    warn.mockRestore();
  });

  it("an index that fails later keeps the last good read", async () => {
    let now = 0;
    const { source, failures, calls } = fakeSource([{ sku: "A", categories: [12], brands: [] }]);
    const cache = storeTermsCache(source, { ttlMs: 10, now: () => now });
    await cache.withStoreTerms([product("A")], RULES);
    failures.index = true;
    now = 100;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [out] = await cache.withStoreTerms([product("A")], RULES);
    expect(calls.index).toBe(2);
    expect(out.storeCategories?.map((t) => t.id)).toEqual([10, 11, 12]);
    warn.mockRestore();
  });

  it("unreadable trees: the last ones read, else each product's own terms", async () => {
    const { source, failures } = fakeSource([{ sku: "A", categories: [12], brands: [] }]);
    failures.parents = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fresh = storeTermsCache(source);
    const [own] = await fresh.withStoreTerms([product("A")], RULES);
    expect(own.storeCategories).toEqual([{ id: 12, depth: 0 }]);

    let now = 0;
    const { source: later, failures: laterFailures } = fakeSource([{ sku: "A", categories: [12], brands: [] }]);
    const cache = storeTermsCache(later, { ttlMs: 10, now: () => now });
    await cache.withStoreTerms([product("A")], RULES);
    laterFailures.parents = true;
    now = 100;
    const [kept] = await cache.withStoreTerms([product("A")], RULES);
    expect(kept.storeCategories?.map((t) => t.id)).toEqual([10, 11, 12]);
    warn.mockRestore();
  });

  it("a read started before forget() does not become the cached one", async () => {
    let release: (rows: IndexedStoreTerms[]) => void = () => {};
    let reads = 0;
    const source: StoreTermsSource = {
      readIndex: () => {
        reads += 1;
        return reads === 1
          ? new Promise<IndexedStoreTerms[]>((r) => (release = r))
          : Promise.resolve([{ sku: "A", categories: [20], brands: [] }]);
      },
      readTree: async (taxonomy) => PARENTS[taxonomy],
    };
    const cache = storeTermsCache(source);
    const stale = cache.withStoreTerms([product("A")], RULES);
    cache.forget();
    const fresh = await cache.withStoreTerms([product("A")], RULES);
    release([{ sku: "A", categories: [12], brands: [] }]);
    await stale;
    expect(fresh[0].storeCategories?.map((t) => t.id)).toEqual([20]);
    const again = await cache.withStoreTerms([product("A")], RULES);
    expect(again[0].storeCategories?.map((t) => t.id)).toEqual([20]);
    expect(reads).toBe(2);
  });
});

describe("skusUnder", () => {
  it("every SKU in the term or below it, in either taxonomy", async () => {
    const { source } = fakeSource([
      { sku: "OW-1", categories: [12], brands: [31] },
      { sku: "NK-1", categories: [11], brands: [30] },
      { sku: "SALE-1", categories: [20], brands: [] },
    ]);
    const cache = storeTermsCache(source);
    expect((await cache.skusUnder({ storeCategory: 11 })).sort()).toEqual(["NK-1", "OW-1"]);
    expect(await cache.skusUnder({ storeCategory: 12 })).toEqual(["OW-1"]);
    expect((await cache.skusUnder({ storeBrand: 30 })).sort()).toEqual(["NK-1", "OW-1"]);
    expect(await cache.skusUnder({ storeBrand: 31 })).toEqual(["OW-1"]);
    expect(await cache.skusUnder({})).toEqual([]);
  });
});

describe("store terms that cannot be read (never a price computed without them)", () => {
  const product = (sku: string, source?: string): StoreTermCarrier => ({ sku, ...(source ? { source } : {}) });
  const BRAND_RULES: ScopedPricingRule[] = [...RULES, { id: "brand-nike", scope: { storeBrand: 30 }, enabled: true, markupPercent: 20 }];
  const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => {});

  it("a cold process whose category tree is unreadable: the products filed in a category are uncertain", async () => {
    const warn = quiet();
    const { source, failures } = fakeSource([
      { sku: "OW-1", categories: [12], brands: [] },
      { sku: "PLAIN", categories: [], brands: [30] },
    ]);
    failures.category = true;
    const read = await storeTermsCache(source).withStoreTermsChecked(
      [product("OW-1"), product("PLAIN"), product("NEW-1")],
      RULES,
    );
    // Own terms only (no ancestors): a "Nike" rule could not find it — so it is held, not mispriced.
    expect(read.products[0].storeCategories).toEqual([{ id: 12, depth: 0 }]);
    expect([...read.uncertain]).toEqual(["OW-1"]);
    warn.mockRestore();
  });

  it("only what a rule needs: an unreadable brand tree leaves the category rules' products certain", async () => {
    const warn = quiet();
    const { source, failures, calls } = fakeSource([{ sku: "OW-1", categories: [12], brands: [31] }]);
    failures.brand = true;
    const cache = storeTermsCache(source);
    const byCategory = await cache.withStoreTermsChecked([product("OW-1")], RULES);
    // The category tree still read: its ancestors are there.
    expect(byCategory.products[0].storeCategories?.map((t) => t.id)).toEqual([10, 11, 12]);
    expect(byCategory.uncertain.size).toBe(0);
    const byBrand = await cache.withStoreTermsChecked([product("OW-1")], BRAND_RULES);
    expect([...byBrand.uncertain]).toEqual(["OW-1"]);
    expect(calls.parents).toBe(2); // both trees asked, apart
    warn.mockRestore();
  });

  it("never a supplier-priced or store-only product: a store-term rule never prices those", async () => {
    const warn = quiet();
    const { source, failures } = fakeSource([{ sku: "GS-1", categories: [12], brands: [] }]);
    failures.category = true;
    const read = await storeTermsCache(source).withStoreTermsChecked([product("GS-1", "goldensneakers")], RULES);
    expect(read.uncertain.size).toBe(0);
    warn.mockRestore();
  });

  it("no index read ever: every market-priced product is uncertain", async () => {
    const warn = quiet();
    const { source, failures } = fakeSource([{ sku: "A", categories: [12], brands: [] }]);
    failures.index = true;
    const read = await storeTermsCache(source).withStoreTermsChecked(
      [product("A"), product("NEW-1"), product("GS-1", "goldensneakers")],
      RULES,
    );
    expect([...read.uncertain].sort()).toEqual(["A", "NEW-1"]);
    warn.mockRestore();
  });

  it("the last good trees serve for the process lifetime: forget() and a failing store keep them", async () => {
    const warn = quiet();
    let now = 0;
    const { source, failures } = fakeSource([{ sku: "OW-1", categories: [12], brands: [31] }]);
    const cache = storeTermsCache(source, { ttlMs: 10, now: () => now });
    await cache.withStoreTermsChecked([product("OW-1")], BRAND_RULES);
    failures.parents = true;
    failures.index = true;
    cache.forget();
    now = 1_000_000;
    const read = await cache.withStoreTermsChecked([product("OW-1")], BRAND_RULES);
    expect(read.products[0].storeCategories?.map((t) => t.id)).toEqual([10, 11, 12]);
    expect(read.products[0].storeBrands?.map((t) => t.id)).toEqual([30, 31]);
    expect(read.uncertain.size).toBe(0);
    warn.mockRestore();
  });

  it("a read that fell back is asked again within seconds, not after the whole TTL", async () => {
    const warn = quiet();
    let now = 0;
    const { source, failures, calls } = fakeSource([{ sku: "OW-1", categories: [12], brands: [] }]);
    failures.category = true;
    const cache = storeTermsCache(source, { ttlMs: 60_000, retryMs: 5_000, now: () => now });
    expect((await cache.withStoreTermsChecked([product("OW-1")], RULES)).uncertain.size).toBe(1);
    failures.category = false;
    now = 4_999;
    expect((await cache.withStoreTermsChecked([product("OW-1")], RULES)).uncertain.size).toBe(1);
    now = 5_000;
    const healed = await cache.withStoreTermsChecked([product("OW-1")], RULES);
    expect(healed.uncertain.size).toBe(0);
    expect(healed.products[0].storeCategories?.map((t) => t.id)).toEqual([10, 11, 12]);
    expect(calls.parents).toBe(2);
    warn.mockRestore();
  });

  it("blind (the Vetrina's demo shop): the pricing knows no terms, the term listing still does", async () => {
    const { source } = fakeSource([{ sku: "OW-1", categories: [12], brands: [] }]);
    const cache = storeTermsCache(source, { blind: () => true });
    const read = await cache.withStoreTermsChecked([product("OW-1")], RULES);
    expect(read.products[0]).toEqual(product("OW-1"));
    expect([...read.uncertain]).toEqual(["OW-1"]);
    expect(await cache.known(RULES)).toBe(false);
    expect(await cache.skusUnder({ storeCategory: 11 })).toEqual(["OW-1"]);
  });

  it("known(): whether the terms the rules need can be read now", async () => {
    const warn = quiet();
    const { source, failures } = fakeSource([{ sku: "OW-1", categories: [12], brands: [31] }]);
    failures.brand = true;
    const cache = storeTermsCache(source);
    expect(await cache.known(RULES)).toBe(true);
    expect(await cache.known(BRAND_RULES)).toBe(false);
    warn.mockRestore();
  });
});

describe("holdPlanPrices", () => {
  const item = (over: Partial<PlanItem>): PlanItem => ({
    stockxVariantId: "v",
    sizeLabel: "42",
    storeProductId: 1,
    storeVariationId: 2,
    currentPrice: 100,
    proposedPrice: 120,
    action: "update",
    ...over,
  });

  it("no price written: updates and new sizes skipped with the reason, the feed's stock kept, a lock left alone", () => {
    const items = [
      item({}),
      item({ action: "create", storeVariationId: null }),
      item({ stockQuantity: 0 }),
      item({ locked: true, proposedPrice: 99 }),
      item({ action: "noop", proposedPrice: 100 }),
      item({ proposedPrice: null, stockQuantity: 3 }),
    ];
    expect(holdPlanPrices(items)).toBe(3);
    expect(items[0]).toMatchObject({ action: "skip", reason: STORE_TERMS_HELD });
    expect(items[1]).toMatchObject({ action: "skip", reason: STORE_TERMS_HELD });
    // Stock only: the shop's stock is never held up by a margin.
    expect(items[2]).toMatchObject({ action: "update", proposedPrice: null, stockQuantity: 0 });
    expect(items[3]).toMatchObject({ action: "update", proposedPrice: 99 });
    expect(items[4].action).toBe("noop");
    expect(items[5]).toMatchObject({ action: "update", proposedPrice: null });
  });
});
