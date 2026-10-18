/**
 * Order sources ("fonti d'ordine"): a ranking of the shop's products from
 * somewhere else — a reference shop's page, a marketplace's best sellers —
 * kept in the Hub so the owner can say "Usa l'ordine di «StockX»" on a
 * category, a brand or the whole catalog. A source is uploaded by hand (from
 * the Vetrina, or the API) in an agreed format that an LLM can write after
 * reading a web page: docs/order-sources.md. Client components import only
 * these types and constants.
 */

/** The agreed format's name, as a source file may state it ("format"). Older or missing: read the same way. */
export const ORDER_SOURCE_FORMAT = "woo-hub.order-source/1";

/** At most this many products in one source. */
export const MAX_SOURCE_ITEMS = 20_000;
/** At most this many sources. */
export const MAX_SOURCES = 50;
export const MAX_SOURCE_NAME = 80;

/** One product of a source, in its place: its SKU (the maker's style code), its name, or both. */
export interface OrderSourceItem {
  sku: string | null;
  name: string | null;
}

/** An item of a source that no product of the shop matched, at its place (1-based). */
export interface UnmatchedItem {
  position: number;
  sku: string | null;
  name: string | null;
  /** More than one product could be it (a name, not a SKU): none was taken. */
  ambiguous: boolean;
}

/** How a source reads against the shop now. */
export interface SourceMatchSummary {
  /** Items in the source. */
  items: number;
  /** Items a product of the shop matched. */
  matched: number;
  /** The first items no product matched. */
  unmatched: UnmatchedItem[];
  /** All the items no product matched (`unmatched` lists the first of them). */
  unmatchedCount: number;
}

/** A source as the lists show it. */
export interface OrderSourceSummary extends SourceMatchSummary {
  id: string;
  name: string;
  /** Where it comes from: a page's address, or words ("StockX, più venduti, ottobre"). */
  origin: string | null;
  updatedAt: string;
}

/** A source's text, read before it is saved: what it holds and how it matches the shop. */
export interface OrderSourceCheck extends SourceMatchSummary {
  /** The name and origin the text states, if any (a form takes them as defaults). */
  name: string | null;
  origin: string | null;
  /** Items left out because an earlier one is the same product. */
  duplicates: number;
  /** JSON answers read one after another and joined (1 for any other text). */
  parts: number;
  /** The last answer stops before its end — an LLM's length limit: read up to its last whole product. */
  truncated: boolean;
}

/** Why a source's text could not be read. */
export type SourceParseError = "empty" | "invalidJson" | "noItems" | "tooMany";

/**
 * A link to a shop's homepage — no path, or only a language ("/", "/it",
 * "/en-us") — rather than to one of its collections or categories: a shop's
 * order is read on those pages, not on its homepage.
 */
export function looksLikeHomepage(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const path = url.pathname.replace(/\/+$/, "");
  return path === "" || /^\/[a-z]{2}(-[a-z]{2})?$/i.test(path);
}
