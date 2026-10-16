import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexRow } from "@/server/collections/index-rows";
import type { Homepage, ProductCard } from "@/lib/vetrina/types";

/**
 * Real-SQL tests of the Vetrina catalog's reads, over a stand-in store (its
 * term lists), homepage and automatic categories. Opt-in: they need a
 * THROWAWAY Postgres with the migrations applied, and they empty store_index.
 * Run with
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://…@localhost:…/… REDIS_URL=… npm test
 *
 * Imports are dynamic because the db client validates the environment on load.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

type Term = { id: number; name: string; slug: string; parent?: number };

const mocks = vi.hoisted(() => ({
  categories: [] as Term[],
  brands: [] as Term[],
  collections: {} as Record<number, unknown>,
  collectionsFail: false,
  homepage: vi.fn(),
  freshen: vi.fn(),
  overrides: null as unknown,
  runner: { running: null as string | null, queued: [] as string[] },
}));

vi.mock("@/server/collections/store", () => ({
  storeReady: () => true,
  demoMode: () => false,
  storeClient: async () => ({
    listCategories: async () => mocks.categories,
    listBrands: async () => mocks.brands,
  }),
}));
vi.mock("@/server/collections/service", () => ({
  freshen: mocks.freshen,
  collectionsByTerm: async () => {
    if (mocks.collectionsFail) throw new Error("relation \"smart_collections\" does not exist");
    return mocks.collections;
  },
}));
vi.mock("@/server/collections/runner", () => ({ getRunnerStatus: () => mocks.runner }));
vi.mock("./source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./source")>()),
  getVetrinaSource: async () => ({ kind: "wordpress", homepage: mocks.homepage }),
}));
vi.mock("@/server/overrides/repo", () => ({ getOverrides: async () => mocks.overrides }));

const load = async () => ({
  ...(await import("@/server/db/client")),
  ...(await import("@/server/db/schema")),
  ...(await import("@/server/collections/repo")),
  ...(await import("./catalog")),
});

const CATEGORIES: Term[] = [
  { id: 1, name: "Senza categoria", slug: "senza-categoria", parent: 0 },
  { id: 10, name: "Sneakers", slug: "sneakers", parent: 0 },
  { id: 11, name: "Basse", slug: "basse", parent: 10 },
  { id: 12, name: "Retro", slug: "retro", parent: 11 },
  { id: 13, name: "Alte", slug: "alte", parent: 10 },
  { id: 20, name: "Saldi", slug: "saldi", parent: 0 },
  { id: 30, name: "Vuota", slug: "vuota", parent: 0 },
];

const BRANDS: Term[] = [
  { id: 100, name: "Nike", slug: "nike", parent: 0 },
  { id: 101, name: "Nike Dunk", slug: "nike-dunk", parent: 100 },
  { id: 102, name: "Nike Air Force 1", slug: "nike-air-force-1", parent: 100 },
  { id: 200, name: "Adidas", slug: "adidas", parent: 0 },
  { id: 300, name: "Asics", slug: "asics", parent: 0 },
];

const RULE = { id: "rule-alte", enabled: true, match: "all", conditions: [], members: 1, held: null, lastError: null };

const termOf = (list: Term[], id: number) => {
  const t = list.find((x) => x.id === id)!;
  return { id: t.id, slug: t.slug, name: t.name };
};

function product(p: Partial<IndexRow> & { id: number; name: string }, cats: number[] = [], brands: number[] = []): IndexRow {
  return {
    sku: `SKU-${p.id}`,
    type: "variable",
    status: "publish",
    permalink: `https://shop.test/p/${p.id}`,
    categories: cats.map((id) => termOf(CATEGORIES, id)),
    tags: [{ id: 7, slug: "saldi", name: "saldi" }],
    brands: brands.map((id) => termOf(BRANDS, id)),
    attributes: [],
    price: 100,
    onSale: false,
    stockStatus: "instock",
    image: `https://shop.test/img/${p.id}.jpg`,
    visibility: "visible",
    menuOrder: 0,
    totalSales: 0,
    dateCreated: "2026-09-01T10:00:00.000Z",
    dateModified: "2026-09-01T10:00:00.000Z",
    ...p,
  };
}

/**
 * The shop: Sneakers › Basse › Retro and Sneakers › Alte; Nike › Nike Dunk and
 * Nike › Nike Air Force 1. Product 2 sits in two sub-categories and two
 * sub-brands at once — it must count once for Sneakers and once for Nike.
 */
