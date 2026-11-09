import { placeOf, TOP, type Layout } from "./plan";

/**
 * The one-tap moves an item's "⋯" offers on the Vetrina's menu screen, each
 * as the place a move action takes (menuItemMove's `place`: a parent, and a
 * 1-based position among the items there once the item has left its own
 * place). Null where the item cannot go that way.
 */
export interface ItemMoves {
  up: { parent: number; position: number } | null;
  down: { parent: number; position: number } | null;
  /** Under the item just above it, after that item's own items. */
  indent: { parent: number; position: null } | null;
  /** Out of its parent, right after it. */
  outdent: { parent: number; position: number } | null;
}

export function movesOf(layout: Layout, id: number): ItemMoves {
  const place = placeOf(layout, id);
  if (!place) return { up: null, down: null, indent: null, outdent: null };
  const siblings = layout.get(place.parent) ?? [];
  const above = place.position > 1 ? siblings[place.position - 2] : null;
  const parent = place.parent !== TOP ? placeOf(layout, place.parent) : null;
  return {
    up: place.position > 1 ? { parent: place.parent, position: place.position - 1 } : null,
    down: place.position < siblings.length ? { parent: place.parent, position: place.position + 1 } : null,
    indent: above != null ? { parent: above, position: null } : null,
    outdent: parent ? { parent: parent.parent, position: parent.position + 1 } : null,
  };
}
