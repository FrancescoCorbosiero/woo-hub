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

/** The row shows only where a margin can act: the term has products the Hub prices from the market. */
export function rowShown(state: TermMarginState): boolean {
  return state.priced > 0;
}

/** "Ricarico di questa categoria: 25%" / "Ricarico: 25% da «Nike»" / "Ricarico: standard (a fasce)". */
export function rowTitle(state: TermMarginState, taxonomy: CatalogTaxonomy, m: MarginWords): string {
  if (state.own) return m.row.own(taxonomy, marginText(state.own, m));
  if (state.inherited) return m.row.inherited(marginText(state.inherited.value, m), state.inherited.term);
  return m.row.standard(state.standard ? marginText(state.standard, m) : null);
}

/** Under the title: how many products it applies to, and how many the supplier prices. */
export function rowText(state: TermMarginState, m: MarginWords): string {
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

/**
 * The action the sheet asks for; null when there is nothing to ask — the
 * slider on the very margin the term has.
 */
export function marginInput(
  term: Pick<MarginTermRef, "taxonomy" | "id">,
  mode: MarginMode,
  percent: number,
  own: number | null,
): OperationInput | null {
  if (mode === "standard")
    return {
      kind: "margin",
      taxonomy: term.taxonomy,
      termId: term.id,
      percent: null,
    };
  const value = clampPercent(percent);
  if (own != null && value === own) return null;
  return {
    kind: "margin",
    taxonomy: term.taxonomy,
    termId: term.id,
    percent: value,
  };
}

/** "Adesso: 25%, il suo." — what the term follows now, above the slider. */
export function nowText(state: TermMarginState, m: MarginWords): string {
  if (state.own) return m.sheet.nowOwn(marginText(state.own, m));
  if (state.inherited) return m.sheet.nowInherited(marginText(state.inherited.value, m), state.inherited.term);
  return m.sheet.nowStandard(state.standard ? marginText(state.standard, m) : null);
}

/** "I suoi prodotti tornano al ricarico di «Nike» (25%)." — where "Torna allo standard" takes them. */
export function backText(state: TermMarginState, m: MarginWords): string {
  const target = state.inherited
    ? m.sheet.backToInherited(marginText(state.inherited.value, m), state.inherited.term)
    : m.sheet.backToStandard(state.standard ? marginText(state.standard, m) : null);
  return m.sheet.backHint(target);
}

/** The margin action of this term followed now (running, waiting, or being undone), if any. */
export function activeMargin(active: readonly OperationView[], taxonomy: CatalogTaxonomy, id: number): OperationView | null {
  const key = `${taxonomy}:${id}`;
  return active.find((v) => v.kind === "margin" && v.termKey === key) ?? null;
}
