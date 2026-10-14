import type { CatalogQuery, CatalogTaxonomy } from "./catalog";

/**
 * The Vetrina catalog's actions on products, as the screens use them: hide and
 * show, a sale and its end, tags, categories, a place on the homepage. Each
 * runs on the server in the background, one at a time, and keeps what it
 * changed so it can be undone (src/server/vetrina/operations/ builds these).
 * Client components import only these types.
 */

/** What an action acts on: these products, or every product a catalog query matches when it runs. */
export type OperationTarget =
  | { kind: "ids"; ids: number[] }
  | { kind: "query"; query: CatalogQuery };

/** A whole category's or brand's products ("category:12", "brand:7"): what a term-wide action is filed under. */
export type TermKey = `${"category" | "brand"}:${number}`;

export const MAX_OPERATION_PRODUCTS = 2000;

/** How long a finished action can be undone ("Annulla"). A category or brand hidden by one stays undoable while it is hidden: "Mostra" undoes it. */
export const OPERATION_UNDO_DAYS = 7;

/** How a sale price is rounded: down to ,99 (from 10 € up), or to the cent. */
export type SaleRounding = "charm" | "exact";

export type OperationInput =
  | { kind: "hide"; target: OperationTarget; termKey?: TermKey }
  | {
      kind: "show";
      target: OperationTarget;
      /**
       * Optional (added in phase 3): leave hidden what the standing hide of a
       * whole category or brand holds — a term panel's "Mostra i N nascosti"
       * shows only the products hidden one by one; the others come back with
       * their own term's "Mostra".
       */
      keepHeld?: boolean;
    }
  | {
      kind: "sale";
      target: OperationTarget;
      /** Off the regular price, 1-90. */
      percent: number;
      rounding: SaleRounding;
      /** The last day of the sale (YYYY-MM-DD, the shop's time zone), or none. */
      endsOn: string | null;
      termKey?: TermKey;
    }
  | {
      kind: "unsale";
      target: OperationTarget;
      /** Optional (added in phase 3): the whole term's sale ends — filed under it, so its screen no longer shows the sale. */
      termKey?: TermKey;
    }
  | { kind: "tag"; target: OperationTarget; tag: { id?: number; name: string } }
  | { kind: "untag"; target: OperationTarget; tagId: number }
  | { kind: "categorize"; target: OperationTarget; categoryId: number }
  | { kind: "uncategorize"; target: OperationTarget; categoryId: number }
  /** First in a homepage section, in the order given; a manual category's section also takes the category. */
  | { kind: "pin"; target: OperationTarget; sectionKey: string };

export type OperationKind = OperationInput["kind"];

/** What an action would do, before it runs — named products, not just numbers. */
export interface OperationPreview {
  kind: OperationKind;
  /** Products it would change. */
  changes: number;
  /** Products it leaves as they are, by reason ("già nascosti", "senza prezzo", "non sono in questa sezione"). */
  untouched: { reason: string; count: number }[];
  /** The first products it would change, before → after in words ("€ 129 → € 102,99"). */
  sample: { id: number; name: string; before: string; after: string }[];
  /** What the owner should know before saying yes ("12 sono anche in Nike: spariscono anche lì"). */
  warnings: string[];
  /**
   * Optional (added in phase 3). A sale's or a sale's end's preview reads the
   * sizes of only the first products live: how many it read. With fewer than
   * the products it would act on, `changes` and `untouched` are an estimate;
   * the run counts exactly.
   */
  sampled?: number;
}

export type OperationStatus = "running" | "done" | "failed" | "undoing" | "undone";

export interface OperationView {
  id: string;
  kind: OperationKind;
  /** In the owner's words: "Saldo −20% · Saldi outlet", "12 prodotti nascosti". */
  label: string;
  status: OperationStatus;
  progress: { done: number; total: number };
  /** Products changed, and refused by the store. */
  changed: number;
  failed: number;
  error: string | null;
  termKey: TermKey | null;
  createdAt: string;
  finishedAt: string | null;
  /**
   * Done — or stopped part-way after changing some products — not undone yet,
   * and recent enough (OPERATION_UNDO_DAYS; a standing hide of a whole term
   * stays undoable while it stands).
   */
  undoable: boolean;
  undoneAt: string | null;
  /** Optional (added in phase 3): waiting for the action before it to finish (status "running", or "undoing" for its undo). */
  queued?: boolean;
  /**
   * Optional (added in phase 3): how its undo went, once one ran — products
   * put back, products left alone because they changed since the action (the
   * owner's newer word stands), products the store refused. A product partly
   * put back counts in each that applies. `held` (optional): products an
   * undone hide left hidden because another whole category or brand hidden
   * by the owner still holds them — that one's "Mostra" brings them back.
   */
  undo?: { restored: number; kept: number; failed: number; held?: number } | null;
}

/** A term's state for its screen: hidden by an action, and the sale running on it. */
export interface TermActionsState {
  /** The action that hid the term's products, while it stands — "Mostra" undoes exactly it. */
  hiddenBy: OperationView | null;
  /**
   * The sale started on the term, while it stands. Optional fields (added in
   * phase 3): `rounding`, as it was asked (so "Cambia lo sconto" keeps it);
   * `replaces`, the percent of the term's sale it took the place of, when
   * one stands under it (undoing this one brings that one's prices back).
   */
  sale: {
    percent: number;
    endsOn: string | null;
    operation: OperationView;
    rounding?: SaleRounding;
    replaces?: number | null;
  } | null;
  /**
   * Optional (added in phase 3): the term's products and how many of them
   * are hidden, read with the rest — the switch decides from these, not from
   * counts the screen read before the last action ended. Optional fields:
   * `held`, of the hidden, those the standing hide of another whole category
   * or brand holds, by that term's name (its "Mostra" brings them back, not
   * this term's); `ownSale`, the products on sale on their own — on sale,
   * and not by the term's standing sale.
   */
  counts?: { count: number; hidden: number; held?: { term: string; count: number }[]; ownSale?: number };
}

/**
 * A homepage section as the "Metti in homepage" sheet lists it (added in
 * phase 3). What fills it decides what pinning a product does there:
 * - "category": one manual category — a product not in it is added to it, then pinned;
 * - "automatic": one automatic category — its rule decides who is in it: only its products can be pinned;
 * - "brand": one brand — only its products can be pinned;
 * - "other": tags, several terms — only the products it already holds can be pinned.
 */
export interface HomepageSectionOption {
  key: string;
  title: string;
  fill: "category" | "automatic" | "brand" | "other";
  /** The category or brand it shows, when it shows exactly one. */
  term: { taxonomy: CatalogTaxonomy; id: number; name: string } | null;
  /** Products pinned there now. */
  pinned: number;
  /** False for a section showing a hand-picked list, or whose pins the Hub's config does not let the owner change. */
  pinnable: boolean;
  /**
   * Optional (added in phase 3), when the sections are listed for some
   * products: how many of them pinning there would place (a manual
   * category's section takes them all; any other only its own).
   */
  takes?: number;
}
