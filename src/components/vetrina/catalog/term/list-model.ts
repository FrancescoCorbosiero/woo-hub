import {
  CATALOG_PAGE_MAX,
  CATALOG_PAGE_SIZE,
  QUICK_VIEWS,
  type CatalogPage,
  type CatalogProduct,
  type CatalogQuery,
  type CatalogTaxonomy,
  type CatalogTermDetail,
  type FacetCount,
  type QuickView,
} from "@/lib/vetrina/catalog";

/**
 * The catalog list's pure parts: routes, the chips as a query, and how pages
 * of products join up. The screens and hooks next to this file use them;
 * keeping them free of React keeps them testable.
 */

export const CATALOG_HOME = "/vetrina/catalogo";

const TERM_SEGMENT: Record<CatalogTaxonomy, string> = { category: "categoria", brand: "brand" };

export function termHref(taxonomy: CatalogTaxonomy, id: number): string {
  return `${CATALOG_HOME}/${TERM_SEGMENT[taxonomy]}/${id}`;
}

export function searchHref(q: string): string {
  return `${CATALOG_HOME}?q=${encodeURIComponent(q)}`;
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

/** Where a term's back button goes: its parent's screen, or the catalog's home. */
export function backTarget(detail: Pick<CatalogTermDetail, "term" | "ancestors">): { href: string; name: string | null } {
  const parent = detail.ancestors.at(-1);
  return parent ? { href: termHref(detail.term.taxonomy, parent.id), name: parent.name } : { href: CATALOG_HOME, name: null };
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

export function filterQuery(f: ListFilter): Pick<CatalogQuery, "stock" | "visibility" | "onSale" | "within"> {
  const out: Pick<CatalogQuery, "stock" | "visibility" | "onSale" | "within"> = {};
  if (f.status === "instock" || f.status === "outofstock") out.stock = f.status;
  if (f.status === "hidden") out.visibility = "hidden";
  if (f.status === "onsale") out.onSale = true;
  if (f.within) out.within = f.within.id;
  return out;
}

/** What a status chip would show: facets are counted before the chips narrow the list. */
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
