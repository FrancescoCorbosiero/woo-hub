import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeBlock, Homepage, ProductCard, RailSummary } from "@/lib/vetrina/types";
import type { IndexFacts } from "@/server/collections/repo";

// No database, no site: only the pure helpers and the homepage's cache, over a stand-in site.
const { homepage } = vi.hoisted(() => ({ homepage: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("./source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./source")>()),
  getVetrinaSource: async () => ({ kind: "wordpress", homepage }),
}));

import {
  ancestorIds,
  compareFacts,
  defaultCategoryIds,
  fold,
  forgetHomepagePresence,
  homepagePresence,
  inView,
  presenceOf,
  productMatcher,
  rankProducts,
  rankTerms,
  rollUp,
  selectPage,
  termTree,
  withDescendants,
  type StoreTerm,
} from "./catalog";

const CATEGORIES: StoreTerm[] = [
  { id: 1, name: "Senza categoria", slug: "senza-categoria", parent: 0 },
  { id: 10, name: "Sneakers", slug: "sneakers", parent: 0 },
  { id: 11, name: "Basse", slug: "basse", parent: 10 },
  { id: 12, name: "Retro", slug: "retro", parent: 11 },
  { id: 13, name: "Alte", slug: "alte", parent: 10 },
  { id: 20, name: "Saldi &amp; Outlet", slug: "saldi", parent: 0 },
  // Its parent is not in the list (a listing cut short): it must still show.
  { id: 30, name: "Orfana", slug: "orfana", parent: 999 },
];

// Brands come without "parent" in the client's type, with it at runtime.
const BRANDS: StoreTerm[] = [
  { id: 100, name: "Nike", slug: "nike" },
  { id: 101, name: "Nike Dunk", slug: "nike-dunk", parent: 100 },
  { id: 102, name: "Nike Air Force 1", slug: "nike-air-force-1", parent: 100 },
  { id: 200, name: "Adidas", slug: "adidas", parent: 0 },
];

const trees = () => ({ category: termTree(CATEGORIES), brand: termTree(BRANDS) });

function facts(p: Partial<IndexFacts> & { id: number }): IndexFacts {
  return {
    sku: `SKU-${p.id}`,
    name: `Product ${p.id}`,
    status: "publish",
    visibility: "visible",
    stockStatus: "instock",
    onSale: false,
    price: 100,
    hasImage: true,
    menuOrder: 0,
    totalSales: 0,
    created: Date.parse("2026-09-01T00:00:00Z"),
    categories: [],
    brands: [],
    ...p,
  };
}

const ids = (list: { id: number }[]) => list.map((x) => x.id);

describe("term trees", () => {
  it("decodes names, orders sub-terms by name, writes paths, and keeps orphans at the top", () => {
    const tree = termTree(CATEGORIES);
    expect(tree.terms.get(20)?.name).toBe("Saldi & Outlet");
    expect(tree.children.get(0)).toEqual([30, 20, 1, 10]);
    expect(tree.children.get(10)).toEqual([13, 11]);
    expect(tree.paths.get(12)).toBe("Sneakers › Basse › Retro");
    expect(tree.paths.get(20)).toBe("Saldi & Outlet");
    expect(tree.terms.get(30)?.parent).toBe(0);
    expect(termTree(BRANDS).paths.get(101)).toBe("Nike › Nike Dunk");
  });

  it("lists ancestors from the top level down, and stops on a loop in bad data", () => {
    const tree = termTree(CATEGORIES);
    expect(ancestorIds(12, tree.parents)).toEqual([10, 11]);
    expect(ancestorIds(10, tree.parents)).toEqual([]);
    expect(ancestorIds(1, new Map([[1, 2], [2, 1]]))).toEqual([2]);
  });

  it("expands a term to every term below it, at any depth", () => {
    const tree = termTree(CATEGORIES);
    expect([...withDescendants(10, tree.children)].sort((a, b) => a - b)).toEqual([10, 11, 12, 13]);
    expect([...withDescendants(12, tree.children)]).toEqual([12]);
    expect([...withDescendants(1, new Map([[1, [2]], [2, [1]]]))].sort()).toEqual([1, 2]);
  });
});

