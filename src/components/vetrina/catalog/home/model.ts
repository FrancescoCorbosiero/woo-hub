import type { CatalogTaxonomy, CatalogTerm, QuickView } from "@/lib/vetrina/catalog";

/**
 * The catalog home's pure helpers: where a row leads, how the lists are
 * ordered and grouped, and what the address keeps (?q=, ?tab=brand,
 * ?sort=count). No React here, so the tests can reach every rule.
 */

export type HomeTab = CatalogTaxonomy;
export type TermOrder = "name" | "count";

/** The same order the server sorts names in: accent-blind, "Jordan 4" before "Jordan 11". */
const collator = new Intl.Collator("it", { sensitivity: "base", numeric: true });

const byName = (a: CatalogTerm, b: CatalogTerm) => collator.compare(a.name, b.name) || a.id - b.id;
const byCount = (a: CatalogTerm, b: CatalogTerm) => b.count - a.count || byName(a, b);

export function termHref(term: Pick<CatalogTerm, "taxonomy" | "id">): string {
  return `/vetrina/catalogo/${term.taxonomy === "brand" ? "brand" : "categoria"}/${term.id}`;
}

export function viewHref(view: QuickView): string {
  return `/vetrina/catalogo/vista/${view}`;
}

/** The address's state: which list, in which order, which search. Anything unknown reads as the default. */
export function readParams(params: { get(name: string): string | null }): { tab: HomeTab; order: TermOrder; q: string } {
  return {
    tab: params.get("tab") === "brand" ? "brand" : "category",
    order: params.get("sort") === "count" ? "count" : "name",
    q: params.get("q") ?? "",
  };
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

/**
 * The top-level terms in the order asked, the empty ones apart so the list
 * can fold them away. A term whose parent the store does not list already
 * arrives with parent 0, so it is never lost.
 */
export function topLevel(terms: readonly CatalogTerm[], order: TermOrder): { filled: CatalogTerm[]; empty: CatalogTerm[] } {
  const top = terms.filter((t) => t.parent === 0).sort(order === "count" ? byCount : byName);
  return { filled: top.filter((t) => t.count > 0), empty: top.filter((t) => t.count === 0) };
}

/** "12 esauriti · 3 nascosti": only the parts that are not zero; "" when all is well. */
export function statsLine(
  term: Pick<CatalogTerm, "soldOut" | "hidden">,
  words: { soldOut: (n: number) => string; hidden: (n: number) => string },
): string {
  const parts: string[] = [];
  if (term.soldOut > 0) parts.push(words.soldOut(term.soldOut));
  if (term.hidden > 0) parts.push(words.hidden(term.hidden));
  return parts.join(" · ");
}

/** The index letter of a name: "É" files under E, digits and symbols under "#". */
export function letterOf(name: string): string {
  const first = name.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : "#";
}

/** Terms under their index letter, A to Z, with "#" last as in the phone's contacts. */
export function byLetter(terms: readonly CatalogTerm[]): { letter: string; terms: CatalogTerm[] }[] {
  const groups = new Map<string, CatalogTerm[]>();
  for (const term of [...terms].sort(byName)) {
    const letter = letterOf(term.name);
    const group = groups.get(letter);
    if (group) group.push(term);
    else groups.set(letter, [term]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)))
    .map(([letter, list]) => ({ letter, terms: list }));
}
