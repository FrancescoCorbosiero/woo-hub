import type { CatalogQuery } from "@/lib/vetrina/catalog";
import type { OperationKind, OperationStatus, OperationTarget, OperationView, SaleRounding } from "@/lib/vetrina/catalog-ops";

/**
 * The catalog's actions, their pure parts: what a selection holds and the
 * target it becomes, a sale's end date, how a followed action ended, the
 * searches inside the sheets. No React here, so the tests reach every rule.
 */

/* ---------------------------------------------------------------- *
 * The selection
 * ---------------------------------------------------------------- */

/** A product as the selection keeps it: enough to name it and to offer Nascondi or Mostra. */
export interface PickedProduct {
  id: number;
  name: string;
  hidden: boolean;
}

export interface SelectionState {
  active: boolean;
  /** "Seleziona tutti": every product the list's query matches, loaded or not. */
  all: boolean;
  /** Picked by hand (when not `all`), in the order picked. */
  picked: ReadonlyMap<number, PickedProduct>;
}

export const NO_SELECTION: SelectionState = { active: false, all: false, picked: new Map() };

/** Selecting, with the long-pressed product already picked. */
export function startSelection(first?: PickedProduct): SelectionState {
  return { active: true, all: false, picked: first ? new Map([[first.id, first]]) : new Map() };
}

/**
 * Whether a row tapped under "Seleziona tutti" can mean "all but this one":
 * only once every product the list matches is on screen. The target can
 * only be a query or a list of ids, so "all but one" becomes the rows on
 * screen less that one — with 50 of 500 loaded, a tap would quietly drop
 * the 450 not loaded. Until then the tap changes nothing, and says why.
 */
export function canLeaveOneOut(state: SelectionState, loaded: number, total: number): boolean {
  return !state.all || loaded >= total;
}

/**
 * A row tapped while selecting. Out of "all", a tap means "all but this
 * one": the rows on screen, less this one — only when they are every match
 * (`total`, the query's count); otherwise "all" stays as it is.
 */
export function togglePicked(
  state: SelectionState,
  product: PickedProduct,
  onScreen: readonly PickedProduct[],
  total = onScreen.length,
): SelectionState {
  if (state.all) {
    if (!canLeaveOneOut(state, onScreen.length, total)) return state;
    const picked = new Map(onScreen.filter((p) => p.id !== product.id).map((p) => [p.id, p] as const));
    return { active: true, all: false, picked };
  }
  const picked = new Map(state.picked);
  if (picked.has(product.id)) picked.delete(product.id);
  else picked.set(product.id, product);
  return { ...state, active: true, picked };
}

export function selectAll(): SelectionState {
  return { active: true, all: true, picked: new Map() };
}

/** Still selecting, nothing chosen. */
export function clearPicked(): SelectionState {
  return { active: true, all: false, picked: new Map() };
}

export function isPicked(state: SelectionState, id: number): boolean {
  return state.active && (state.all || state.picked.has(id));
}

/** How many products the selection holds; `total` is what the list's query matches. */
export function selectedCount(state: SelectionState, total: number): number {
  if (!state.active) return 0;
  return state.all ? total : state.picked.size;
}

/** A catalog list's query as an action's target: every product it matches, no page. */
export function queryTarget(query: CatalogQuery): OperationTarget {
  const { offset: _offset, limit: _limit, ...rest } = query;
  return { kind: "query", query: rest };
}

/**
 * Hand-picked products in the order the screen shows them (a pin takes them
 * in that order); those picked under another search or chip, no longer on
 * screen, follow in the order they were picked.
 */
export function orderedIds(picked: Iterable<number>, onScreen: readonly number[]): number[] {
  const chosen = new Set(picked);
  const shown = onScreen.filter((id) => chosen.has(id));
  const seen = new Set(shown);
  return [...shown, ...[...chosen].filter((id) => !seen.has(id))];
}