describe("counting", () => {
  it("counts a product once for a term, however many of its sub-terms hold it", () => {
    const { category, brand } = trees();
    const list = [
      facts({ id: 1, categories: [12, 13], brands: [101, 102] }),
      facts({ id: 2, categories: [11], brands: [101], stockStatus: "outofstock", visibility: "hidden", onSale: true }),
      facts({ id: 3, categories: [] }),
    ];
    const cats = rollUp(list, "category", category.parents);
    expect(cats.get(10)).toEqual({ count: 2, soldOut: 1, hidden: 1, onSale: 1 });
    expect(cats.get(11)).toEqual({ count: 2, soldOut: 1, hidden: 1, onSale: 1 });
    expect(cats.get(12)?.count).toBe(1);
    expect(cats.get(13)?.count).toBe(1);
    expect(cats.has(20)).toBe(false);
    const brands = rollUp(list, "brand", brand.parents);
    expect(brands.get(100)?.count).toBe(2);
    expect(brands.get(101)?.count).toBe(2);
    expect(brands.get(102)?.count).toBe(1);
  });
});

describe("quick views", () => {
  const defaults = defaultCategoryIds(termTree([...CATEGORIES, { id: 2, name: "Uncategorized", slug: "uncategorized" }]));

  it("knows the store's default category by its slug, in English and Italian", () => {
    expect([...defaults].sort()).toEqual([1, 2]);
  });

  it("decides each view", () => {
    expect(inView("soldout", facts({ id: 1, stockStatus: "outofstock" }), defaults)).toBe(true);
    expect(inView("soldout", facts({ id: 1, stockStatus: "onbackorder" }), defaults)).toBe(false);
    expect(inView("onsale", facts({ id: 1, onSale: true }), defaults)).toBe(true);
    expect(inView("onsale", facts({ id: 1 }), defaults)).toBe(false);
    expect(inView("hidden", facts({ id: 1, visibility: "hidden" }), defaults)).toBe(true);
    expect(inView("hidden", facts({ id: 1, visibility: "search" }), defaults)).toBe(false);
    expect(inView("nophoto", facts({ id: 1, hasImage: false }), defaults)).toBe(true);
    expect(inView("nophoto", facts({ id: 1 }), defaults)).toBe(false);
    expect(inView("nocategory", facts({ id: 1, categories: [] }), defaults)).toBe(true);
    expect(inView("nocategory", facts({ id: 1, categories: [1] }), defaults)).toBe(true);
    expect(inView("nocategory", facts({ id: 1, categories: [1, 10] }), defaults)).toBe(false);
    for (const status of ["draft", "pending", "private", ""]) {
      expect(inView("unpublished", facts({ id: 1, status }), defaults)).toBe(true);
    }
    expect(inView("unpublished", facts({ id: 1 }), defaults)).toBe(false);
  });
});

