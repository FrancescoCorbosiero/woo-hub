import { railTaxonomy } from "@/lib/vetrina/catalog";
import { railKeyToParam } from "@/lib/vetrina/order";
import type { RailSummary } from "@/lib/vetrina/types";
import { termHref } from "../term/list-model";

/**
 * The links between the homepage and the catalog: from a product's sheet to
 * its categories, brands and sections, and from a section to its term.
 */

/** The section editor for a homepage section. */
export function sectionHref(key: string): string {
  return `/vetrina/sezione/${railKeyToParam(key)}`;
}

/**
 * The catalog screen of the one category or brand a section shows. A section
 * showing several terms, none, or tags has no single place to open: null.
 */
export function railCatalogHref(rail: Pick<RailSummary, "taxonomy" | "terms">): string | null {
  const taxonomy = railTaxonomy(rail.taxonomy);
  return taxonomy && rail.terms.length === 1 ? termHref(taxonomy, rail.terms[0].id) : null;
}
