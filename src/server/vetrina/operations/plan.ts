import "server-only";
import type { OperationInput, OperationKind, OperationStatus, SaleRounding } from "@/lib/vetrina/catalog-ops";
import type { OperationLabelParams } from "@/server/db/schema";
import { words, type Words } from "./words";

/**
 * The catalog's actions, decided: what a sale makes of a price, which sizes
 * and products an action changes, the pins a section ends up with, what an
 * undo may put back, and the words for all of it. Pure — no store, no
 * database — so every rule here is pinned down by plan.test.ts.
 */

/* ---------------------------------------------------------------- *
 * Prices
 * ---------------------------------------------------------------- */

/** A price as the store sends it ("129.00", "129", 129) in cents; null for none, or nothing above zero. */
export function priceCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value).trim().replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

/** Cents as the store takes a price: "102.99". */
export function storePrice(cents: number): string {
  return (cents / 100).toFixed(2);
}

// As the catalog's lists write a price (components/vetrina/format.ts): a preview reads the same.
const EURO = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

/** "129,00 €", "102,99 €", "1.299,00 €": as the catalog's lists write it. */
export function euro(cents: number): string {
  return EURO.format(cents / 100);
}

/**
 * The sale price of a regular price, percent off, rounded DOWN — never a
 * smaller discount than announced:
 *  - "charm": to the largest x,99 not above it, from 10 € up (102,99 for
 *    103,20); below 10 € to the cent;
 *  - "exact": to the cent.
 */
export function salePriceCents(regular: number, percent: number, rounding: SaleRounding): number {
  const exact = Math.floor((regular * (100 - percent)) / 100 + 1e-9);
  if (rounding === "charm" && exact >= 1000) return Math.floor((exact + 1) / 100) * 100 - 1;
  return exact;
}

/* ---------------------------------------------------------------- *
 * Sales, size by size
 * ---------------------------------------------------------------- */

/** A size's (or a product's own) sale as the store holds it. What an item records, before and after. */
export interface SaleState {
  /** "102.99"; "" for none. */
  price: string;
  /** WooCommerce's date_on_sale_from / _to, shop time ("2026-10-20T23:59:59"); null for none. */
  from: string | null;
  to: string | null;
}

export const NO_SALE: SaleState = { price: "", from: null, to: null };

const dateOf = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** A sale as the store sends it, normalized: "102.990" and "102.99" are one price, "" and null one date. */
export function saleOf(raw: { sale_price?: unknown; date_on_sale_from?: unknown; date_on_sale_to?: unknown }): SaleState {
  const cents = priceCents(raw.sale_price);
  return { price: cents == null ? "" : storePrice(cents), from: dateOf(raw.date_on_sale_from), to: dateOf(raw.date_on_sale_to) };
}

const day = (date: string | null) => (date ? date.slice(0, 10) : null);

/** The same sale: price to the cent, dates to the day (the store answers a written date in its own format). */
export function sameSale(a: SaleState, b: SaleState): boolean {
  return priceCents(a.price) === priceCents(b.price) && day(a.from) === day(b.from) && day(a.to) === day(b.to);
}

/** The end of a sale's last day, in the shop's time: what WooCommerce's date_on_sale_to takes. */
export function saleEnd(endsOn: string): string {
  return `${endsOn}T23:59:59`;
}

/** The fields a sale is written with. Empty values clear: no start date ever, so the sale starts now. */
export function saleFields(sale: SaleState): { sale_price: string; date_on_sale_from: string; date_on_sale_to: string } {
  return { sale_price: sale.price, date_on_sale_from: sale.from ?? "", date_on_sale_to: sale.to ?? "" };
}

/** A size as read live before a sale is written. */
export interface LiveSize {
  /** The size's variation id; null for a product sold as one item (its own prices). */
  variationId: number | null;
  /** The regular price, in cents; null for none. */
  regular: number | null;
  sale: SaleState;
}

export type SaleSkip = "noPrice" | "notLower" | "same" | "noSale";

export type SizePlan =
  | { variationId: number | null; write: true; before: SaleState; after: SaleState }
  | { variationId: number | null; write: false; reason: SaleSkip };

export interface SaleSpec {
  percent: number;
  rounding: SaleRounding;
  /** The last day (YYYY-MM-DD), or none. */
  endsOn: string | null;
}

/**
 * "Metti in saldo", size by size: the sale price from the regular one. A
 * size without a regular price, or where the sale would not be lower, is
 * left alone; one already on exactly this sale too. The regular price is
 * read, never written.
 */