describe("search", () => {
  it("folds case, accents, spaces, hyphens and slashes", () => {
    expect(fold("  Ébène   RUNNER ")).toBe("ebene runner");
    expect(fold("Air-Force 1 / '07")).toBe("air force 1 '07");
  });

  it("finds a product by every word of the query, in its name or SKU", () => {
    const match = productMatcher("dunk PANDA");
    expect(match(facts({ id: 1, name: "Nike Dunk Low Panda" }))).toBe(true);
    expect(match(facts({ id: 1, name: "Nike Dunk Low Grey" }))).toBe(false);
    expect(productMatcher("ebene")(facts({ id: 1, name: "Ébène Runner" }))).toBe(true);
    expect(productMatcher("dd1391")(facts({ id: 1, sku: "DD1391-100" }))).toBe(true);
  });

  it("finds a style code typed with or without its separators, and a hyphenated name", () => {
    const shoe = facts({ id: 1, name: "Nike Air Force 1 Low", sku: "DD1391-100" });
    expect(productMatcher("dd1391100")(shoe)).toBe(true);
    expect(productMatcher("DD1391-100")(shoe)).toBe(true);
    expect(productMatcher("dd1391 100")(shoe)).toBe(true);
    expect(productMatcher("air-force")(shoe)).toBe(true);
    expect(productMatcher("dd1391101")(shoe)).toBe(false);
    // The exact code ranks first, however it was typed.
    const other = facts({ id: 2, name: "DD1391100 Tee", sku: "TEE-1" });
    expect(ids(rankProducts([other, shoe], "dd1391100"))).toEqual([1, 2]);
  });

  it("ranks the exact SKU first, then what starts with the query, then the rest, by name", () => {
    const list = [
      facts({ id: 1, name: "Air Max 90", sku: "AM90" }),
      facts({ id: 2, name: "Retro Air", sku: "RA-1" }),
      facts({ id: 3, name: "Nike Air", sku: "AIR" }),
      facts({ id: 4, name: "Air Force 1", sku: "AF1" }),
      facts({ id: 5, name: "Dunk", sku: "DK" }),
    ];
    expect(ids(rankProducts(list, "air"))).toEqual([3, 4, 1, 2]);
  });

  it("ranks terms: a name starting with the query, then one holding its words, then a parent's name", () => {
    expect(ids(rankTerms(termTree(BRANDS), "nike"))).toEqual([100, 102, 101]);
    expect(ids(rankTerms(termTree(BRANDS), "dunk"))).toEqual([101]);
    expect(ids(rankTerms(termTree(CATEGORIES), "basse"))).toEqual([11, 12]);
    expect(ids(rankTerms(termTree(CATEGORIES), "outlet saldi"))).toEqual([20]);
    expect(ids(rankTerms(termTree(CATEGORIES), "sneakers retro"))).toEqual([12]);
  });
});

describe("sorting", () => {
  const day = (d: number) => Date.parse(`2026-09-${String(d).padStart(2, "0")}T00:00:00Z`);
  const list = [
    facts({ id: 1, name: "Nike Dunk Low Panda", menuOrder: 2, created: day(1), totalSales: 50, price: 139 }),
    facts({ id: 2, name: "Nike Dunk High Retro", menuOrder: 2, created: day(10), totalSales: 10, price: 159 }),
    facts({ id: 3, name: "Air Force 1 '07", menuOrder: 1, created: day(2), totalSales: 80, price: 99 }),
    facts({ id: 4, name: "adidas Samba OG", menuOrder: 0, created: day(20), totalSales: 10, price: 109 }),
    facts({ id: 5, name: "Ébène Runner", menuOrder: 5, created: null, totalSales: 0, price: null }),
  ];
  const sorted = (sort: Parameters<typeof compareFacts>[0]) => ids([...list].sort(compareFacts(sort)));

  it("orders each sort, ties by name, unknown dates and prices last", () => {
    expect(sorted("shop")).toEqual([4, 3, 2, 1, 5]);
    expect(sorted("newest")).toEqual([4, 2, 3, 1, 5]);
    expect(sorted("bestselling")).toEqual([3, 1, 4, 2, 5]);
    expect(sorted("priceAsc")).toEqual([3, 4, 1, 2, 5]);
    expect(sorted("priceDesc")).toEqual([2, 1, 4, 3, 5]);
    expect(sorted("name")).toEqual([4, 3, 5, 2, 1]);
  });

  it("sorts names as a person reads them: numbers by value, any case", () => {
    const shoes = [
      facts({ id: 1, name: "Jordan 11" }),
      facts({ id: 2, name: "jordan 4" }),
      facts({ id: 3, name: "Jordan 1" }),
    ];
    expect(ids([...shoes].sort(compareFacts("name")))).toEqual([3, 2, 1]);
  });
});

