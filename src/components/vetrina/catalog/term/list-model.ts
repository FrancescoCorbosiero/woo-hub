import {
  CATALOG_PAGE_MAX,
  CATALOG_PAGE_SIZE,
  CATALOG_SORTS,
  QUICK_VIEWS,
  type CatalogPage,
  type CatalogProduct,
  type CatalogQuery,
  type CatalogSort,
  type CatalogTaxonomy,
  type CatalogTermDetail,
  type FacetCount,
  type QuickView,
} from "@/lib/vetrina/catalog";
import type { ActionKind } from "@/lib/vetrina/catalog-ops";

/**
 * The catalog's pure parts: routes, what a list keeps in its address, the
 * chips as a query, and how pages of products join up. The screens and hooks
 * use them; keeping them free of React keeps them testable.
 */

export const CATALOG_HOME = "/vetrina/catalogo";

/** The longest search the server takes. */
export const MAX_QUERY = 100;

const TERM_SEGMENT: Record<CatalogTaxonomy, string> = { category: "categoria", brand: "brand" };

export function termHref(taxonomy: CatalogTaxonomy, id: number): string {
  return `${CATALOG_HOME}/${TERM_SEGMENT[taxonomy]}/${id}`;
}

export function viewHref(view: QuickView): string {
  return `${CATALOG_HOME}/vista/${view}`;
}

export function searchHref(q: string): string {
  return `${CATALOG_HOME}?q=${encodeURIComponent(q)}`;
}

/** Words as they are searched: trimmed, and no longer than the server takes. */
export function searchWords(text: string): string {
  return text.trim().slice(0, MAX_QUERY).trim();
}