/** What the selection acts on; null when nothing is chosen. */
export function selectionTarget(state: SelectionState, query: CatalogQuery, onScreen: readonly number[]): OperationTarget | null {
  if (!state.active) return null;
  if (state.all) return queryTarget(query);
  const ids = orderedIds(state.picked.keys(), onScreen);
  return ids.length > 0 ? { kind: "ids", ids } : null;
}

/** "Mostra" when every product chosen is hidden already (the Nascosti chip or view, say); "Nascondi" otherwise. */
export function visibilityAction(state: SelectionState, query: CatalogQuery): "hide" | "show" {
  if (state.all) return query.visibility === "hidden" || query.view === "hidden" ? "show" : "hide";
  const picked = [...state.picked.values()];
  return picked.length > 0 && picked.every((p) => p.hidden) ? "show" : "hide";
}

/* ---------------------------------------------------------------- *
 * A sale's last day
 * ---------------------------------------------------------------- */

export type EndChoice = "none" | "sunday" | "week" | "pick";

const pad = (n: number) => String(n).padStart(2, "0");

/** The phone's own date, YYYY-MM-DD: the owner's "today", which is the shop's. */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A day as a UTC noon: adding days never trips over a clock change. */
function noon(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

export function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = noon(text);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

export function addDays(day: string, days: number): string {
  const date = noon(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: string): number {
  return noon(day).getUTCDay();
}

/** The weekend's last day: today when it is Sunday already. */
export function comingSunday(today: string): string {
  return addDays(today, (7 - weekdayOf(today)) % 7);
}

/** The sale's last day for a choice; a picked day before today (or none yet) is no day. */
export function endsOnFor(choice: EndChoice, today: string, picked: string | null): string | null {
  switch (choice) {
    case "none":
      return null;
    case "sunday":
      return comingSunday(today);
    case "week":
      return addDays(today, 7);
    case "pick":
      return picked && isDay(picked) && picked >= today ? picked : null;
  }
}

/**
 * The choice a sale's last day reads as, opening the sheet on a running
 * sale ("Cambia lo sconto"): the chip that gives that day today (Domenica,
 * 7 giorni), else the day itself, picked; none for no day, or one passed.
 */
export function endChoiceFor(endsOn: string | null, today: string): { choice: EndChoice; picked: string } {
  if (!endsOn || !isDay(endsOn) || endsOn < today) return { choice: "none", picked: "" };
  for (const choice of ["sunday", "week"] as const) {
    if (endsOnFor(choice, today, null) === endsOn) return { choice, picked: "" };
  }
  return { choice: "pick", picked: endsOn };
}

/** A sale as the sheet asks it, or as a term's running sale stands. */
export interface SaleTerms {
  percent: number;
  rounding: SaleRounding;
  endsOn: string | null;
}

/**
 * What "Cambia lo sconto" does to the term's running sale, for its button:
 * only the last day moves (put, moved or taken away) — the same percent and
 * rounding, another end, as the server words its label — or a new discount.
 * Null when the sheet does not change a running sale.
 */
export function saleChange(running: SaleTerms | null, draft: SaleTerms): "endAdded" | "endMoved" | "endRemoved" | "discount" | null {
  if (!running) return null;
  if (running.percent !== draft.percent || running.rounding !== draft.rounding) return "discount";
  if ((running.endsOn ?? null) === (draft.endsOn ?? null)) return "discount";
  if (draft.endsOn == null) return "endRemoved";
  return running.endsOn == null ? "endAdded" : "endMoved";
}

/** "domenica 18 ottobre" / "Sunday 18 October". */
export function formatDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(noon(day));
}

/** "14:05" today, "12 ott, 14:05" before. */
export function formatTime(iso: string, locale: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const tag = locale === "en" ? "en-GB" : "it-IT";
  const time = { hour: "2-digit", minute: "2-digit" } as const;
  if (isoDay(date) === isoDay(now)) return new Intl.DateTimeFormat(tag, time).format(date);
  return new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", ...time }).format(date);
}

/* ---------------------------------------------------------------- *
 * Following an action
 * ---------------------------------------------------------------- */

/** Still going: the tracker keeps asking. */
export function isActive(view: Pick<OperationView, "status">): boolean {
  return view.status === "running" || view.status === "undoing";
}

export type Outcome = "done" | "failed" | "undone" | "undoFailed";

/**
 * How a followed action ended, from the status it had when last seen going
 * and the one it has now; null while it goes on. An undo that fails puts the
 * action back where it was (done, or failed), with the undo's error.
 */
export function outcomeOf(before: OperationStatus, after: Pick<OperationView, "status">): Outcome | null {
  if (isActive(after)) return null;
  if (after.status === "undone") return "undone";
  if (before === "undoing") return "undoFailed";
  return after.status === "failed" ? "failed" : "done";
}

/** The pause before asking again: quick at first, slower as an action drags on, slower still while the server does not answer. */
export function pollDelay(round: number, failures: number): number {
  if (failures > 0) return Math.min(10_000, 2_000 * 2 ** (failures - 1));
  return round < 5 ? 800 : round < 30 ? 1_500 : 3_000;
}

/* ---------------------------------------------------------------- *
 * Searching a sheet's list
 * ---------------------------------------------------------------- */

/** Lower case, no accents, single spaces: "Più Venduti " finds "piu venduti". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word typed is somewhere in the name (or the path). */
export function matches(text: string, q: string): boolean {
  const words = fold(q).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold(text);
  return words.every((w) => hay.includes(w));
}

/** The item with exactly this name, case and accents aside: typing "Saldi" picks the store's "saldi". */
export function sameName<T extends { name: string }>(list: readonly T[], name: string): T | undefined {
  const wanted = fold(name);
  return wanted ? list.find((item) => fold(item.name) === wanted) : undefined;
}

/** An automatic category's rule, as far as reading a tag goes. */
interface RuleLike {
  enabled: boolean;
  conditions: readonly { field: string; op: string; value: string }[];
}

/**
 * The automatic categories whose rule reads this tag (tagging a product may
 * move it in or out of them), by name. "Is not" counts too: it reads it. A
 * paused rule moves nothing, so it is left out.
 */
export function readersOfTag(categories: readonly { name: string; automatic: RuleLike | null }[], tagId: number): string[] {
  const id = String(tagId);
  return categories
    .filter((c) => c.automatic?.enabled && c.automatic.conditions.some((cond) => cond.field === "tag" && cond.value === id))
    .map((c) => c.name);
}

/**
 * What the store refused, in the unit the count is in: products for every
 * action but a margin, whose reprice counts the SIZES the store refused
 * (one product can refuse eight) — "8 taglie rifiutate", never "8 prodotti".
 */
export function refusedText(
  kind: OperationKind,
  count: number,
  words: { products: (count: number) => string; sizes: (count: number) => string },
): string {
  return kind === "margin" ? words.sizes(count) : words.products(count);
}

/**
 * "Riordina": the rows down to the last one that moved, in their new order —
 * what "Ordina" places at the top of the term (the rows below keep their
 * order); empty when nothing moved.
 */
export function movedPrefix(original: readonly number[], now: readonly number[]): number[] {
  let last = -1;
  for (let i = 0; i < now.length; i++) if (now[i] !== original[i]) last = i;
  return now.slice(0, last + 1);
}

/**
 * "Riordina": how many rows were moved — those that left their place among
 * the others, not the ones only pushed along: the rows minus the longest
 * run still in their old order.
 */
export function movedCount(original: readonly number[], now: readonly number[]): number {
  const was = new Map(original.map((id, i) => [id, i]));
  // Patience sorting: tails[k] is the smallest old place ending a run of k + 1.
  const tails: number[] = [];
  for (const id of now) {
    const place = was.get(id);
    if (place == null) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < place) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = place;
  }
  return now.length - tails.length;
}
