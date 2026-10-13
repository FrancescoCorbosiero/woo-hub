import type { CatalogQuery } from "./catalog";

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

/** How a sale price is rounded: down to ,99 (from 10 € up), or to the cent. */
export type SaleRounding = "charm" | "exact";

export type OperationInput =
  | { kind: "hide"; target: OperationTarget; termKey?: TermKey }
  | { kind: "show"; target: OperationTarget }
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
  | { kind: "unsale"; target: OperationTarget }
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
  /** Done, not undone yet, and recent enough. */
  undoable: boolean;
  undoneAt: string | null;
}

/** A term's state for its screen: hidden by an action, and the sale running on it. */
export interface TermActionsState {
  /** The action that hid the term's products, while it stands — "Mostra" undoes exactly it. */
  hiddenBy: OperationView | null;
  /** The sale started on the term, while it stands. */
  sale: { percent: number; endsOn: string | null; operation: OperationView } | null;
}
