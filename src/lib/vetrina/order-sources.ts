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

/** One product of a source, in its place: its SKU (the maker's style code), its name, or both — and its price there, when the list gives one. */
export interface OrderSourceItem {
  sku: string | null;
  name: string | null;
  /** The price the other site shows (its cheapest size's), in the shop's currency; absent in older sources. */
  price?: number | null;
}

/**
 * A source's items paired by hand (the comparison, docs/order-sources.md):
 * the shop's product an item is — or null, "none of the shop's" — by the
 * item's key ("sku:DD1391100", or "name:nike dunk low panda" for an item
 * with no SKU), so a pairing outlives the list's next upload, wherever the
 * item stands in it. The matcher's own answer is used for the rest.
 */
export type SourcePairs = Record<string, number | null>;

/** Above this difference (%) a price is said to differ: not the cents. */
export const PRICE_GAP_PERCENT = 2;

/** One item of a source against the shop: what the comparison shows. */
export interface ComparedItem {
  /** 1-based, in the source's order. */
  position: number;
  sku: string | null;
  name: string | null;
  /** The other site's price. */
  price: number | null;
  /** matched: a product of the shop; ambiguous: several could be it; missing: none. */
  status: "matched" | "ambiguous" | "missing";
  /** Paired by hand. */
  paired: boolean;
  product: { id: number; sku: string; name: string; price: number | null; onSale: boolean; status: string } | null;
  /** The shop's price against the other site's, %: positive when the shop asks more. */
  gap: number | null;
  /** Beyond the threshold. */
  differs: boolean;
  /** For an ambiguous or missing item: the shop's products whose names come closest, to pair by hand. */
  candidates: { id: number; sku: string; name: string }[];
  /** A missing item the Hub's catalog has (KicksDB verified): Publish can make it. */
  inCatalog: boolean;
}

/** A source against the shop, item by item: matched, prices compared, missing, uncertain. */
export interface SourceComparison {
  source: { id: string; name: string; origin: string | null };
  /** The threshold the prices are compared with, %. */
  threshold: number;
  items: ComparedItem[];
  summary: {
    items: number;
    matched: number;
    /** Matched, both prices known, differing beyond the threshold. */
    differ: number;
    /** Of those, the shop asking more. */
    dearer: number;
    cheaper: number;
    missing: number;
    /** Of the missing, those the Hub's catalog has. */
    importable: number;
    ambiguous: number;
  };
}

/** The products KicksDB has for one item of a source (the comparison's "Cerca"): closest first. */
export interface SourceLookup {
  position: number;
  name: string | null;
  sku: string | null;
  matches: {
    sku: string;
    title: string;
    brand: string;
    image: string;
    /** The words the names share over all their words, 0–1 (1: found by its SKU). */
    score: number;
    /** The Hub's catalog has it already. */
    inCatalog: boolean;
  }[];
  /** KicksDB did not answer, in the owner's words. */
  error: string | null;
}

/** An import of a source's missing products: what Publish made (or, on a dry run, would make), and what it could not. */
export interface SourceImport {
  dryRun: boolean;
  products: {
    sku: string;
    title: string;
    /** create: made; complete: given its sizes; reimport: made again; skip: left as it is (`reason`). */
    action: "create" | "reimport" | "complete" | "skip";
    productId: number | null;
    permalink: string | null;
    sizes: number;
    reason: "alreadyOnStore" | "feedDelisted" | "inProgress" | "hiddenNoPhoto" | null;
    error: string | null;
  }[];
  created: number;
  skipped: number;
  failed: number;
  /** SKUs KicksDB has no product for: never published. */
  notFound: string[];
  /** SKUs KicksDB did not answer for: try again. */
  unreachable: string[];
  /** KicksDB is configured (without it, only what the Hub's catalog has is imported). */
  kicksdb: boolean;
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
