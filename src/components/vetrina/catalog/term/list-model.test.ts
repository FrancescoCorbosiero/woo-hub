import { describe, expect, it } from "vitest";
import type { CatalogPage, CatalogProduct } from "@/lib/vetrina/catalog";
import {
  appendPage,
  backTarget,
  DEFAULT_LIST,
  filterQuery,
  fromPage,
  hasFilters,
  joinPages,
  listParams,
  listQuery,
  NO_FILTER,
  paramReader,
  parseQuickView,
  parseTermId,
  queryKey,
  readListState,
  sameList,
  searchHref,
  searchWords,
  sliceRequests,
  statusCount,
  summaryParts,
  termHref,
  viewHref,
  withinChips,
  withParams,
} from "./list-model";

const product = (id: number): CatalogProduct => ({
  id,
  sku: `SKU-${id}`,
  name: `Product ${id}`,
  status: "publish",
  visibility: "visible",
  stockStatus: "instock",
  price: 100,
  onSale: false,
  permalink: "",
  menuOrder: 0,
  totalSales: 0,
  dateCreated: null,
  categories: [],
  brands: [],
  tags: [],
  hasImage: true,
  locks: 0,
  sections: [],
});

const facets = (instock = 0, outofstock = 0): CatalogPage["facets"] => ({
  instock,
  outofstock,
  hidden: 2,
  onSale: 3,
  children: [],
  within: [],
});

const page = (ids: number[], total: number, offset = 0): CatalogPage => ({
  products: ids.map(product),
  total,
  offset,
  facets: facets(total, 0),
});

describe("routes", () => {
  it("links terms, quick views and searches", () => {
    expect(termHref("category", 12)).toBe("/vetrina/catalogo/categoria/12");
    expect(termHref("brand", 7)).toBe("/vetrina/catalogo/brand/7");
    expect(viewHref("soldout")).toBe("/vetrina/catalogo/vista/soldout");
    expect(searchHref("dunk «low» & co")).toBe("/vetrina/catalogo?q=dunk%20%C2%ABlow%C2%BB%20%26%20co");
  });

  it("reads only plain positive ids", () => {
    expect(parseTermId("12")).toBe(12);
    for (const bad of ["0", "-3", "1e3", "12abc", "", " 12", "1.5", "99999999999"]) expect(parseTermId(bad)).toBeNull();
  });

  it("reads only the known quick views", () => {
    expect(parseQuickView("soldout")).toBe("soldout");
    expect(parseQuickView("SOLDOUT")).toBeNull();
    expect(parseQuickView("toString")).toBeNull();
  });

  it("goes back to the parent, or to the catalog's own list at the top level", () => {
    const term = { taxonomy: "brand" as const, id: 9 };
    expect(backTarget({ term: term as never, ancestors: [] })).toEqual({ href: "/vetrina/catalogo?tab=brand", name: null });
    expect(backTarget({ term: { taxonomy: "category", id: 9 } as never, ancestors: [] })).toEqual({
      href: "/vetrina/catalogo",
      name: null,
    });
    expect(
      backTarget({
        term: term as never,
        ancestors: [
          { id: 1, name: "Nike" },
          { id: 4, name: "Jordan" },
        ],
      }),
    ).toEqual({ href: "/vetrina/catalogo/brand/4", name: "Jordan" });
  });
});

describe("the list's address", () => {
  it("reads the defaults from a plain address, and from anything unknown", () => {
    expect(readListState(new URLSearchParams(""))).toEqual(DEFAULT_LIST);
    expect(readListState(new URLSearchParams("filter=cheap&sort=random&within=abc&q=%20%20"))).toEqual(DEFAULT_LIST);
  });

  it("reads a search, a chip, a term and an order, and writes them back the same", () => {
    const state = readListState(new URLSearchParams("q=%20dunk%20&filter=outofstock&within=12&sort=priceAsc"));
    expect(state).toEqual({ q: "dunk", status: "outofstock", within: 12, sort: "priceAsc" });
    expect(withParams("/vetrina/catalogo/categoria/3", listParams(state))).toBe(
      "/vetrina/catalogo/categoria/3?q=dunk&filter=outofstock&within=12&sort=priceAsc",
    );
    // Back to the defaults, back to a plain address.
    expect(withParams("/vetrina/catalogo/categoria/3?q=dunk&filter=outofstock", listParams(DEFAULT_LIST))).toBe(
      "/vetrina/catalogo/categoria/3",
    );
  });

  it("keeps a search no longer than the server takes", () => {
    expect(readListState(new URLSearchParams(`q=${"a".repeat(150)}`)).q).toHaveLength(100);
    expect(searchWords(`  ${"b".repeat(99)} c`)).toBe("b".repeat(99));
  });

  it("reads a page's searchParams like the browser's", () => {
    const params = paramReader({ q: ["dunk", "panda"], sort: "name", none: undefined });
    expect(params.get("q")).toBe("dunk");
    expect(params.get("sort")).toBe("name");
    expect(params.get("none")).toBeNull();
    expect(params.get("missing")).toBeNull();
  });

  it("turns into the server's query, and tells two lists apart", () => {
    expect(listQuery(DEFAULT_LIST)).toEqual({ sort: "shop" });
    expect(listQuery({ q: "dunk", status: "hidden", within: 4, sort: "name" })).toEqual({
      q: "dunk",
      sort: "name",
      visibility: "hidden",
      within: 4,
    });
    expect(sameList(DEFAULT_LIST, { ...DEFAULT_LIST })).toBe(true);
    expect(sameList(DEFAULT_LIST, { ...DEFAULT_LIST, within: 4 })).toBe(false);
  });
});