const SHOP: IndexRow[] = [
  product(
    {
      id: 1,
      name: "Nike Dunk Low Panda",
      sku: "DD1391-100",
      price: 139,
      menuOrder: 2,
      totalSales: 50,
      dateCreated: "2026-09-01T10:00:00.000Z",
      // The index can lag a rename by minutes: the store's list names it.
      categories: [{ id: 11, slug: "basse", name: "Basse (vecchio nome)" }],
    },
    [],
    [101],
  ),
  product(
    {
      id: 2,
      name: "Nike Dunk High Retro",
      sku: "DD1399-105",
      price: 159,
      menuOrder: 2,
      totalSales: 10,
      dateCreated: "2026-09-10T10:00:00.000Z",
    },
    [12, 13],
    [101, 102],
  ),
  product(
    {
      id: 3,
      name: "Air Force 1 '07",
      sku: "CW2288-111",
      price: 99,
      onSale: true,
      menuOrder: 1,
      totalSales: 80,
      dateCreated: "2026-08-01T10:00:00.000Z",
    },
    [11, 20],
    [102],
  ),
  product(
    {
      id: 4,
      name: "Adidas Samba OG",
      sku: "B75806",
      price: 109,
      stockStatus: "outofstock",
      menuOrder: 0,
      totalSales: 10,
      dateCreated: "2026-09-20T10:00:00.000Z",
    },
    [10],
    [200],
  ),
  product(
    {
      id: 5,
      name: "Adidas Gazelle",
      sku: "BB5476",
      price: 89,
      visibility: "hidden",
      onSale: true,
      menuOrder: 3,
      totalSales: 5,
      dateCreated: "2026-07-01T10:00:00.000Z",
    },
    [20],
    [200],
  ),
  product({ id: 6, name: "Bozza senza nome", sku: "", status: "draft", image: "", price: null }),
  product({ id: 7, name: "Solo default", sku: "UNC-1", price: 50 }, [1], [100]),
  product(
    { id: 8, name: "Ébène Runner", sku: "EBN-1", status: "private", image: "", price: null, menuOrder: 5, dateCreated: null },
    [10],
  ),
];

function card(id: number): ProductCard {
  return {
    id,
    sku: "",
    name: "",
    type: "",
    status: "publish",
    visibility: "visible",
    stockStatus: "instock",
    price: null,
    priceMax: null,
    onSale: false,
    image: "",
    permalink: "",
    editLink: "",
    created: null,
  };
}

function railBlock(key: string, title: string, taxonomy: string, termId: number, products: number[], pin: number[] = []) {
  return {
    path: "8.0",
    name: "golden-hive/shortcode-wrapper",
    kind: "rail" as const,
    rail: {
      key,
      path: "8.0",
      attrsHash: "",
      title,
      eyebrow: "",
      background: "",
      button: { text: "", url: "" },
      limit: 12,
      taxonomy,
      terms: [{ id: termId, slug: "", name: "", count: 0, link: null }],
      pin,
      exclude: [],
      fallback: "menu_order" as const,
      fallbackDefault: "menu_order" as const,
      editable: true,
      fields: {},
      products: products.map(card),
    },
  };
}

const HOME: Homepage = {
  pageId: 1,
  title: "Home",
  link: "",
  editLink: "",
  modifiedGmt: "",
  blocks: [
    railBlock("category:basse#0", "BASSE", "product_cat", 11, [3, 1], [1]),
    railBlock("brand:nike#0", "Nike", "product_brand", 100, [1]),
  ],
};

const ids = (list: { id: number }[]) => list.map((x) => x.id);