describe("a page of products", () => {
  const list = [
    facts({ id: 1, name: "A", categories: [11], brands: [101], menuOrder: 1 }),
    facts({ id: 2, name: "B", categories: [12, 13], brands: [101, 102], menuOrder: 2, onSale: true }),
    facts({ id: 3, name: "C", categories: [11, 20], brands: [102], menuOrder: 3, stockStatus: "outofstock" }),
    facts({ id: 4, name: "D", categories: [10], brands: [200], menuOrder: 4, visibility: "hidden" }),
    facts({ id: 5, name: "E", categories: [20], brands: [200], menuOrder: 5 }),
    facts({ id: 6, name: "F", categories: [], brands: [], menuOrder: 6, status: "draft" }),
  ];

  it("takes a term with its sub-terms; each chip counts with the other chips on, never itself", () => {
    const page = selectPage(list, { taxonomy: "category", termId: 10, stock: "instock" }, trees());
    expect(page.ids).toEqual([1, 2, 4]);
    expect(page.total).toBe(3);
    // The status chips leave their own choice out: "Esauriti" still says 1.
    expect(page.facets).toMatchObject({ instock: 3, outofstock: 1, hidden: 1, onSale: 1 });
    expect(page.facets.children).toEqual([
      { id: 11, name: "Basse", count: 3 },
      { id: 13, name: "Alte", count: 1 },
    ]);
    // The brands count the in-stock products, rolled up: Nike holds 1 and 2 once each.
    expect(page.facets.within).toEqual([
      { id: 100, name: "Nike", count: 2 },
      { id: 101, name: "Nike Dunk", count: 2 },
      { id: 200, name: "Adidas", count: 1 },
      { id: 102, name: "Nike Air Force 1", count: 1 },
    ]);
  });

  it("with a brand chosen, the status chips count inside it, and the brands with no status on", () => {
    const page = selectPage(list, { taxonomy: "category", termId: 10, within: 102 }, trees());
    // Nike Air Force 1 holds 2 (on sale) and 3 (sold out).
    expect(page.ids).toEqual([2, 3]);
    expect(page.facets).toMatchObject({ instock: 1, outofstock: 1, hidden: 0, onSale: 1 });
    expect(page.facets.within.map((f) => [f.id, f.count])).toEqual([
      [100, 3],
      [102, 2],
      [101, 2],
      [200, 1],
    ]);
  });

  it("keeps the chosen term among the facets at 0 when nothing carries it, and invents none", () => {
    const t = trees();
    const page = selectPage(list, { taxonomy: "category", termId: 10, within: 200, stock: "outofstock" }, t);
    expect(page.ids).toEqual([]);
    expect(page.facets.within).toContainEqual({ id: 200, name: "Adidas", count: 0 });
    expect(selectPage(list, { taxonomy: "category", termId: 10, within: 999 }, t).facets.within.some((f) => f.id === 999)).toBe(
      false,
    );
  });

  it("narrows by visibility, sale and a term of the other taxonomy (its sub-terms included)", () => {
    const t = trees();
    expect(selectPage(list, { taxonomy: "category", termId: 10, visibility: "hidden" }, t).ids).toEqual([4]);
    expect(selectPage(list, { taxonomy: "category", termId: 10, visibility: "visible" }, t).ids).toEqual([1, 2, 3]);
    expect(selectPage(list, { taxonomy: "category", termId: 10, onSale: true }, t).ids).toEqual([2]);
    expect(selectPage(list, { taxonomy: "category", termId: 10, onSale: false }, t).ids).toEqual([1, 3, 4]);
    expect(selectPage(list, { taxonomy: "category", termId: 10, within: 100 }, t).ids).toEqual([1, 2, 3]);
    expect(selectPage(list, { taxonomy: "category", termId: 10, within: 102 }, t).ids).toEqual([2, 3]);
    expect(selectPage(list, { taxonomy: "category", termId: 10, stock: "outofstock" }, t).ids).toEqual([3]);
  });

  it("on a brand, the other taxonomy is the categories", () => {
    const page = selectPage(list, { taxonomy: "brand", termId: 100, within: 20 }, trees());
    expect(page.ids).toEqual([3]);
    // Equal counts go by name.
    expect(page.facets.children).toEqual([
      { id: 102, name: "Nike Air Force 1", count: 2 },
      { id: 101, name: "Nike Dunk", count: 2 },
    ]);
    expect(page.facets.within.map((f) => [f.id, f.count])).toEqual([
      [11, 3],
      [10, 3],
      [13, 1],
      [12, 1],
      [20, 1],
    ]);
  });

  it("combines a quick view and a search, and lists the whole index without either", () => {
    const t = trees();
    expect(selectPage(list, { view: "unpublished" }, t).ids).toEqual([6]);
    expect(selectPage(list, { view: "nocategory" }, t).ids).toEqual([6]);
    expect(selectPage(list, { q: "sku-3" }, t).ids).toEqual([3]);
    expect(selectPage(list, { q: "  " }, t).total).toBe(6);
    expect(selectPage(list, { view: "onsale", q: "b" }, t).ids).toEqual([2]);
    expect(selectPage(list, { view: "onsale", q: "a" }, t).ids).toEqual([]);
  });

  it("pages through the sorted list, the limit kept within bounds", () => {
    const t = trees();
    const page = selectPage(list, { sort: "name", offset: 2, limit: 2 }, t);
    expect(page).toMatchObject({ ids: [3, 4], total: 6, offset: 2 });
    expect(selectPage(list, { offset: 10 }, t).ids).toEqual([]);
    expect(selectPage(list, { limit: 0 }, t).ids).toHaveLength(1);
    const many = Array.from({ length: 150 }, (_, i) => facts({ id: i + 1 }));
    expect(selectPage(many, {}, t).ids).toHaveLength(40);
    expect(selectPage(many, { limit: 500 }, t).ids).toHaveLength(100);
  });
});