describe("chips", () => {
  it("turn into the query's narrowing fields", () => {
    expect(filterQuery(NO_FILTER)).toEqual({});
    expect(filterQuery({ status: "instock", within: null })).toEqual({ stock: "instock" });
    expect(filterQuery({ status: "outofstock", within: null })).toEqual({ stock: "outofstock" });
    expect(filterQuery({ status: "hidden", within: { id: 3, name: "Nike" } })).toEqual({ visibility: "hidden", within: 3 });
    expect(filterQuery({ status: "onsale", within: null })).toEqual({ onSale: true });
  });

  it("know when any is on", () => {
    expect(hasFilters(NO_FILTER)).toBe(false);
    expect(hasFilters({ status: "onsale", within: null })).toBe(true);
    expect(hasFilters({ status: "all", within: { id: 1, name: "Nike" } })).toBe(true);
  });

  it("count from the facets: all is in stock plus sold out", () => {
    const f = facets(41, 12);
    expect(statusCount("all", f)).toBe(53);
    expect(statusCount("instock", f)).toBe(41);
    expect(statusCount("outofstock", f)).toBe(12);
    expect(statusCount("hidden", f)).toBe(2);
    expect(statusCount("onsale", f)).toBe(3);
  });

  it("keep the chosen term on its chip when a search leaves it out", () => {
    const list = [{ id: 1, name: "Nike", count: 4 }];
    expect(withinChips(list, null)).toEqual(list);
    expect(withinChips(list, { id: 1, name: "Nike" })).toEqual(list);
    expect(withinChips(list, { id: 2, name: "Adidas" })).toEqual([{ id: 2, name: "Adidas", count: 0 }, ...list]);
  });
});

describe("summaryParts", () => {
  const words = { soldOut: (n: number) => `${n} sold`, hidden: (n: number) => `${n} hid`, onSale: (n: number) => `${n} sale` };

  it("leaves the zeros out", () => {
    expect(summaryParts({ soldOut: 12, hidden: 0, onSale: 41 }, words)).toEqual(["12 sold", "41 sale"]);
    expect(summaryParts({ soldOut: 0, hidden: 0, onSale: 0 }, words)).toEqual([]);
  });
});

describe("queryKey", () => {
  it("ignores the object's shape, the paging and the absent fields", () => {
    expect(queryKey({ taxonomy: "category", termId: 3, sort: "shop" })).toBe(
      queryKey({ sort: "shop", termId: 3, taxonomy: "category", q: undefined, offset: 80, limit: 100 }),
    );
  });

  it("tells different lists apart", () => {
    const base = { taxonomy: "category" as const, termId: 3 };
    const keys = [
      queryKey(base),
      queryKey({ ...base, q: "dunk" }),
      queryKey({ ...base, onSale: true }),
      queryKey({ ...base, onSale: false }),
      queryKey({ ...base, within: 4 }),
      queryKey({ ...base, sort: "name" }),
      queryKey({ taxonomy: "brand", termId: 3 }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("pages", () => {
  const query = { taxonomy: "category" as const, termId: 3 };

  it("join on in order, each product once", () => {
    const first = fromPage(query, page([1, 2, 3], 6));
    const next = appendPage(first, page([3, 4, 5], 6, 3));
    expect(next.products.map((p) => p.id)).toEqual([1, 2, 3, 4, 5]);
    expect(next.total).toBe(6);
    // Page 1's facets stay: they describe the whole query.
    expect(next.facets).toBe(first.facets);
  });

  it("end when a page brings nothing new, instead of asking again forever", () => {
    const first = fromPage(query, page([1, 2], 10));
    expect(appendPage(first, page([], 10, 2)).total).toBe(2);
    expect(appendPage(first, page([1, 2], 10, 2)).total).toBe(2);
  });

  it("never count fewer than the rows shown", () => {
    const first = fromPage(query, page([1, 2], 4));
    expect(appendPage(first, page([3], 2, 2)).total).toBe(3);
  });

  it("are read again in slices of at most 100, at least one page", () => {
    expect(sliceRequests(0)).toEqual([{ offset: 0, limit: 40 }]);
    expect(sliceRequests(40)).toEqual([{ offset: 0, limit: 40 }]);
    expect(sliceRequests(100)).toEqual([{ offset: 0, limit: 100 }]);
    expect(sliceRequests(240)).toEqual([
      { offset: 0, limit: 100 },
      { offset: 100, limit: 100 },
      { offset: 200, limit: 40 },
    ]);
  });

  it("come back in one piece from their slices", () => {
    const joined = joinPages(query, [page([1, 2], 5), page([3, 4], 5, 2)]);
    expect(joined.products.map((p) => p.id)).toEqual([1, 2, 3, 4]);
    expect(joined.total).toBe(5);
    expect(joined.key).toBe(queryKey(query));
  });
});
