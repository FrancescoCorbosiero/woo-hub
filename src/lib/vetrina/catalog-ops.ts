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

/**
 * A whole category's or brand's own hide or sale takes all of its products,
 * however many: it cannot be narrowed (a part would read as the whole), and
 * the runner works through it in chunks, one action at a time. The store
 * index's own ceiling (a full read stops at 50 000).
 */
export const MAX_TERM_PRODUCTS = 50_000;

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
      /**
       * Optional: put each product back as it was before its hide — "only in
       * search", "only in the catalog" included — rather than visible
       * everywhere. The product sheet's switch turned back on.
       */
      restore?: boolean;
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
  | { kind: "pin"; target: OperationTarget; sectionKey: string }
  /**
   * Added in phase 4: "Cambia il ricarico" — the margin the Hub's engine
   * prices a whole category's or brand's products with (its sub-terms'
   * included), as a pricing rule scoped to the store term; then those
   * products repriced through the ordinary sync. It acts on the products the
   * Hub prices from the market (KicksDB) only: a supplier's price
   * (GoldenSneakers) passes through untouched, a store-only product has no
   * Hub price. No target: a margin is the whole term's, by definition.
   */
  | {
      kind: "margin";
      taxonomy: CatalogTaxonomy;
      termId: number;
      /** The term's margin on the market price, MARGIN_PERCENT_MIN-MAX %; null hands the term back to the standard margin. */
      percent: number | null;
    }
  /**
   * "Ordina": these products, in the order given, at a place in a category's
   * or a brand's own order — the shop's order (WooCommerce's menu_order, then
   * the name), which the storefront's category and brand pages follow. One
   * number per product, shared by all its categories: the plan rewrites only
   * the products it must (src/server/vetrina/operations/order-plan.ts).
   */
  | {
      kind: "order";
      target: OperationTarget;
      term: { taxonomy: CatalogTaxonomy; id: number };
      /** Where the first of them lands, 1-based among the term's other products; null = after all of them. */
      position: number | null;
      /**
       * The rows of "Riordina" (dragged), down to the last that moved, at the
       * top: the log says how many moved, not that they all went to the top.
       */
      reorder?: true;
    }
  /**
   * "Usa l'ordine di «X»": the products an order source ranks (its items
   * matched to the shop's products when it runs), in its order, first in a
   * category's or a brand's order — or in the whole catalog's (term null) —
   * and the others after them, in their order. The same numbers as "Ordina",
   * written the same way (the fewest that must change), undone the same way.
   */
  | {
      kind: "sourceOrder";
      sourceId: string;
      term: { taxonomy: CatalogTaxonomy; id: number } | null;
    };

export type OperationKind = OperationInput["kind"];

/** A term's margin, as the owner sets it: a percent on the market price. */
export const MARGIN_PERCENT_MIN = 0;
export const MARGIN_PERCENT_MAX = 200;

/**
 * A margin as a rule states it (added in phase 4): a percent on the market
 * price, bands by price (the house default), or a fixed amount in euros.
 * Only "percent" is set from the Vetrina; the other two come from the Hub's
 * Margins tab and are shown as they are.
 */
export type MarginValue = { kind: "percent"; percent: number } | { kind: "bands" } | { kind: "fixed"; amount: number };

/** A category's or brand's margin, for its screen's "Ricarico" row and the margin sheet (added in phase 4). */
export interface TermMarginState {
  /** The term's own margin — its rule, while enabled — or null: it follows the standard, or a term above it. */
  own: MarginValue | null;
  /**
   * The margin of the nearest term above it that has one ("Nike" for "Nike ›
   * Off-White"): what it follows without its own, and goes back to when its
   * own is removed.
   */
  inherited: { term: string; value: MarginValue } | null;
  /** The shop's standard margin (the Hub's general rule); null when it has none. */
  standard: MarginValue | null;
  /** The term's products the Hub prices from the market (KicksDB): all a margin here can act on. */
  priced: number;
  /**
   * Of those, the ones the term's margin decides — its own, or the one it
   * would get — where no more specific rule takes them (a SKU's, a deeper
   * category's or brand's).
   */
  applies: number;
  /**
   * Of `applies`, the ones another of the Hub's rules prices without the
   * term's own margin — a catalog brand's or family's, the other store
   * taxonomy's — rather than the standard or a term above it: then "now"
   * and "back" are the Hub's rules, not the standard.
   */
  hubRules: number;
  /** The term's products the supplier's feed prices (GoldenSneakers): never touched by a margin here. */
  supplier: number;
  /** The term's products the Hub does not price at all (store-only). */
  storeOnly: number;
}

/**
 * A margin's preview (added in phase 4), beside the shape every action
 * shares: before → after is what the store shows now (the engine's price
 * where the Hub's copy of the shop lacks the size) → the engine's price
 * under the draft, moved only as the sync's plan would move it.
 */
export interface MarginPreview {
  /** The margin asked; null = back to the standard. */
  percent: number | null;
  /** The term's margin now. */
  current: TermMarginState;
  /** Products the margin decides (the button's "Applica a N prodotti"). */
  applies: number;
  /** Of those, by how their prices move (sizes with a locked price, or on sale, left out). */
  up: number;
  down: number;
  same: number;
  /** The average change of their prices, in percent (+8.2, −3); null when no price can be compared. */
  averageChange: number | null;
  /** Sizes with a locked price among them: they keep it. */
  lockedSizes: number;
  /** Sizes on sale among them (their product follows the sale rule): their regular price follows the margin once the sale ends. */
  saleSizes: number;
}

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
  /** Optional (added in phase 4): a margin's own numbers; absent when the margin cannot be applied (a refusal leads the warnings). */
  margin?: MarginPreview;
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
   * by the owner still holds them — that one's "Mostra" brings them back;
   * `heldBy` (optional): those terms' names, the most first.
   */
  undo?: { restored: number; kept: number; failed: number; held?: number; heldBy?: string[] } | null;
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
    /** The last day of the term's sale it took the place of (null: none), when one stands under it. */
    replacesEndsOn?: string | null;
  } | null;
  /**
   * Optional (added in phase 3): the term's products and how many of them
   * are hidden, read with the rest — the switch decides from these, not from
   * counts the screen read before the last action ended. Optional fields:
   * `held`, of the hidden, those the standing hide of another whole category
   * or brand holds, by that term's name (its "Mostra" brings them back, not
   * this term's); `ownSale`, the products on sale on their own — on sale,
   * and not by the term's standing sale; `addedSince`, under the term's own
   * hide, the products that joined the term after it and are still listed
   * (they are hidden with it shortly, or at once from the panel).
   */
  counts?: {
    count: number;
    hidden: number;
    held?: { term: string; count: number }[];
    ownSale?: number;
    addedSince?: number;
  };
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
