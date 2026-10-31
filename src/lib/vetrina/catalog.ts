import type { RailCollection } from "@/lib/collections/types";
import type { ProductCard } from "./types";

/**
 * The Vetrina's catalog as its screens use it: the shop by category and brand,
 * read from the store index (src/server/vetrina/catalog.ts builds these).
 * Client components import only these types.
 */

export type CatalogTaxonomy = "category" | "brand";

/** Lists that cut across categories and brands. */
export const QUICK_VIEWS = ["soldout", "onsale", "hidden", "nophoto", "nocategory", "unpublished"] as const;
export type QuickView = (typeof QUICK_VIEWS)[number];

/**
 * Where a product comes from, as the owner tells them apart — each with its
 * colour — and as "Elimina" decides (src/server/vetrina/sources.ts):
 *
 * - goldensneakers: the supplier's feed carries it now. The feed decides what
 *   is in the shop and would put it back: "Elimina" refuses it.
 * - kicksdb: added from the Hub, priced from the market (StockX, by KicksDB).
 * - delisted: the feed carried it and no longer does; the sync keeps it sold
 *   out ("Ex GS").
 * - woo: made in the shop (WordPress), with no source behind it.
 */
export const PRODUCT_SOURCES = ["goldensneakers", "kicksdb", "delisted", "woo"] as const;
export type ProductSource = (typeof PRODUCT_SOURCES)[number];

/** "Elimina" takes it: every product but the supplier's feed's, which the feed would put back. */
export function isDeletable(source: ProductSource): boolean {
  return source !== "goldensneakers";
}

/** A homepage section, by its stable key (lib/vetrina/order.ts) and its title. */
export interface SectionRef {
  key: string;
  title: string;
}

/** A category or a brand, with what the catalog says about it. */
export interface CatalogTerm {
  taxonomy: CatalogTaxonomy;
  id: number;
  name: string;
  slug: string;
  /** 0 at the top level. */
  parent: number;
  /** With its parents' names: "Saldi › Nike". */
  path: string;
  /** Direct sub-terms, by id. */
  children: number[];
  /** Products in it or in a sub-term — every status but the bin — and, of those: */
  count: number;
  soldOut: number;
  hidden: number;
  onSale: number;
  /** The homepage sections showing exactly this term. */
  sections: SectionRef[];
  /** Its automatic category's rule, when it has one (categories only). */
  automatic: RailCollection | null;
}

export interface CatalogOverview {
  categories: CatalogTerm[];
  brands: CatalogTerm[];
  views: { view: QuickView; count: number }[];
  /** Products the store index holds; 0 while it is read for the first time. */
  indexProducts: number;
  /** Running on the Vetrina's demo shop (VETRINA_SOURCE=fixture). */
  demo: boolean;
}

export interface CatalogTermDetail {
  term: CatalogTerm;
  /** From the top level down to its parent. */
  ancestors: { id: number; name: string }[];
  children: CatalogTerm[];
  demo: boolean;
}

/** Where a product shows on the homepage now. */
export interface ProductSection extends SectionRef {
  /** 1-based slot among what the section shows. */
  position: number;
  pinned: boolean;
}

/** A product as a catalog list shows it. */
export interface CatalogProduct {
  id: number;
  sku: string;
  name: string;
  /** publish | draft | pending | private */
  status: string;
  /** visible | catalog | search | hidden */
  visibility: string;
  /** instock | outofstock | onbackorder */
  stockStatus: string;
  /** The current shelf price (the lowest, with sizes). */
  price: number | null;
  onSale: boolean;
  permalink: string;
  menuOrder: number;
  totalSales: number;
  dateCreated: string | null;
  categories: { id: number; name: string }[];
  brands: { id: number; name: string }[];
  tags: { id: number; name: string }[];
  /** It has a photo on the store. The thumbnail itself comes from the product card. */
  hasImage: boolean;
  /** Sizes with a price locked in the Hub. */
  locks: number;
  /** The homepage sections showing it in their visible slots. */
  sections: ProductSection[];
  /** Where it comes from (its colour on the row). Optional (added with the sources): absent shows none. */
  source?: ProductSource;
}

