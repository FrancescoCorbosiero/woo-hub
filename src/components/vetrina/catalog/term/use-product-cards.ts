"use client";

import * as React from "react";
import { CATALOG_PAGE_MAX } from "@/lib/vetrina/catalog";
import type { ProductCard } from "@/lib/vetrina/types";
import { loadVetrinaCards } from "@/server/actions/vetrina";

/**
 * The store's own product cards for the rows a list shows: the shop's
 * thumbnail size and its live price, never the full photo. One request per
 * batch of rows (at most 100), as the section editor does; each product is
 * asked for once, so a failing request cannot loop. The map is kept across
 * queries: a chip tapped back and forth does not fetch the same cards again.
 */
export function useProductCards(ids: readonly number[]): {
  cards: ReadonlyMap<number, ProductCard>;
  /** Read one card again (its prices changed). */
  refresh: (id: number) => void;
  /** Read these cards again (an action changed their prices), a batch per request. */
  refreshMany: (ids: readonly number[]) => void;
} {
  const [cards, setCards] = React.useState<ReadonlyMap<number, ProductCard>>(() => new Map());
  const requested = React.useRef(new Set<number>());

  const absorb = React.useCallback((more: ProductCard[]) => {
    if (more.length === 0) return;
    setCards((prev) => {
      const next = new Map(prev);
      for (const card of more) next.set(card.id, card);
      return next;
    });
  }, []);

  const fetchCards = React.useCallback(
    (batch: number[]) => {
      // A batch that fails leaves its rows on the neutral placeholder.
      loadVetrinaCards({ ids: batch })
        .then((res) => {
          if (res.ok) absorb(res.data.cards);
        })
        .catch(() => undefined);
    },
    [absorb],
  );

  // A string, so the effect runs when the rows change, not on every render (a new array each time).
  const shown = ids.join(",");
  React.useEffect(() => {
    if (!shown) return;
    const missing = shown
      .split(",")
      .map(Number)
      .filter((id) => !requested.current.has(id));
    for (const id of missing) requested.current.add(id);
    for (let i = 0; i < missing.length; i += CATALOG_PAGE_MAX) fetchCards(missing.slice(i, i + CATALOG_PAGE_MAX));
  }, [shown, fetchCards]);

  const refresh = React.useCallback((id: number) => fetchCards([id]), [fetchCards]);
  const refreshMany = React.useCallback(
    (again: readonly number[]) => {
      for (let i = 0; i < again.length; i += CATALOG_PAGE_MAX) fetchCards(again.slice(i, i + CATALOG_PAGE_MAX));
    },
    [fetchCards],
  );

  return { cards, refresh, refreshMany };
}