export function planSale(sizes: readonly LiveSize[], spec: SaleSpec): SizePlan[] {
  return sizes.map((size): SizePlan => {
    const { variationId } = size;
    if (size.regular == null) return { variationId, write: false, reason: "noPrice" };
    const sale = salePriceCents(size.regular, spec.percent, spec.rounding);
    if (sale <= 0 || sale >= size.regular) return { variationId, write: false, reason: "notLower" };
    const after: SaleState = { price: storePrice(sale), from: null, to: spec.endsOn ? saleEnd(spec.endsOn) : null };
    if (sameSale(size.sale, after)) return { variationId, write: false, reason: "same" };
    return { variationId, write: true, before: size.sale, after };
  });
}

/** "Togli il saldo": the sizes with a sale price lose it, and its dates. */
export function planUnsale(sizes: readonly LiveSize[]): SizePlan[] {
  return sizes.map((size): SizePlan =>
    priceCents(size.sale.price) == null
      ? { variationId: size.variationId, write: false, reason: "noSale" }
      : { variationId: size.variationId, write: true, before: size.sale, after: NO_SALE },
  );
}

const SKIP_ORDER: SaleSkip[] = ["same", "notLower", "noPrice", "noSale"];

/** Why a product is left alone — null when one of its sizes is written. */
export function productSkip(plans: readonly SizePlan[]): SaleSkip | null {
  if (plans.length === 0) return "noPrice";
  if (plans.some((p) => p.write)) return null;
  const reasons = new Set(plans.map((p) => (p.write ? null : p.reason)));
  return SKIP_ORDER.find((r) => reasons.has(r)) ?? "noPrice";
}

/** What a size sells at: its sale price while it has one, else its regular price. */
const shelf = (regular: number | null, sale: SaleState) => priceCents(sale.price) ?? regular;

function priceWords(list: (number | null)[], w: Words): string {
  const known = list.filter((c): c is number => c != null);
  if (known.length === 0) return w.state.noPrice;
  const low = Math.min(...known);
  return new Set(known).size > 1 ? w.state.from(euro(low)) : euro(low);
}

/** A product's prices before and after, in words: "129,00 €" → "102,99 €" (the lowest, "da" when sizes differ). */
export function salePriceWords(
  sizes: readonly LiveSize[],
  plans: readonly SizePlan[],
  w: Words = words(),
): { before: string; after: string } {
  const after = sizes.map((size, i) => {
    const plan = plans[i];
    return plan?.write ? shelf(size.regular, plan.after) : shelf(size.regular, size.sale);
  });
  return { before: priceWords(sizes.map((s) => shelf(s.regular, s.sale)), w), after: priceWords(after, w) };
}

/**
 * A sale that puts a size's price UP: the size is on a deeper sale of its
 * own already, which this one replaces. Written all the same — "Cambia lo
 * sconto" needs it — but the preview says so.
 */
export function raisesPrice(sizes: readonly LiveSize[], plans: readonly SizePlan[]): boolean {
  return plans.some((plan, i) => {
    if (!plan.write) return false;
    const now = priceCents(sizes[i]?.sale.price);
    const next = priceCents(plan.after.price);
    return now != null && next != null && next > now;
  });
}

/* ---------------------------------------------------------------- *
 * Visibility, tags, categories
 * ---------------------------------------------------------------- */

/** The visibility "Nascondi" or "Mostra" writes, or null when the product needs nothing. */
export function visibilityAfter(kind: "hide" | "show", current: string): string | null {
  if (kind === "hide") return current === "hidden" ? null : "hidden";
  // "Mostra" brings back what is hidden; "only in search" or "only in the catalog" was someone's choice.
  return current === "hidden" ? "visible" : null;
}

/** A product's whole list of tags or categories after adding or removing one; null when it changes nothing. */
export function listAfter(current: readonly number[], change: { add: number } | { remove: number }): number[] | null {
  if ("add" in change) return current.includes(change.add) ? null : [...current, change.add];
  return current.includes(change.remove) ? current.filter((id) => id !== change.remove) : null;
}

/** The same ids, in any order. */
export function sameIds(a: readonly number[], b: readonly number[]): boolean {
  const x = [...new Set(a)].sort((m, n) => m - n);
  const y = [...new Set(b)].sort((m, n) => m - n);
  return x.length === y.length && x.every((id, i) => id === y[i]);
}

/* ---------------------------------------------------------------- *
 * Pins
 * ---------------------------------------------------------------- */

export interface PinPlan {
  /** The section's pins after. */
  pin: number[];
  /** The targets pinned, in order. */
  placed: number[];
  /** Targets past the ceiling, left as they are. */
  overflow: number[];
  /** Earlier pins pushed out past the ceiling. */
  dropped: number[];
}

/** "Metti in homepage": the targets first, in the order given, then the earlier pins without them — at most `max`. */
export function pinList(targets: readonly number[], previous: readonly number[], max: number): PinPlan {
  const unique = [...new Set(targets)];
  const placed = unique.slice(0, max);
  const overflow = unique.slice(max);
  const taken = new Set(placed);
  const rest = previous.filter((id) => !taken.has(id));
  const room = Math.max(0, max - placed.length);
  return { pin: [...placed, ...rest.slice(0, room)], placed, overflow, dropped: rest.slice(room) };
}