/* ---------------------------------------------------------------- *
 * The homepage's sections
 * ---------------------------------------------------------------- */

function card(id: number, extra: Partial<ProductCard> = {}): ProductCard {
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
    ...extra,
  };
}

function rail(key: string, over: Partial<RailSummary>): HomeBlock {
  return {
    path: "8.0",
    name: "golden-hive/shortcode-wrapper",
    kind: "rail",
    rail: {
      key,
      path: "8.0",
      attrsHash: "",
      title: "",
      eyebrow: "",
      background: "",
      button: { text: "", url: "" },
      limit: 12,
      taxonomy: null,
      terms: [],
      pin: [],
      exclude: [],
      fallback: "menu_order",
      fallbackDefault: "menu_order",
      editable: true,
      fields: {},
      products: [],
      ...over,
    },
  };
}

const term = (id: number) => ({ id, slug: `t${id}`, name: `T${id}`, count: 0, link: null });

const HOME: Homepage = {
  pageId: 1,
  title: "Home",
  link: "",
  editLink: "",
  modifiedGmt: "",
  blocks: [
    { path: "0", name: "core/html", kind: "static", summary: { title: null, items: null, labels: [] } },
    rail("category:basse#0", {
      title: "BASSE",
      taxonomy: "product_cat",
      terms: [term(11)],
      // A product gone from the shop takes no slot: 3 is first, 1 second.
      products: [card(9, { missing: true }), card(3), card(1)],
      pin: [1],
    }),
    rail("brand:nike#0", { title: "  ", taxonomy: "product_brand", terms: [term(100)], products: [card(1)] }),
    rail("category:sneakers#0", { title: "MIX", taxonomy: "product_cat", terms: [term(10), term(20)], products: [card(4)] }),
    rail("tag:saldi#0", { title: "TAG", taxonomy: "product_tag", terms: [term(5)], products: [card(2)] }),
  ],
};


