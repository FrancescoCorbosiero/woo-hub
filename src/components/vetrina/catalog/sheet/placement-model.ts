import { isListed } from "@/lib/vetrina/catalog";
import type { OperationInput, OperationKind, OperationView } from "@/lib/vetrina/catalog-ops";

/**
 * The product sheet's "Nel negozio" as plain data: what it says about the
 * product, and the actions started from it while they run. Kept apart from
 * the component so it can be tested without a screen.
 */

/** An action started from the sheet, from its start until the sheet has read the product again after it ended. */
export interface PendingAction {
  id: string;
  kind: OperationKind;
  /** The category it adds or removes. */
  categoryId: number | null;
  /** It ended; the sheet is reading the product again. Until that answer, what it did is shown as done. */
  settled: boolean;
}

export function pendingFrom(view: Pick<OperationView, "id" | "kind">, input: OperationInput | null, settled: boolean): PendingAction {
  const categoryId = input && (input.kind === "categorize" || input.kind === "uncategorize") ? input.categoryId : null;
  return { id: view.id, kind: view.kind, categoryId, settled };
}

/** One of these is running (or just ended and not read back yet). */
export function isWorking(pending: readonly PendingAction[], ...kinds: OperationKind[]): boolean {
  return pending.some((p) => kinds.includes(p.kind));
}

/** The categories a removal from here is taking it out of. */
export function removingFrom(pending: readonly PendingAction[]): ReadonlySet<number> {
  return new Set(pending.flatMap((p) => (p.kind === "uncategorize" && p.categoryId != null ? [p.categoryId] : [])));
}

/**
 * Where the visibility switch stands: on the way the owner just flipped it
 * (`flipping`, before the server answers), then the way an action from here
 * is turning it, then the shop's. Busy while any of those is in flight, so a
 * second tap cannot cross the first.
 */
export function visibilitySwitch(
  listed: boolean,
  pending: readonly PendingAction[],
  flipping: boolean | null,
): { on: boolean; busy: boolean; going: "hide" | "show" | null } {
  let last: PendingAction | undefined;
  for (const p of pending) if (p.kind === "hide" || p.kind === "show") last = p;
  if (flipping != null) return { on: flipping, busy: true, going: flipping ? "show" : "hide" };
  if (last) return { on: last.kind === "show", busy: true, going: last.kind === "show" ? "show" : "hide" };
  return { on: listed, busy: false, going: null };
}

export interface ShopWords {
  shown: { visible: string; catalog: string; search: string; hidden: string; unpublished: string };
  stock: Record<string, string>;
}

/**
 * What customers get now, in two words: "Visibile · esaurito". A product
 * shown only in the categories or only in search says which; one not
 * published yet says it shows once published.
 */
export function shopState(
  words: ShopWords,
  product: { status: string; visibility: string; stockStatus?: string | null },
): { shown: string; stock: string | null; soldOut: boolean; hidden: boolean } {
  const hidden = !isListed(product.visibility);
  const published = product.status === "publish";
  const shown = hidden
    ? words.shown.hidden
    : !published
      ? words.shown.unpublished
      : product.visibility === "catalog"
        ? words.shown.catalog
        : product.visibility === "search"
          ? words.shown.search
          : words.shown.visible;
  const stock = (product.stockStatus && words.stock[product.stockStatus]) || null;
  return { shown, stock, soldOut: product.stockStatus === "outofstock", hidden };
}

/**
 * Whether an action changed what the product's card shows (its price on the
 * site, its visibility), so the screen behind reads the card again. Every
 * action may also move the product in or out of what that screen lists — a
 * hidden product leaves the homepage, a category its list — which the
 * screen hears separately.
 */
export function cardShows(kind: OperationKind): boolean {
  return kind === "sale" || kind === "unsale" || kind === "hide" || kind === "show";
}

/**
 * Whether the product is on sale after a sale (or a sale's end) started from
 * the sheet: known when it changed the product and stands; null when it is
 * not a sale, changed nothing, or was undone (an undo may put back an older
 * sale) — then the store's card says. Read until the card catches up, so the
 * Saldo row does not flick back for a moment.
 */
export function saleAfter(view: Pick<OperationView, "kind" | "status" | "changed">): boolean | null {
  if (view.kind !== "sale" && view.kind !== "unsale") return null;
  const stands = view.status === "done" || view.status === "failed";
  return stands && view.changed > 0 ? view.kind === "sale" : null;
}