/* ---------------------------------------------------------------- *
 * Undo
 * ---------------------------------------------------------------- */

/**
 * What an undo does with one recorded value, given what the store shows now:
 *  - "restore": the store still shows what the action wrote → write it back;
 *  - "already": the store shows the value from before → nothing to do;
 *  - "changed": someone changed it since → left alone, and counted.
 */
export type UndoVerdict = "restore" | "already" | "changed";

export function undoVerdict<T>(live: T, before: T, after: T, same: (a: T, b: T) => boolean): UndoVerdict {
  if (same(before, after) || same(live, before)) return "already";
  return same(live, after) ? "restore" : "changed";
}

/**
 * Undo for a list of tags or categories. What the action wrote is a change —
 * these added, those removed — and that change is what must still be there:
 * a tag or category someone (or an automatic category) added since stays,
 * and the change is taken back around it.
 */
export function undoList(live: readonly number[], before: readonly number[], after: readonly number[]): { verdict: UndoVerdict; list: number[] } {
  const added = after.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !after.includes(id));
  const has = new Set(live);
  if (added.length === 0 && removed.length === 0) return { verdict: "already", list: [...live] };
  if (added.every((id) => has.has(id)) && removed.every((id) => !has.has(id))) {
    return { verdict: "restore", list: [...live.filter((id) => !added.includes(id)), ...removed] };
  }
  if (added.every((id) => !has.has(id)) && removed.every((id) => has.has(id))) return { verdict: "already", list: [...live] };
  return { verdict: "changed", list: [...live] };
}

/* ---------------------------------------------------------------- *
 * The log
 * ---------------------------------------------------------------- */

/** An action's row, as far as the term screen and the undo rules read it. */
export interface OperationFacts {
  kind: OperationKind;
  status: OperationStatus;
  changed: number;
  input: OperationInput;
  createdAt: Date;
  finishedAt: Date | null;
  undoneAt: Date | null;
  termKey: string | null;
}

/** It still holds: under way, done, or stopped part-way after changing something — and not undone. */
export function stands(op: Pick<OperationFacts, "status" | "changed" | "undoneAt">): boolean {
  if (op.undoneAt) return false;
  return op.status === "running" || op.status === "done" || op.status === "undoing" || (op.status === "failed" && op.changed > 0);
}

/**
 * Kept in the log past its 30 days: an action filed under a whole term that
 * still stands. The term's screen reads its hide and its sale from these
 * rows (standingHide, standingSale) — a hide's items are what "Mostra" puts
 * back, and an older sale under a newer one, or a sale's end, decide what
 * the screen says — and there are only a handful per term. repo.ts's
 * trimOperations says the same in SQL.
 */
export function keptForTerm(op: Pick<OperationFacts, "status" | "changed" | "undoneAt" | "termKey">): boolean {
  return op.termKey != null && stands(op);
}

/** The hide that hid a whole term, while it stands ("Mostra" undoes exactly it). Rows newest first. */
export function standingHide<T extends OperationFacts>(rows: readonly T[]): T | null {
  return rows.find((op) => op.kind === "hide" && stands(op)) ?? null;
}

/**
 * The sale running on a whole term: the newest sale filed under it that
 * stands and has not ended — unless the term's sale was ended since ("Togli
 * il saldo" on the whole term). A newer sale replaces an older one's prices,
 * so only the newest counts. Rows newest first; `today` YYYY-MM-DD, shop time.
 */
export function standingSale<T extends OperationFacts>(rows: readonly T[], today: string): T | null {
  return standingSales(rows, today)[0] ?? null;
}

/**
 * The term's sale (as standingSale) and, after it, the term's sale it took
 * the place of, when that one still stands under it: undoing the newer puts
 * the older one's prices back. At most those two — or `max`: every sale of
 * the term still standing, one under the other, is what put its products
 * on sale. Rows newest first.
 */
export function standingSales<T extends OperationFacts>(rows: readonly T[], today: string, max = 2): T[] {
  const out: T[] = [];
  for (const op of rows) {
    if (out.length >= max) break;
    if (!stands(op)) continue;
    if (op.kind === "unsale") break;
    if (op.kind !== "sale" || op.input.kind !== "sale") continue;
    if (op.input.endsOn != null && op.input.endsOn < today) break;
    out.push(op);
  }
  return out;
}

const DAY_MS = 86_400_000;

/**
 * "Annulla" is offered: done (or stopped part-way after changing something),
 * not undone, and recent enough — but a whole term hidden stays undoable as
 * long as it is hidden, since that undo is its "Mostra".
 */