describe.skipIf(!enabled)("the Vetrina catalog's reads (real SQL)", () => {
  beforeEach(async () => {
    const { db, storeIndex, upsertIndexRows } = await load();
    await db.delete(storeIndex);
    await upsertIndexRows(SHOP);
    mocks.categories = CATEGORIES;
    mocks.brands = BRANDS;
    mocks.collections = { 13: RULE };
    mocks.collectionsFail = false;
    mocks.overrides = {
      global: {},
      products: {},
      variations: { "DD1391-100::42": { manualPrice: 150 }, "DD1391-100::43": { manualPrice: 155 }, "CW2288-111::40": {} },
    };
    mocks.homepage.mockReset();
    mocks.homepage.mockResolvedValue(HOME);
    mocks.freshen.mockReset();
    mocks.freshen.mockResolvedValue(undefined);
    mocks.runner = { running: null, queued: [] };
    // What the screens remember lives for the whole process: each test starts from none.
    delete (globalThis as { __vetrinaHomepage?: unknown }).__vetrinaHomepage;
    delete (globalThis as { __vetrinaScreenTrees?: unknown }).__vetrinaScreenTrees;
  });

  it("reads the light columns as plain numbers and ids", async () => {
    const { readIndexFacts } = await load();
    const facts = new Map((await readIndexFacts()).map((f) => [f.id, f]));
    expect(facts.size).toBe(8);
    expect(facts.get(2)).toMatchObject({
      price: 159,
      hasImage: true,
      categories: [12, 13],
      brands: [101, 102],
      created: Date.parse("2026-09-10T10:00:00.000Z"),
      menuOrder: 2,
      totalSales: 10,
    });
    expect(facts.get(8)).toMatchObject({ price: null, hasImage: false, created: null, categories: [10], brands: [], status: "private" });
  });

  it("counts every category and brand with its sub-terms, each product once, the empty ones included", async () => {
    const { readOverview } = await load();
    const overview = await readOverview();
    expect(mocks.freshen).toHaveBeenCalledTimes(1);
    expect(overview.indexProducts).toBe(8);
    expect(overview.demo).toBe(false);
    expect(ids(overview.categories)).toEqual([20, 1, 10, 13, 11, 12, 30]);
    expect(ids(overview.brands)).toEqual([200, 300, 100, 102, 101]);

    const cat = new Map(overview.categories.map((c) => [c.id, c]));
    expect(cat.get(10)).toMatchObject({ count: 5, soldOut: 1, hidden: 0, onSale: 1, parent: 0, children: [13, 11], path: "Sneakers" });
    expect(cat.get(11)).toMatchObject({ count: 3, path: "Sneakers › Basse", parent: 10, children: [12] });
    expect(cat.get(12)).toMatchObject({ count: 1, path: "Sneakers › Basse › Retro" });
    expect(cat.get(13)).toMatchObject({ count: 1, automatic: RULE });
    expect(cat.get(20)).toMatchObject({ count: 2, soldOut: 0, hidden: 1, onSale: 2, automatic: null });
    expect(cat.get(30)).toMatchObject({ count: 0, soldOut: 0, hidden: 0, onSale: 0 });
    expect(cat.get(1)?.count).toBe(1);

    const brand = new Map(overview.brands.map((b) => [b.id, b]));
    expect(brand.get(100)).toMatchObject({ count: 4, children: [102, 101], automatic: null });
    expect(brand.get(101)?.count).toBe(2);
    expect(brand.get(102)?.count).toBe(2);
    expect(brand.get(200)).toMatchObject({ count: 2, soldOut: 1, hidden: 1, onSale: 1 });
    expect(brand.get(300)?.count).toBe(0);

    expect(overview.views).toEqual([
      { view: "soldout", count: 1 },
      { view: "onsale", count: 2 },
      { view: "hidden", count: 1 },
      { view: "nophoto", count: 2 },
      { view: "nocategory", count: 2 },
      { view: "unpublished", count: 2 },
    ]);
  });

  it("keeps saying the shop is being read until its first full read is done, and never asks for it twice", async () => {
    const { db, storeIndex, upsertIndexRows, readOverview } = await load();
    await db.delete(storeIndex);
    expect((await readOverview()).indexProducts).toBe(0);
    expect(mocks.freshen).toHaveBeenCalledTimes(1);
    // The full read is under way and has written its first page.
    mocks.runner = { running: "full", queued: [] };
    await upsertIndexRows(SHOP.slice(0, 3));
    expect((await readOverview()).indexProducts).toBe(0);
    expect(mocks.freshen).toHaveBeenCalledTimes(1);
    // Done: the whole shop, and the screen shows it.
    mocks.runner = { running: null, queued: [] };
    await upsertIndexRows(SHOP);
    expect((await readOverview()).indexProducts).toBe(8);
    // A later full read (the daily one) does not hide a filled index.
    mocks.runner = { running: "full", queued: [] };
    expect((await readOverview()).indexProducts).toBe(8);
  });

  it("gives each term the homepage sections showing it alone", async () => {
    const { readOverview } = await load();
    const overview = await readOverview();
    expect(overview.categories.find((c) => c.id === 11)?.sections).toEqual([{ key: "category:basse#0", title: "BASSE" }]);
    expect(overview.brands.find((b) => b.id === 100)?.sections).toEqual([{ key: "brand:nike#0", title: "Nike" }]);
    expect(overview.categories.find((c) => c.id === 10)?.sections).toEqual([]);
  });

  it("answers all the same when the index refresh, the rules or the homepage cannot be read", async () => {
    const { readOverview, readPage } = await load();
    mocks.freshen.mockRejectedValue(new Error("connection refused"));
    mocks.collectionsFail = true;
    mocks.homepage.mockRejectedValue(new Error("Il sito non risponde"));
    const overview = await readOverview();
    expect(overview.categories.find((c) => c.id === 13)).toMatchObject({ count: 1, automatic: null });
    expect(overview.categories.find((c) => c.id === 11)?.sections).toEqual([]);
    const page = await readPage({ taxonomy: "category", termId: 11 });
    expect(page.products.find((p) => p.id === 1)?.sections).toEqual([]);
  });

  it("reads the homepage once a minute, whatever the screens ask", async () => {
    const { readOverview, readPage, forgetHomepagePresence } = await load();
    await readOverview();
    await readPage({ view: "onsale" });
    expect(mocks.homepage).toHaveBeenCalledTimes(1);
    forgetHomepagePresence();
    await readPage({ view: "onsale" });
    expect(mocks.homepage).toHaveBeenCalledTimes(2);
  });

  it("shows a category the Hub creates at once, and one made elsewhere within minutes", async () => {
    const { readOverview } = await load();
    const { noteTermsChanged } = await import("@/server/woo/taxonomy-cache");
    expect((await readOverview()).categories.map((c) => c.id)).not.toContain(40);
    // Made in WordPress: the screens answer with the categories they know, and read the store behind.
    mocks.categories = [...CATEGORIES, { id: 40, name: "Estive", slug: "estive", parent: 0 }];
    expect((await readOverview()).categories.map((c) => c.id)).not.toContain(40);
    // Made by the Hub (a new automatic category opens its own screen next): read before answering.
    mocks.categories = [...mocks.categories, { id: 41, name: "Autunno", slug: "autunno", parent: 0 }];
    await new Promise((r) => setTimeout(r, 2));
    noteTermsChanged();
    await new Promise((r) => setTimeout(r, 2));
    expect((await readOverview()).categories.map((c) => c.id)).toEqual(expect.arrayContaining([40, 41]));
  });

  it("opens a term with its ancestors and its sub-terms, and says when it is gone", async () => {
    const { readTerm } = await load();
    const sneakers = await readTerm("category", 10);
    expect(sneakers.term).toMatchObject({ id: 10, count: 5 });
    expect(sneakers.ancestors).toEqual([]);
    expect(sneakers.children.map((c) => [c.id, c.name, c.count])).toEqual([
      [13, "Alte", 1],
      [11, "Basse", 3],
    ]);
    expect((await readTerm("category", 12)).ancestors).toEqual([
      { id: 10, name: "Sneakers" },
      { id: 11, name: "Basse" },
    ]);
    const dunk = await readTerm("brand", 101);
    expect(dunk.term).toMatchObject({ taxonomy: "brand", name: "Nike Dunk", count: 2, automatic: null });
    expect(dunk.ancestors).toEqual([{ id: 100, name: "Nike" }]);
    await expect(readTerm("category", 999)).rejects.toMatchObject({ code: "not_found" });
    await expect(readTerm("brand", 10)).rejects.toMatchObject({ code: "not_found" });
  });

  it("reads a term's screen at once: the term and its first page, narrowed", async () => {
    const { readTermScreen } = await load();
    const { detail, page } = await readTermScreen("category", 10, { stock: "instock", sort: "name" });
    expect(detail.term).toMatchObject({ id: 10, count: 5 });
    expect(ids(page.products)).toEqual([3, 8, 2, 1]);
    expect(page.facets).toMatchObject({ instock: 4, outofstock: 1 });
    await expect(readTermScreen("brand", 10, {})).rejects.toMatchObject({ code: "not_found" });
  });

  it("lists a term's products with its sub-terms', whole, with locks and homepage places", async () => {
    const { readPage } = await load();
    const page = await readPage({ taxonomy: "category", termId: 10 });
    expect(ids(page.products)).toEqual([4, 3, 2, 1, 8]);
    expect(page.total).toBe(5);
    expect(page.offset).toBe(0);
    const panda = page.products.find((p) => p.id === 1)!;
    expect(panda).toEqual({
      id: 1,
      sku: "DD1391-100",
      name: "Nike Dunk Low Panda",
      status: "publish",
      visibility: "visible",
      stockStatus: "instock",
      price: 139,
      onSale: false,
      permalink: "https://shop.test/p/1",
      menuOrder: 2,
      totalSales: 50,
      dateCreated: "2026-09-01T10:00:00.000Z",
      categories: [{ id: 11, name: "Basse" }],
      brands: [{ id: 101, name: "Nike Dunk" }],
      tags: [{ id: 7, name: "saldi" }],
      hasImage: true,
      locks: 2,
      sections: [
        { key: "category:basse#0", title: "BASSE", position: 2, pinned: true },
        { key: "brand:nike#0", title: "Nike", position: 1, pinned: false },
      ],
    });
    expect(page.products.find((p) => p.id === 3)).toMatchObject({
      locks: 0,
      sections: [{ key: "category:basse#0", title: "BASSE", position: 1, pinned: false }],
    });
    expect(page.products.find((p) => p.id === 8)).toMatchObject({ hasImage: false, price: null, dateCreated: null, sections: [] });
  });

  it("sorts each way, unknown dates and prices last", async () => {
    const { readPage } = await load();
    const order = async (sort: "shop" | "newest" | "bestselling" | "priceAsc" | "priceDesc" | "name") =>
      ids((await readPage({ taxonomy: "category", termId: 10, sort })).products);
    expect(await order("shop")).toEqual([4, 3, 2, 1, 8]);
    expect(await order("newest")).toEqual([4, 2, 1, 3, 8]);
    expect(await order("bestselling")).toEqual([3, 1, 4, 2, 8]);
    expect(await order("priceAsc")).toEqual([3, 4, 1, 2, 8]);
    expect(await order("priceDesc")).toEqual([2, 1, 4, 3, 8]);
    expect(await order("name")).toEqual([4, 3, 8, 2, 1]);
  });

  it("pages through, the total counting every match", async () => {
    const { readPage } = await load();
    const second = await readPage({ taxonomy: "category", termId: 10, offset: 2, limit: 2 });
    expect(ids(second.products)).toEqual([2, 1]);
    expect(second).toMatchObject({ total: 5, offset: 2 });
    const past = await readPage({ taxonomy: "category", termId: 10, offset: 5, limit: 2 });
    expect(past.products).toEqual([]);
    expect(past.total).toBe(5);
  });

  it("counts each chip with the other chips on, never itself", async () => {
    const { readPage } = await load();
    const soldOut = await readPage({ taxonomy: "category", termId: 10, stock: "outofstock" });
    expect(ids(soldOut.products)).toEqual([4]);
    expect(soldOut.total).toBe(1);
    expect(soldOut.facets).toEqual({
      instock: 4,
      outofstock: 1,
      hidden: 0,
      onSale: 1,
      children: [
        { id: 11, name: "Basse", count: 3 },
        { id: 13, name: "Alte", count: 1 },
      ],
      // Only the sold-out one: tapping a brand keeps "Esauriti" on.
      within: [{ id: 200, name: "Adidas", count: 1 }],
    });
    const dunk = await readPage({ taxonomy: "category", termId: 10, within: 101 });
    expect(dunk.facets).toMatchObject({ instock: 2, outofstock: 0, hidden: 0, onSale: 0 });
    expect(dunk.facets.within.map((f) => [f.id, f.count])).toEqual([
      [100, 3],
      [102, 2],
      [101, 2],
      [200, 1],
    ]);
    expect(ids((await readPage({ taxonomy: "category", termId: 10, stock: "instock" })).products)).toEqual([3, 2, 1, 8]);
    expect(ids((await readPage({ taxonomy: "category", termId: 10, within: 101 })).products)).toEqual([2, 1]);
    expect(ids((await readPage({ taxonomy: "category", termId: 10, within: 100 })).products)).toEqual([3, 2, 1]);
    expect(ids((await readPage({ taxonomy: "category", termId: 10, onSale: true })).products)).toEqual([3]);
    const saldiHidden = await readPage({ taxonomy: "category", termId: 20, visibility: "hidden" });
    expect(ids(saldiHidden.products)).toEqual([5]);
    expect(saldiHidden.facets).toMatchObject({ instock: 2, outofstock: 0, hidden: 1, onSale: 2, children: [] });
    expect(ids((await readPage({ taxonomy: "category", termId: 20, visibility: "visible" })).products)).toEqual([3]);
  });

  it("on a brand, the chips are its sub-brands and the categories inside it", async () => {
    const { readPage } = await load();
    const nike = await readPage({ taxonomy: "brand", termId: 100 });
    expect(ids(nike.products)).toEqual([7, 3, 2, 1]);
    expect(nike.facets.children).toEqual([
      { id: 102, name: "Nike Air Force 1", count: 2 },
      { id: 101, name: "Nike Dunk", count: 2 },
    ]);
    expect(nike.facets.within.map((f) => [f.id, f.count])).toEqual([
      [11, 3],
      [10, 3],
      [13, 1],
      [12, 1],
      [20, 1],
      [1, 1],
    ]);
    expect(ids((await readPage({ taxonomy: "brand", termId: 100, within: 20 })).products)).toEqual([3]);
  });

  it("lists every quick view", async () => {
    const { readPage } = await load();
    const view = async (v: "soldout" | "onsale" | "hidden" | "nophoto" | "nocategory" | "unpublished") =>
      ids((await readPage({ view: v })).products);
    expect(await view("soldout")).toEqual([4]);
    expect(await view("onsale")).toEqual([3, 5]);
    expect(await view("hidden")).toEqual([5]);
    expect(await view("nophoto")).toEqual([6, 8]);
    expect(await view("nocategory")).toEqual([6, 7]);
    expect(await view("unpublished")).toEqual([6, 8]);
    // A quick view's chips are the brands.
    expect((await readPage({ view: "onsale" })).facets.within.map((f) => f.id)).toEqual([200, 100, 102]);
  });

  it("finds categories, brands and products at once, accents and case aside", async () => {
    const { search, readPage } = await load();
    const nike = await search("nike");
    expect(ids(nike.categories)).toEqual([]);
    expect(ids(nike.brands)).toEqual([100, 102, 101]);
    expect(nike.brands[0]).toMatchObject({ count: 4, sections: [{ key: "brand:nike#0", title: "Nike" }] });
    expect(ids(nike.products)).toEqual([2, 1]);
    expect(nike.totalProducts).toBe(2);
    expect(nike.products[1]).toMatchObject({ locks: 2, permalink: "https://shop.test/p/1" });
    // The search's "see all" is the same list.
    expect((await readPage({ q: "nike" })).total).toBe(nike.totalProducts);

    expect(ids((await search("EBENE")).products)).toEqual([8]);
    expect(ids((await search("dd1391")).products)).toEqual([1]);
    expect(ids((await search("dunk retro")).products)).toEqual([2]);
    const basse = await search("basse");
    expect(ids(basse.categories)).toEqual([11, 12]);
    expect(basse.categories[1]).toMatchObject({ path: "Sneakers › Basse › Retro", count: 1 });
    expect(await search("   ")).toEqual({ categories: [], brands: [], products: [], totalProducts: 0 });
  });

  it("finds at most 5 terms per taxonomy and 20 products", async () => {
    const { search, upsertIndexRows } = await load();
    mocks.categories = [...CATEGORIES, ...Array.from({ length: 8 }, (_, i) => ({ id: 40 + i, name: `Nike ${i}`, slug: `nike-${i}` }))];
    await upsertIndexRows(Array.from({ length: 30 }, (_, i) => product({ id: 100 + i, name: `Nike Extra ${i}` })));
    const found = await search("nike");
    expect(found.categories).toHaveLength(5);
    expect(found.brands).toHaveLength(3);
    expect(found.products).toHaveLength(20);
    expect(found.totalProducts).toBe(32);
  });

  it("places a product: its categories with their path and rule, its brands, its homepage sections", async () => {
    const { readPlacement } = await load();
    expect(await readPlacement(2)).toEqual({
      id: 2,
      status: "publish",
      visibility: "visible",
      categories: [
        { id: 13, name: "Alte", path: "Sneakers › Alte", automatic: true },
        { id: 12, name: "Retro", path: "Sneakers › Basse › Retro", automatic: false },
      ],
      brands: [
        { id: 101, name: "Nike Dunk" },
        { id: 102, name: "Nike Air Force 1" },
      ],
      sections: [],
    });
    expect((await readPlacement(1)).sections).toEqual([
      { key: "category:basse#0", title: "BASSE", position: 2, pinned: true },
      { key: "brand:nike#0", title: "Nike", position: 1, pinned: false },
    ]);
    expect(await readPlacement(8)).toMatchObject({ status: "private", categories: [{ id: 10, path: "Sneakers", automatic: false }] });
    await expect(readPlacement(999)).rejects.toMatchObject({ code: "not_found" });
  });
});
