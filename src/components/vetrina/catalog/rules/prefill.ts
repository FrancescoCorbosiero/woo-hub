import type { CollectionCondition } from "@core/collections";
import type { CatalogTaxonomy, ProductSource } from "@/lib/vetrina/catalog";
import { searchWords, type StatusFilter } from "../term/list-model";

/**
 * A catalog list's filters as an automatic category's rule, for "Salva come
 * categoria automatica": the term itself, the other taxonomy's chip, the
 * status chip and the search, each as the condition that says the same. No
 * React here, so the tests reach every rule.
 */

/** The rule editor takes at most this many conditions (server/actions/collections.ts). */
export const MAX_CONDITIONS = 20;

export interface ListFilters {
  /** The screen's own term: its products, sub-terms' included, as the rule's "category is" / "brand is" does. */
  term: { taxonomy: CatalogTaxonomy; id: number; path: string };
  status: StatusFilter;
  /** A term of the other taxonomy (the brand inside a category, the category inside a brand). */
  within: { id: number; name: string } | null;
  /** The words searched. */
  q: string;
  /** The "Provenienza" chip. */
  source?: ProductSource | null;
}

/** What could not go into the rule as it stands on the list. */
export type LeftOut = "hidden" | "search" | "source";

export interface RulePrefill {
  conditions: CollectionCondition[];
  /**
   * "hidden": no rule reads visibility. "search": the list also finds by SKU,
   * a rule reads names only. "source": a rule reads what the shop says of a
   * product, and where it comes from is the Hub's.
   */
  notes: LeftOut[];
}

const OTHER: Record<CatalogTaxonomy, CatalogTaxonomy> = { category: "brand", brand: "category" };

/**
 * The conditions matching the list, all of which must hold ("all"):
 * - the term: "category is X" / "brand is X" (both take in the sub-terms, as the list does);
 * - the other taxonomy's chip: the same, for that term;
 * - Disponibili / Esauriti: "available" / "sold out" (back-orderable counts as available on both sides);
 * - In saldo: "on sale";
 * - the search: one "name contains" per word, since the list finds the words in any order.
 * Nascosti has no condition: a rule does not read visibility, so it is left out and said; nor has
 * the source, the Hub's own knowledge of a product.
 */
export function ruleFromList(list: ListFilters): RulePrefill {
  const conditions: CollectionCondition[] = [
    { field: list.term.taxonomy, op: "is", value: String(list.term.id), label: list.term.path },
  ];
  const notes: LeftOut[] = [];

  if (list.within) {
    conditions.push({ field: OTHER[list.term.taxonomy], op: "is", value: String(list.within.id), label: list.within.name });
  }

  switch (list.status) {
    case "instock":
      conditions.push({ field: "inStock", op: "is", value: "" });
      break;
    case "outofstock":
      conditions.push({ field: "inStock", op: "isNot", value: "" });
      break;
    case "onsale":
      conditions.push({ field: "onSale", op: "is", value: "" });
      break;
    case "hidden":
      notes.push("hidden");
      break;
    case "all":
      break;
  }
  if (list.source) notes.push("source");

  const words = uniqueWords(searchWords(list.q));
  if (words.length > 0) {
    notes.push("search");
    for (const word of words.slice(0, MAX_CONDITIONS - conditions.length)) {
      conditions.push({ field: "title", op: "contains", value: word });
    }
  }

  return { conditions, notes };
}

/** "Dunk dunk Low" → ["Dunk", "Low"]: a word said twice is one condition. */
function uniqueWords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of text.split(/\s+/)) {
    const key = word.toLocaleLowerCase("it");
    if (!word || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}
