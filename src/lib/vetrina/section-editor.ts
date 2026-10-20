/**
 * The section editor's decisions, apart from its screen: where each row
 * stands and where the homepage's fold falls, which row a "position N" is,
 * what products picked from the catalog do to the draft, which of them must
 * join the section's category first, and what fills a section — so what may
 * be added to it. Pure: the screen (components/vetrina/RailEditor.tsx) and
 * the tests share them.
 */

import { isListed, type CatalogProduct, type CatalogTaxonomy } from "./catalog";
import type { EditorRow } from "./order";
import type { HiddenReason, RailDetail, RailSource, SectionDraft } from "./types";

/** The draft a rail starts as: what the site shows now. */
export function draftOf(rail: Pick<RailDetail, "pin" | "exclude" | "fallback" | "fields" | "limit">): SectionDraft {
  return { pin: rail.pin, exclude: rail.exclude, fallback: rail.fallback, fields: rail.fields, limit: rail.limit };
}

export interface RowLayout {
  /** Each shown product's place on the site, from 1; a ghost (pinned, not shown) has none. */
  positions: Map<number, number>;
  /** How many the site would show, all of them. */
  visibleCount: number;
  /** The row after which the homepage stops showing (its size); null when it shows them all. */
  foldAfter: number | null;
}

/** Positions and the fold over the order being shown: ghosts take no place. */
export function layoutRows(
  order: readonly number[],
  kindOf: (id: number) => EditorRow["kind"] | undefined,
  limit: number,
): RowLayout {
  const positions = new Map<number, number>();
  let visibleCount = 0;
  let foldAfter: number | null = null;
  for (const id of order) {
    if (kindOf(id) === "ghost") continue;
    visibleCount += 1;
    positions.set(id, visibleCount);
    if (visibleCount === limit) foldAfter = id;
  }
  return { positions, visibleCount, foldAfter };
}

/** The row of the N-th product the site shows (ghosts skipped); past the end, the last row. */
export function rowIndexOfPosition(rows: readonly EditorRow[], position: number): number {
  let seen = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind === "ghost") continue;
    seen += 1;
    if (seen === position) return i;
  }
  return rows.length - 1;
}

export type PickPlace = "top" | "afterPins";

/**
 * Products picked in the catalog, pinned in the order picked: on top, or
 * after the pins already there. One pinned already moves; one hidden from
 * the section shows again.
 */
export function withPicked(draft: SectionDraft, ids: readonly number[], place: PickPlace): SectionDraft {
  const picked = new Set(ids);
  const others = draft.pin.filter((id) => !picked.has(id));
  return {
    ...draft,
    pin: place === "top" ? [...ids, ...others] : [...others, ...ids],
    exclude: draft.exclude.filter((id) => !picked.has(id)),
  };
}

/** A product picked in the catalog, until the section is published. */
export interface AddedProduct {
  product: Pick<CatalogProduct, "status" | "visibility" | "stockStatus">;
  /** Not in the section's category yet: it joins it when the section is published. */
  joins: boolean;
}

/** Would the shop list it, once in the section's category? */
function listable(product: AddedProduct["product"], hideOutOfStock: boolean): boolean {
  return (
    product.status === "publish" &&
    isListed(product.visibility) &&
    (product.stockStatus !== "outofstock" || !hideOutOfStock)
  );
}

/**
 * The automatic order with the pinned products that join the category on
 * publish: they will show, so they are drawn where they will be. The others
 * (sold out, hidden) stay ghosts, greyed with their reason.
 */
export function visibleWithJoiners(
  siteVisible: number[],
  pin: readonly number[],
  added: ReadonlyMap<number, AddedProduct>,
  hideOutOfStock: boolean,
): number[] {
  const shown = new Set(siteVisible);
  const joining = pin.filter((id) => {
    const a = added.get(id);
    return a != null && a.joins && !shown.has(id) && listable(a.product, hideOutOfStock);
  });
  return joining.length > 0 ? [...siteVisible, ...joining] : siteVisible;
}

/** The pinned products to put in the category before publishing: added, outside it, not on the site. */
export function joinersOf(pin: readonly number[], added: ReadonlyMap<number, AddedProduct>, onSite: readonly number[]): number[] {
  const shown = new Set(onSite);
  return pin.filter((id) => added.get(id)?.joins === true && !shown.has(id));
}

/** Why a product the shop does not list would wait, greyed, in the section. */
export function hiddenReasonOf(product: AddedProduct["product"]): HiddenReason {
  if (product.status !== "publish") return "unpublished";
  if (!isListed(product.visibility)) return "hidden";
  if (product.stockStatus === "outofstock") return "outofstock";
  return "not_in_section";
}

/**
 * What fills a section — and so what may be added to it from the catalog:
 * any product to a category filled by hand (it joins the category), a
 * rule's own products to an automatic category, the brand's to a brand's,
 * what is on sale to the sale list, any product to another list. A section
 * showing several terms, a tag or a fixed list takes none: null.
 */
export type SectionFill = "category" | "automatic" | "brand" | "sale" | "list";

export function sectionFill(
  oneTerm: { taxonomy: CatalogTaxonomy } | null,
  automatic: boolean,
  source: RailSource | null,
): SectionFill | null {
  if (oneTerm?.taxonomy === "category") return automatic ? "automatic" : "category";
  if (oneTerm?.taxonomy === "brand") return "brand";
  if (source && "list" in source) return source.list === "sale" ? "sale" : "list";
  return null;
}