describe("where the homepage shows terms and products", () => {
  it("gives a term the sections showing it alone, and a product every section showing it, with its place", () => {
    const presence = presenceOf(HOME);
    expect(presence.terms.get("category:11")).toEqual([{ key: "category:basse#0", title: "BASSE" }]);
    // No title: the section's key stands in.
    expect(presence.terms.get("brand:100")).toEqual([{ key: "brand:nike#0", title: "brand:nike#0" }]);
    // Two categories, or a tag: not a term's section.
    expect(presence.terms.has("category:10")).toBe(false);
    expect([...presence.terms.keys()]).toHaveLength(2);
    expect(presence.products.get(1)).toEqual([
      { key: "category:basse#0", title: "BASSE", position: 2, pinned: true },
      { key: "brand:nike#0", title: "brand:nike#0", position: 1, pinned: false },
    ]);
    expect(presence.products.get(3)).toEqual([{ key: "category:basse#0", title: "BASSE", position: 1, pinned: false }]);
    expect(presence.products.get(4)?.[0]).toMatchObject({ key: "category:sneakers#0", position: 1 });
    expect(presence.products.get(2)?.[0]).toMatchObject({ key: "tag:saldi#0", title: "TAG" });
    expect(presence.products.has(9)).toBe(false);
  });
});

describe("the homepage's sections, remembered", () => {
  beforeEach(() => {
    // The homepage the screens share lives for the whole process: each test starts from none.
    delete (globalThis as { __vetrinaHomepage?: unknown }).__vetrinaHomepage;
    homepage.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the homepage once a minute, and again when told to forget", async () => {
    vi.useFakeTimers();
    homepage.mockResolvedValue(HOME);
    expect((await homepagePresence()).products.get(3)).toHaveLength(1);
    await homepagePresence();
    expect(homepage).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    await homepagePresence();
    expect(homepage).toHaveBeenCalledTimes(2);
    forgetHomepagePresence();
    await homepagePresence();
    expect(homepage).toHaveBeenCalledTimes(3);
  });

  it("keeps the sections it knew when reading the homepage again fails", async () => {
    vi.useFakeTimers();
    homepage.mockResolvedValueOnce(HOME);
    expect((await homepagePresence()).products.size).toBeGreaterThan(0);
    homepage.mockRejectedValueOnce(new Error("502 Bad Gateway"));
    vi.advanceTimersByTime(61_000);
    await homepagePresence();
    await vi.advanceTimersByTimeAsync(0);
    const after = await homepagePresence();
    expect(homepage).toHaveBeenCalledTimes(2);
    expect(after.products.get(3)).toHaveLength(1);
    expect(after.terms.get("category:11")).toHaveLength(1);
  });

  it("gives no sections, never an error, when the homepage cannot be read — and does not ask again at once", async () => {
    homepage.mockRejectedValue(new Error("Il sito non risponde"));
    const presence = await homepagePresence();
    expect(presence.terms.size).toBe(0);
    expect(presence.products.size).toBe(0);
    await homepagePresence();
    expect(homepage).toHaveBeenCalledTimes(1);
  });

  it("does not wait long for a slow site: the answer goes without sections, the next one has them", async () => {
    vi.useFakeTimers();
    homepage.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(HOME), 5_000)));
    const first = homepagePresence();
    await vi.advanceTimersByTimeAsync(2_500);
    expect((await first).products.size).toBe(0);
    await vi.advanceTimersByTimeAsync(2_500);
    expect((await homepagePresence()).products.size).toBeGreaterThan(0);
    expect(homepage).toHaveBeenCalledTimes(1);
  });

  it("after a minute, answers with what it knows while the homepage is read again", async () => {
    vi.useFakeTimers();
    homepage.mockResolvedValueOnce(HOME);
    expect((await homepagePresence()).products.size).toBeGreaterThan(0);
    homepage.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ ...HOME, blocks: [] }), 5_000)),
    );
    vi.advanceTimersByTime(61_000);
    // The new read is slow: the sections known so far, at once…
    expect((await homepagePresence()).products.size).toBeGreaterThan(0);
    // …until it is done.
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await homepagePresence()).products.size).toBe(0);
    expect(homepage).toHaveBeenCalledTimes(2);
  });
});
