"use client";

import * as React from "react";
import { skuKey } from "@/lib/skus";
import type { ProductCard } from "@/lib/vetrina/types";
import { loadVetrinaCards } from "@/server/actions/vetrina";

/** Cards asked for in one request at most. */
const BATCH = 100;

export interface SectionCards {
  cards: ReadonlyMap<number, ProductCard>;
  /** Locked prices per SKU key: a row shows its lock. */
  locks: Readonly<Record<string, number>>;
  /** Cards (and their locks) read elsewhere: a fresh rail, another automatic order. */
  absorb: (more: ProductCard[], moreLocks: Record<string, number>) => void;
  /** One card read again: its prices changed. */
  refresh: (id: number) => void;
  /** The product's sheet locked or unlocked sizes. */
  setLock: (sku: string, count: number) => void;
}

/**
 * The section editor's product cards and the price locks they carry: those
 * the section came with, then those `wanted` — rows scrolled into view or
 * brought in by a change, hidden products — each asked for once, so a
 * failing request cannot loop.
 */
export function useSectionCards(
  initial: { cards: readonly ProductCard[]; locks: Record<string, number> },
  wanted: readonly number[],
): SectionCards {
  const [cards, setCards] = React.useState<ReadonlyMap<number, ProductCard>>(() => new Map(initial.cards.map((c) => [c.id, c])));
  const [locks, setLocks] = React.useState<Readonly<Record<string, number>>>(initial.locks);

  const absorb = React.useCallback((more: ProductCard[], moreLocks: Record<string, number>) => {
    setCards((prev) => {
      const next = new Map(prev);
      for (const c of more) next.set(c.id, c);
      return next;
    });
    setLocks((prev) => ({ ...prev, ...moreLocks }));
  }, []);

  const read = React.useCallback(
    (ids: number[]) => {
      for (let i = 0; i < ids.length; i += BATCH) {
        void loadVetrinaCards({ ids: ids.slice(i, i + BATCH) }).then((res) => {
          if (res.ok) absorb(res.data.cards, res.data.locks);
        });
      }
    },
    [absorb],
  );

  // A string, so the effect runs when the wanted rows change, not on every render (a new array each time).
  const requested = React.useRef(new Set<number>());
  const wantedKey = [...new Set(wanted)].join(",");
  React.useEffect(() => {
    if (!wantedKey) return;
    const missing = wantedKey
      .split(",")
      .map(Number)
      .filter((id) => !cards.has(id) && !requested.current.has(id));
    for (const id of missing) requested.current.add(id);
    read(missing);
  }, [wantedKey, cards, read]);

  const refresh = React.useCallback((id: number) => read([id]), [read]);
  const setLock = React.useCallback((sku: string, count: number) => setLocks((prev) => ({ ...prev, [skuKey(sku)]: count })), []);

  return { cards, locks, absorb, refresh, setLock };
}
