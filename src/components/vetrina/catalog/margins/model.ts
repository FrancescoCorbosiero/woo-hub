import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import {
  MARGIN_PERCENT_MAX,
  MARGIN_PERCENT_MIN,
  type MarginValue,
  type OperationInput,
  type OperationView,
  type TermMarginState,
} from "@/lib/vetrina/catalog-ops";
import type { Dictionary } from "@/i18n/dictionary";

/**
 * A term's margin, its pure part: what the "Ricarico" row says, where the
 * margin sheet's slider starts, and the action it asks for. No React here,
 * so the tests reach every case.
 */

export type MarginWords = Dictionary["vetrinaCatalog"]["margins"];

/** The term a margin is set on, as the screen holds it. */
export interface MarginTermRef {
  taxonomy: CatalogTaxonomy;
  id: number;
  name: string;
}

/** Where the slider starts when nothing better says: a margin most shops recognise. */
export const DEFAULT_PERCENT = 25;

/** The quick choices under the slider. */
export const PRESETS = [15, 20, 25, 30, 40] as const;

/** A margin in words: "25%", "a fasce", "+10 €". */
export function marginText(value: MarginValue, m: MarginWords): string {
  switch (value.kind) {
    case "percent":
      return m.value.percent(value.percent);
    case "bands":
      return m.value.bands;
    case "fixed":
      return m.value.fixed(value.amount);
  }
}

/**
 * The row shows where a margin can act — the term has products the Hub
 * prices from the market — and wherever the term has a margin of its own,
 * even one that prices nothing now (its products all moved to the
 * supplier's feed): the owner sees it, and can take it away.
 */
export function rowShown(state: TermMarginState): boolean {
  return state.priced > 0 || state.own != null;
}

/**
 * "Ricarico di questa categoria: 25%" / "Ricarico: 25% da «Nike»" /
 * "Ricarico: dalle regole dell'Hub" / "Ricarico: standard (a fasce)".
 */
export function rowTitle(state: TermMarginState, taxonomy: CatalogTaxonomy, m: MarginWords): string {
  if (state.own) return m.row.own(taxonomy, marginText(state.own, m));
  if (state.inherited) return m.row.inherited(marginText(state.inherited.value, m), state.inherited.term);
  // Another of the Hub's rules prices them (a catalog brand's, a family's): not the standard.
  if (state.hubRules > 0) return m.row.hub;
  return m.row.standard(state.standard ? marginText(state.standard, m) : null);
}

/** Under the title: how many products it applies to, and how many the supplier prices. */
export function rowText(state: TermMarginState, m: MarginWords): string {
  // A margin of its own that prices nothing now.
  if (state.priced === 0) return m.row.nonePriced;
  return [m.row.applies(state.applies), state.supplier > 0 ? m.row.supplier(state.supplier) : null].filter(Boolean).join(" · ");
}

/** Under the title while a margin of this term runs: how far it got. */
export function runningText(view: OperationView, m: MarginWords): string {
  if (view.status === "undoing") return view.queued ? m.row.waiting : m.row.undoing;
  return view.queued ? m.row.waiting : m.row.running(view.progress.done, view.progress.total);
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PERCENT;
  return Math.min(MARGIN_PERCENT_MAX, Math.max(MARGIN_PERCENT_MIN, Math.round(value)));
}

/** The term's own margin as a percent, when it is one (a margin of bands or a fixed amount set on the Hub is not). */
export function ownPercent(state: TermMarginState): number | null {
  return state.own?.kind === "percent" ? state.own.percent : null;
}

/** Where the slider starts: the term's own percent, else the one it follows (a term above it's, the standard's), else 25 %. */
export function startPercent(state: TermMarginState): number {
  for (const value of [state.own, state.inherited?.value, state.standard]) {
    if (value?.kind === "percent") return clampPercent(value.percent);
  }
  return DEFAULT_PERCENT;
}

export type MarginMode = "set" | "standard";

/** Where the sheet opens: on taking the margin away when that is all it can do (a margin of its own that prices nothing now). */
export function startMode(state: TermMarginState): MarginMode {
  return state.own != null && state.priced === 0 ? "standard" : "set";
}

/**
 * The percent the term's products follow now, when it is one: its own, else
 * a term above it's, else the standard — unless other Hub rules price them.
 */
export function followedPercent(state: TermMarginState): number | null {
  const value = state.own ?? state.inherited?.value ?? (state.hubRules > 0 ? null : state.standard);
  return value?.kind === "percent" ? value.percent : null;
}

/**
 * The action the sheet asks for; null when there is nothing to ask — the
 * slider on the very margin the term follows now (its own, or the one it
 * follows without one: a rule saying the same would change no price today).
 */
export function marginInput(
  term: Pick<MarginTermRef, "taxonomy" | "id">,
  mode: MarginMode,
  percent: number,
  followed: number | null,
): OperationInput | null {
  if (mode === "standard")
    return {
      kind: "margin",
      taxonomy: term.taxonomy,
      termId: term.id,
      percent: null,
    };
  const value = clampPercent(percent);
  if (followed != null && value === followed) return null;
  return {
    kind: "margin",
    taxonomy: term.taxonomy,
    termId: term.id,
    percent: value,
  };
}

/** "Adesso: 25% (di questa categoria)." — what the term follows now, above the slider. */
export function nowText(state: TermMarginState, taxonomy: CatalogTaxonomy, m: MarginWords): string {
  if (state.own) return m.sheet.nowOwn(marginText(state.own, m), taxonomy);
  if (state.inherited) return m.sheet.nowInherited(marginText(state.inherited.value, m), state.inherited.term);
  if (state.hubRules > 0) return m.sheet.nowHub;
  return m.sheet.nowStandard(state.standard ? marginText(state.standard, m) : null);
}

/** "I suoi prodotti tornano al ricarico di «Nike» (25%)." — where taking its own margin away takes them. */
export function backText(state: TermMarginState, m: MarginWords): string {
  const target = state.inherited
    ? m.sheet.backToInherited(marginText(state.inherited.value, m), state.inherited.term)
    : state.hubRules > 0
      ? m.sheet.backToHub
      : m.sheet.backToStandard(state.standard ? marginText(state.standard, m) : null);
  return m.sheet.backHint(target);
}

/** The button that takes its own margin away, named for where it takes the products: "Torna al ricarico di «Nike»". */
export function backLabel(state: TermMarginState, m: MarginWords): string {
  if (state.inherited) return m.sheet.back.inherited(state.inherited.term);
  return state.hubRules > 0 ? m.sheet.back.hub : m.sheet.back.standard;
}

/** The margin action of this term followed now (running, waiting, or being undone), if any. */
export function activeMargin(active: readonly OperationView[], taxonomy: CatalogTaxonomy, id: number): OperationView | null {
  const key = `${taxonomy}:${id}`;
  return active.find((v) => v.kind === "margin" && v.termKey === key) ?? null;
}
