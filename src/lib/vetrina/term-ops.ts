/**
 * The store's own taxonomies, managed from the Hub: product categories,
 * brands and tags — a term made, renamed, moved under another, merged into
 * another, deleted — filed in the Vetrina's log with "Annulla", like the
 * catalog's, the homepage's and the menus' actions.
 *
 * Making, renaming and moving a term are one request each, done at once
 * (src/server/vetrina/operations/terms.ts). Merging and deleting touch every
 * product holding the term: they run in the background, product by product,
 * each product's terms filed for "Annulla" (operations/term-moves.ts), and
 * the term itself goes last, once no product holds it.
 *
 * A renamed or moved term, and a merged one, leaves an alias behind
 * (term_aliases): the products Publish files under the old name land in
 * the term as it is now, instead of a new term with the old name.
 *
 * Client components import only these types.
 */

/** product_cat, product_brand, product_tag. */
export type TermTaxonomy = "category" | "brand" | "tag";

export const TERM_TAXONOMIES = ["category", "brand", "tag"] as const satisfies readonly TermTaxonomy[];

/** Categories and brands have parents; tags are flat. */
export const termsNest = (taxonomy: TermTaxonomy): taxonomy is "category" | "brand" => taxonomy !== "tag";

/** The actions on a term done at once. */
export type TermActionInput =
  /** A new term, at the top or under a parent (categories and brands). */
  | { kind: "termCreate"; taxonomy: TermTaxonomy; name: string; parent?: number | null }
  /** A term's name; its slug — its address on the site — stays. */
  | { kind: "termRename"; taxonomy: TermTaxonomy; termId: number; name: string }
  /** A category or a brand under another (0: the top level), with its sub-terms. */
  | { kind: "termMove"; taxonomy: "category" | "brand"; termId: number; parent: number };

export type TermActionKind = TermActionInput["kind"];

export const TERM_ACTION_KINDS = ["termCreate", "termRename", "termMove"] as const satisfies readonly TermActionKind[];

const KINDS: ReadonlySet<string> = new Set(TERM_ACTION_KINDS);

/** A term action done at once (not a merge or a deletion, which run in the background). */
export function isTermActionKind(kind: string): kind is TermActionKind {
  return KINDS.has(kind);
}

/** A term as an action found it: enough to make it again. */
export interface TermSnapshot {
  id: number;
  name: string;
  slug: string;
  parent: number;
  description: string;
}

/**
 * A term action's way back, filed with it (vetrina_operations.term). A
 * merge's and a deletion's are filed as they run: `deleted` says whether the
 * term itself went (a run cut short leaves it, its products' moves undone
 * one by one all the same).
 */
export type OperationTermRecord =
  | { kind: "termCreate"; taxonomy: TermTaxonomy; term: { id: number; name: string; parent: number } }
  | { kind: "termRename"; taxonomy: TermTaxonomy; term: { id: number; parent: number }; before: string; after: string }
  | { kind: "termMove"; taxonomy: "category" | "brand"; term: { id: number; name: string }; before: number; after: number }
  | {
      kind: "termMerge" | "termDelete";
      taxonomy: TermTaxonomy;
      term: TermSnapshot;
      /** The term merged into (null: a deletion). */
      into: { id: number; name: string } | null;
      /** Its sub-terms, which went under `into` (a merge) or its parent (a deletion, WordPress's own way). */
      children: number[];
      deleted: boolean;
      /** Aliases that led to it, led to `into` since (a merge): put back on "Annulla". */
      aliases: number[];
    };
