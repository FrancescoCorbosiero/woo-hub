import type { OperationKind } from "@/lib/vetrina/catalog-ops";
import { changedFields } from "@/lib/vetrina/fields";
import { sameState } from "@/lib/vetrina/order";
import type { SectionDraft } from "@/lib/vetrina/types";

/**
 * The section editor reading its section again — its pure part, so the
 * tests reach it: which ended actions can change what a section shows, and
 * when the owner is told the section moved under his unpublished draft.
 */

/**
 * A pin, a product hidden or shown, one put in or out of a category, a tag an
 * automatic category reads — and the shop's own positions, which a section in
 * "Negozio" order follows after its pinned products.
 */
const MOVERS = new Set<OperationKind>(["pin", "hide", "show", "categorize", "uncategorize", "tag", "untag", "order", "sourceOrder"]);

export function movesSection(kind: OperationKind): boolean {
  return MOVERS.has(kind);
}

/** The draft holds changes not published yet: the order, the section's texts or its size. */
export function edited(saved: SectionDraft, draft: SectionDraft): boolean {
  return !sameState(saved, draft) || changedFields(saved.fields, draft.fields).length > 0 || saved.limit !== draft.limit;
}

const sameIds = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Whether the section read again differs from the one the draft was made
 * over — its pins, hidden ones, texts or size, or the products it shows.
 * Only then is the owner told it changed meanwhile: reading it again after
 * a sale on one of its products is no change to the section.
 */
export function movedUnderDraft(
  before: { state: SectionDraft; shown: readonly number[] },
  fresh: { state: SectionDraft; shown: readonly number[] },
): boolean {
  return edited(before.state, fresh.state) || !sameIds(before.shown, fresh.shown);
}
