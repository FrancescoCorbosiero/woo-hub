import type { OperationView, SaleRounding, TermActionsState } from "@/lib/vetrina/catalog-ops";

/**
 * A term's panel, its pure part: what "Visibile nel negozio" and "Saldo" show
 * from the term's counts and its standing actions (loadTermActions). No React
 * here, so the tests reach every case.
 */

/**
 * Of a term's hidden products, those the standing hide of another whole
 * category or brand holds — that one's "Mostra" brings them back, not this
 * term's: how many, and by which terms.
 */
export interface Held {
  count: number;
  terms: string[];
}

function heldOf(actions: TermActionsState): Held {
  const list = actions.counts?.held ?? [];
  return { count: list.reduce((sum, h) => sum + h.count, 0), terms: list.map((h) => h.term) };
}

/**
 * - loading: the term's actions are being read; the toggle guesses from the counts;
 * - visible: no hide of the whole term stands (some products may be hidden one by one, some held by another term's hide);
 * - allHidden: every product hidden, some one by one, by no hide of the term: turning it on shows those (not the held ones);
 * - held: every product hidden, all of them by other terms' hides: nothing to turn on here;
 * - hiding: the term's hide is running (or waiting its turn);
 * - hidden: the term's hide stands: turning it on undoes exactly it;
 * - showing: that undo is running.
 */
export type VisibilityState =
  | { kind: "loading"; on: boolean }
  | { kind: "visible"; hiddenHere: number; held: Held }
  | { kind: "allHidden"; hidden: number; held: Held }
  | { kind: "held"; held: Held }
  | { kind: "hiding"; view: OperationView }
  | { kind: "hidden"; view: OperationView }
  | { kind: "showing"; view: OperationView };

export function visibilityState(
  screen: { count: number; hidden: number },
  actions: TermActionsState | undefined,
): VisibilityState {
  // The counts read with the actions, when they came with them: the screen's
  // own may be from before the last action ended (a "Mostra" just done would
  // read as "all hidden" until the screen's next read).
  const counts = actions?.counts ?? screen;
  const allHidden = counts.count > 0 && counts.hidden >= counts.count;
  if (!actions) return { kind: "loading", on: !allHidden };
  const hide = actions.hiddenBy;
  if (hide) {
    if (hide.status === "running") return { kind: "hiding", view: hide };
    if (hide.status === "undoing") return { kind: "showing", view: hide };
    return { kind: "hidden", view: hide };
  }
  // Hidden one by one: what no other term's hide holds. Only those are this term's to show.
  const held = heldOf(actions);
  const free = Math.max(0, counts.hidden - held.count);
  if (!allHidden) return { kind: "visible", hiddenHere: free, held };
  return free > 0 ? { kind: "allHidden", hidden: free, held } : { kind: "held", held };
}

/** The toggle is on while the term's products show, or are being put back. */
export function toggleOn(state: VisibilityState): boolean {
  switch (state.kind) {
    case "loading":
      return state.on;
    case "visible":
    case "showing":
      return true;
    case "allHidden":
    case "held":
    case "hiding":
    case "hidden":
      return false;
  }
}

/**
 * - loading: being read (with the products on sale, for the words it will most likely show);
 * - none: no sale on the whole term (some products may be on sale on their own);
 * - busy: the term's sale is being applied, or undone from the log;
 * - on: it stands: change it, or end it.
 */
export type SaleState =
  | { kind: "loading"; onSale: number }
  | { kind: "none"; onSale: number }
  | { kind: "busy"; percent: number; view: OperationView }
  | {
      kind: "on";
      percent: number;
      endsOn: string | null;
      view: OperationView;
      /** As it was asked: a change keeps it. */
      rounding?: SaleRounding;
      /** The percent of the term's earlier sale this one replaced: undoing it brings that one back. */
      replaces?: number | null;
    };

export function saleState(counts: { onSale: number }, actions: TermActionsState | undefined): SaleState {
  if (!actions) return { kind: "loading", onSale: counts.onSale };
  const sale = actions.sale;
  // On sale on their own: the server's count leaves out what the term's own sale put on sale.
  if (!sale) return { kind: "none", onSale: actions.counts?.ownSale ?? counts.onSale };
  const { status } = sale.operation;
  if (status === "running" || status === "undoing") return { kind: "busy", percent: sale.percent, view: sale.operation };
  return {
    kind: "on",
    percent: sale.percent,
    endsOn: sale.endsOn,
    view: sale.operation,
    ...(sale.rounding ? { rounding: sale.rounding } : {}),
    ...(sale.replaces != null ? { replaces: sale.replaces } : {}),
  };
}

/** The panel's actions show when there is something to act on, or an action stands on the term. */
export function hasActions(counts: { count: number }, actions: TermActionsState | undefined): boolean {
  return counts.count > 0 || actions?.hiddenBy != null || actions?.sale != null;
}