/** The same address with some parameters set (a value) or dropped (null or ""): "/vetrina/catalogo?tab=brand". */
export function withParams(href: string, patch: Record<string, string | null>): string {
  const url = new URL(href, "http://x");
  for (const [name, value] of Object.entries(patch)) {
    if (value) url.searchParams.set(name, value);
    else url.searchParams.delete(name);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** A page's searchParams, read like the browser's: the first value of a repeated one. */
export function paramReader(params: Record<string, string | string[] | undefined>): { get(name: string): string | null } {
  return {
    get: (name) => {
      const value = params[name];
      return (Array.isArray(value) ? value[0] : value) ?? null;
    },
  };
}

/** A term id from the URL: digits only, so "12abc" or "1e3" never reads as a number. */
export function parseTermId(param: string): number | null {
  if (!/^\d{1,10}$/.test(param)) return null;
  const id = Number(param);
  return id > 0 && Number.isSafeInteger(id) ? id : null;
}

export function parseQuickView(param: string): QuickView | null {
  return (QUICK_VIEWS as readonly string[]).includes(param) ? (param as QuickView) : null;
}

/**
 * Where a term's back button goes when there is no screen to go back to (a
 * link opened from outside, a reload): its parent, or the catalog's home on
 * the term's own list.
 */
export function backTarget(detail: Pick<CatalogTermDetail, "term" | "ancestors">): { href: string; name: string | null } {
  const parent = detail.ancestors.at(-1);
  if (parent) return { href: termHref(detail.term.taxonomy, parent.id), name: parent.name };
  return { href: detail.term.taxonomy === "brand" ? `${CATALOG_HOME}?tab=brand` : CATALOG_HOME, name: null };
}

/* ---------------------------------------------------------------- *
 * The chips
 * ---------------------------------------------------------------- */

/** One chip at a time: they are the owner's quick questions, not a query builder. */
export const STATUS_FILTERS = ["all", "instock", "outofstock", "hidden", "onsale"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export interface ListFilter {
  status: StatusFilter;
  /** A term of the other taxonomy, with its name: it stays on its chip even when a search leaves it out of the facets. */
  within: { id: number; name: string } | null;
}

export const NO_FILTER: ListFilter = { status: "all", within: null };

export function hasFilters(f: ListFilter): boolean {
  return f.status !== "all" || f.within != null;
}

export function filterQuery(f: {
  status: StatusFilter;
  within: { id: number; name?: string } | null;
}): Pick<CatalogQuery, "stock" | "visibility" | "onSale" | "within"> {
  const out: Pick<CatalogQuery, "stock" | "visibility" | "onSale" | "within"> = {};
  if (f.status === "instock" || f.status === "outofstock") out.stock = f.status;
  if (f.status === "hidden") out.visibility = "hidden";
  if (f.status === "onsale") out.onSale = true;
  if (f.within) out.within = f.within.id;
  return out;
}

/** What a status chip would show: its facet leaves its own choice out (see CatalogPage.facets). */
export function statusCount(status: StatusFilter, facets: CatalogPage["facets"]): number {
  switch (status) {
    case "all":
      return facets.instock + facets.outofstock;
    case "instock":
      return facets.instock;
    case "outofstock":
      return facets.outofstock;
    case "hidden":
      return facets.hidden;
    case "onsale":
      return facets.onSale;
  }
}

/** The "within" chips: the facets, plus the chosen term when a search has left it out (count 0). */
export function withinChips(facets: readonly FacetCount[], chosen: ListFilter["within"]): FacetCount[] {
  if (!chosen || facets.some((f) => f.id === chosen.id)) return [...facets];
  return [{ id: chosen.id, name: chosen.name, count: 0 }, ...facets];
}

/** A term's counts in words, the zeros left out: "12 esauriti · 3 nascosti". */
export function summaryParts(
  counts: { soldOut: number; hidden: number; onSale: number },
  words: { soldOut: (n: number) => string; hidden: (n: number) => string; onSale: (n: number) => string },
): string[] {
  const parts: string[] = [];
  if (counts.soldOut > 0) parts.push(words.soldOut(counts.soldOut));
  if (counts.hidden > 0) parts.push(words.hidden(counts.hidden));
  if (counts.onSale > 0) parts.push(words.onSale(counts.onSale));
  return parts;
}

/* ---------------------------------------------------------------- *
 * What a list keeps in its address
 * ---------------------------------------------------------------- */

/**
 * A list screen as the owner left it: the search, the chips, the order. It
 * lives in the address (?q=, ?filter=, ?within=, ?sort=), so going back to
 * the screen, the tab bar or a reload opens it the same.
 */
export interface ListState {
  q: string;
  status: StatusFilter;
  within: number | null;
  sort: CatalogSort;
}

export const DEFAULT_LIST: ListState = { q: "", status: "all", within: null, sort: "shop" };

const oneOf = <T extends string>(list: readonly T[], value: string | null): T | null =>
  value != null && (list as readonly string[]).includes(value) ? (value as T) : null;

/** The address's list state; anything unknown reads as the default. */
export function readListState(params: { get(name: string): string | null }): ListState {
  return {
    q: searchWords(params.get("q") ?? ""),
    status: oneOf(STATUS_FILTERS, params.get("filter")) ?? "all",
    within: parseTermId(params.get("within") ?? ""),
    sort: oneOf(CATALOG_SORTS, params.get("sort")) ?? "shop",
  };
}

/** The parameters for a state, for withParams: the defaults dropped, so an untouched list keeps a plain address. */
export function listParams(state: ListState): Record<string, string | null> {
  return {
    q: state.q || null,
    filter: state.status === "all" ? null : state.status,
    within: state.within != null ? String(state.within) : null,
    sort: state.sort === "shop" ? null : state.sort,
  };
}

export function sameList(a: ListState, b: ListState): boolean {
  const pa = listParams(a);
  const pb = listParams(b);
  return Object.keys(pa).every((name) => pa[name] === pb[name]);
}

/** What a list state asks the server, the screen's term or view aside. */
export function listQuery(state: ListState): Pick<CatalogQuery, "q" | "sort" | "stock" | "visibility" | "onSale" | "within"> {
  return {
    ...(state.q ? { q: state.q } : {}),
    sort: state.sort,
    ...filterQuery({ status: state.status, within: state.within != null ? { id: state.within } : null }),
  };
}

/* ---------------------------------------------------------------- *
 * Pages
 * ---------------------------------------------------------------- */

const KEY_FIELDS = ["taxonomy", "termId", "view", "q", "stock", "visibility", "onSale", "within", "sort"] as const;

/** Two queries asking for the same list have the same key, whatever their object's shape or paging. */
export function queryKey(q: CatalogQuery): string {
  return JSON.stringify(KEY_FIELDS.map((field) => q[field] ?? null));
}

/** The rows a list holds, and the query they answer. */
export interface Loaded {
  key: string;
  query: CatalogQuery;
  products: CatalogProduct[];
  total: number;
  facets: CatalogPage["facets"] | null;
}

export function fromPage(query: CatalogQuery, page: CatalogPage): Loaded {
  return { key: queryKey(query), query, products: page.products, total: page.total, facets: page.facets };
}

/**
 * The next page joined on. The index can change between two pages, so a
 * product already listed is not listed twice, and a page that brings nothing
 * new ends the list instead of asking for the same rows forever. The facets
 * stay page 1's: they describe the whole query, and the chips need not redraw.
 */
export function appendPage(prev: Loaded, page: CatalogPage): Loaded {
  const seen = new Set(prev.products.map((p) => p.id));
  const fresh = page.products.filter((p) => !seen.has(p.id));
  if (fresh.length === 0) return { ...prev, total: prev.products.length };
  const products = [...prev.products, ...fresh];
  return { ...prev, products, total: Math.max(page.total, products.length) };
}

/** The requests that read the first `count` rows again, each at most a full page. */
export function sliceRequests(count: number): { offset: number; limit: number }[] {
  const rows = Math.max(count, CATALOG_PAGE_SIZE);
  const out: { offset: number; limit: number }[] = [];
  for (let offset = 0; offset < rows; offset += CATALOG_PAGE_MAX) {
    out.push({ offset, limit: Math.min(CATALOG_PAGE_MAX, rows - offset) });
  }
  return out;
}

/** Those slices, back in one piece: the first one's counts, each product once. */
export function joinPages(query: CatalogQuery, pages: readonly CatalogPage[]): Loaded {
  const [first, ...rest] = pages;
  return rest.reduce((loaded, page) => appendPage(loaded, page), fromPage(query, first));
}

/**
 * Whether an action that ended moved the prices a list's rows take from the
 * store's cards — a sale, a sale's end, a category's or brand's margin — so
 * the list reads the cards again rather than show the old prices under the
 * toast that says they changed.
 */
export function movesRowPrices(kind: ActionKind): boolean {
  return kind === "sale" || kind === "unsale" || kind === "margin";
}
