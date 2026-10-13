import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import { railKeyToParam } from "@/lib/vetrina/order";
import type { RailSummary } from "@/lib/vetrina/types";
import { termHref } from "../term/list-model";

/**
 * The links between the homepage and the catalog: from a product's sheet to
 * its categories, brands and sections, and from a section to its term.
 */

/** The store taxonomies a section can show, as the catalog names them. */
const RAIL_TAXONOMIES = new Map<string, CatalogTaxonomy>([
  ["product_cat", "category"],
  ["product_brand", "brand"],
]);

/** The section editor for a homepage section. */
export function sectionHref(key: string): string {
  return `/vetrina/sezione/${railKeyToParam(key)}`;
}

/**
 * The catalog screen of the one category or brand a section shows. A section
 * showing several terms, none, or tags has no single place to open: null.
 */
export function railCatalogHref(rail: Pick<RailSummary, "taxonomy" | "terms">): string | null {
  const taxonomy = rail.taxonomy ? RAIL_TAXONOMIES.get(rail.taxonomy) : undefined;
  return taxonomy && rail.terms.length === 1 ? termHref(taxonomy, rail.terms[0].id) : null;
}