export function undoable(op: OperationFacts, now: number, undoDays: number): boolean {
  if (op.undoneAt) return false;
  if (!(op.status === "done" || (op.status === "failed" && op.changed > 0))) return false;
  if (op.kind === "hide" && op.termKey) return true;
  return now - (op.finishedAt ?? op.createdAt).getTime() <= undoDays * DAY_MS;
}

/** YYYY-MM-DD in a time zone: the shop's "today". */
export function dayIn(timeZone: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/* ---------------------------------------------------------------- *
 * Labels
 * ---------------------------------------------------------------- */

export interface LabelNames {
  /** Products it changes. */
  count: number;
  /** The whole term it is filed under. */
  term?: string | null;
  tag?: string;
  category?: string;
  section?: string;
}

/** An action's label as the log keeps it: what it is, and the names it needs. */
export function labelParams(input: OperationInput, names: LabelNames): OperationLabelParams {
  const base = { kind: input.kind, count: names.count };
  switch (input.kind) {
    case "hide":
    case "sale":
    case "unsale":
      return {
        ...base,
        term: names.term ?? null,
        ...(input.kind === "sale" ? { percent: input.percent } : {}),
      };
    case "tag":
      return { ...base, tag: names.tag ?? input.tag.name };
    case "untag":
      return { ...base, tag: names.tag ?? "" };
    case "categorize":
    case "uncategorize":
      return { ...base, category: names.category ?? "" };
    case "pin":
      return { ...base, section: names.section ?? input.sectionKey };
    case "show":
      return base;
  }
}

/** An action in the owner's words: "Saldo −20% · Saldi outlet", "12 prodotti nascosti", "Tag «saldi» a 8 prodotti". */
export function labelText(p: OperationLabelParams, w: Words = words()): string {
  const what = p.term || w.products(p.count);
  switch (p.kind) {
    case "hide":
      return w.label.hide(p.count, p.term ?? null);
    case "show":
      return w.label.show(p.count);
    case "sale":
      return w.label.sale(p.percent ?? 0, what);
    case "unsale":
      return w.label.unsale(what);
    case "tag":
      return w.label.tag(p.tag ?? "", p.count);
    case "untag":
      return w.label.untag(p.tag ?? "", p.count);
    case "categorize":
      return w.label.categorize(p.category ?? "", p.count);
    case "uncategorize":
      return w.label.uncategorize(p.category ?? "", p.count);
    case "pin":
      return w.label.pin(p.count, p.section ?? "");
  }
}

/* ---------------------------------------------------------------- *
 * Preview helpers
 * ---------------------------------------------------------------- */

/** Why products are left as they are, in words that agree with how many: "già nascosto", "già nascosti". */
export type Reason = (count: number) => string;

/** Reasons counted, the most frequent first, the empty ones left out. */
export function reasonCounts(counts: Map<Reason, number>): { reason: string; count: number }[] {
  return [...counts]
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => ({ reason: reason(count), count }))
    .sort((a, b) => b.count - a.count);
}

export function bump(counts: Map<Reason, number>, reason: Reason, by = 1): void {
  counts.set(reason, (counts.get(reason) ?? 0) + by);
}

/**
 * Of these products' other terms, how many products have one and the
 * names the most of them share — "12 sono anche in Nike, Novità e altri 3".
 * Terms by any key ("category:12", "brand:7"); only the named ones count.
 */
export function otherTerms(
  products: readonly { terms: readonly string[] }[],
  names: ReadonlyMap<string, string>,
  shown = 3,
): { count: number; names: string[]; total: number } {
  const perTerm = new Map<string, number>();
  let count = 0;
  for (const p of products) {
    const terms = [...new Set(p.terms)].filter((id) => names.has(id));
    if (terms.length > 0) count += 1;
    for (const id of terms) perTerm.set(id, (perTerm.get(id) ?? 0) + 1);
  }
  const ranked = [...perTerm]
    .sort((a, b) => b[1] - a[1] || names.get(a[0])!.localeCompare(names.get(b[0])!, "it"))
    .map(([id]) => names.get(id)!);
  return { count, names: ranked.slice(0, shown), total: ranked.length };
}

/** The sections these products show in, with how many of them each: "TENDENZA (3)". */
export function sectionCounts(
  ids: readonly number[],
  presence: ReadonlyMap<number, readonly { key: string; title: string }[]>,
): string[] {
  const per = new Map<string, { title: string; count: number }>();
  for (const id of ids) {
    for (const s of presence.get(id) ?? []) {
      const entry = per.get(s.key) ?? { title: s.title, count: 0 };
      entry.count += 1;
      per.set(s.key, entry);
    }
  }
  return [...per.values()].sort((a, b) => b.count - a.count).map((s) => `${s.title} (${s.count})`);
}