export const CATALOG_SORTS = ["shop", "newest", "bestselling", "priceAsc", "priceDesc", "name"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export const CATALOG_PAGE_SIZE = 40;
export const CATALOG_PAGE_MAX = 100;

export interface CatalogQuery {
  /** A term's products, its sub-terms' included. */
  taxonomy?: CatalogTaxonomy;
  termId?: number;
  view?: QuickView;
  /** Name or SKU, case-insensitive. */
  q?: string;
  stock?: "instock" | "outofstock";
  visibility?: "visible" | "hidden";
  onSale?: boolean;
  /** A term of the OTHER taxonomy: the brands inside a category, the categories inside a brand. */
  within?: number;
  /** Only the products from this source. */
  source?: ProductSource;
  sort?: CatalogSort;
  offset?: number;
  /** CATALOG_PAGE_SIZE by default, at most CATALOG_PAGE_MAX. */
  limit?: number;
}

export interface FacetCount {
  id: number;
  name: string;
  count: number;
}

export interface CatalogPage {
  products: CatalogProduct[];
  /** Products matching the query, not only this page. */
  total: number;
  offset: number;
  /**
   * The chips' counts: each one's number is what tapping it shows, the other
   * chips staying as they are. So the stock / visibility / sale counts take in
   * `within` and `source` but not themselves, the `within` counts take in
   * stock / visibility / sale and `source` but not `within`, the `sources`
   * take in the other two rows but not `source`, and `children` ignore every
   * chip.
   */
  facets: {
    instock: number;
    outofstock: number;
    hidden: number;
    onSale: number;
    /** Products from each source. Optional (added with the sources): absent shows no row of sources. */
    sources?: Record<ProductSource, number>;
    /** The term's direct sub-terms that hold any of these products. */
    children: FacetCount[];
    /**
     * The other taxonomy's terms these products carry (brands in a category,
     * categories in a brand); the one chosen in `within` is always there, at
     * 0 when nothing carries it, so its chip keeps its name.
     */
    within: FacetCount[];
  };
}

export interface CatalogSearch {
  categories: CatalogTerm[];
  brands: CatalogTerm[];
  products: CatalogProduct[];
  /** Products matching, not only those returned. */
  totalProducts: number;
}

/** A product's place in the shop, for its sheet. */
export interface ProductPlacement {
  id: number;
  status: string;
  visibility: string;
  categories: { id: number; name: string; path: string; automatic: boolean }[];
  brands: { id: number; name: string }[];
  sections: ProductSection[];
  /**
   * The supplier's feed (GoldenSneakers) carries it: the sheet offers no
   * "Elimina", the feed would only put it back. Optional (added with
   * "Elimina"): absent reads as not.
   */
  fromFeed?: boolean;
  /** Where it comes from; `fromFeed` is its "goldensneakers". Optional (added with the sources). */
  source?: ProductSource;
}

const RAIL_TAXONOMIES = new Map<string, CatalogTaxonomy>([
  ["product_cat", "category"],
  ["product_brand", "brand"],
]);

/** The catalog's name for a homepage section's taxonomy; null for tags, or none. */
export function railTaxonomy(taxonomy: string | null | undefined): CatalogTaxonomy | null {
  return (taxonomy && RAIL_TAXONOMIES.get(taxonomy)) || null;
}

/** WooCommerce shows the product in the shop's listings and search. */
export function isListed(visibility: string): boolean {
  return visibility !== "hidden";
}

/**
 * A catalog row as a product card — what the product sheet and the section
 * editor take — for when the store's own card (with its thumbnail) has not
 * arrived.
 */
export function toProductCard(p: CatalogProduct): ProductCard {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    type: "",
    status: p.status,
    visibility: p.visibility,
    stockStatus: p.stockStatus,
    price: p.price,
    priceMax: null,
    onSale: p.onSale,
    image: "",
    permalink: p.permalink,
    editLink: "",
    created: p.dateCreated,
  };
}
