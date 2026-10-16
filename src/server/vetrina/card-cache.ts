import type { ProductCard } from "@/lib/vetrina/types";

/**
 * Product cards (thumbnail, price, stock) as the site last answered them, by
 * product. A catalog list shows forty at a time and the owner comes back to
 * the same lists, so only cards not seen in the last ten minutes are asked
 * for. The Hub forgets a product's card as soon as it changes the product (an
 * action, a price published, a sync's write) or the store index learns of a
 * change made elsewhere; ↻ forgets them all.
 *
 * Kept apart from service.ts on purpose: the store index and the sync's
 * writes import it, and it imports nothing of theirs.
 */

export const CARD_TTL_MS = 10 * 60_000;
/** Past this many remembered cards, the expired ones are dropped on the next read. */
const PRUNE_AT = 5_000;

interface CardState {
  cards: Map<number, { card: ProductCard; at: number }>;
  /** When a product's card was last forgotten: a read that started before it does not put the old card back. */
  forgotten: Map<number, number>;
  forgotAll: number;
}

// One copy per process: the server actions and the scheduler's bundle each load their own copy of this module.
const g = globalThis as { __vetrinaCards?: CardState };
const state = () => (g.__vetrinaCards ??= { cards: new Map(), forgotten: new Map(), forgotAll: 0 });

/**
 * These products' cards, in the order asked: remembered ones as they are,
 * the rest from `fetch` (which may leave out a product the site no longer
 * has — it is not remembered, and asked for again next time).
 */
export async function cachedCards(
  ids: readonly number[],
  fetch: (ids: number[]) => Promise<ProductCard[]>,
  now: () => number = Date.now,
): Promise<ProductCard[]> {
  const s = state();
  const started = now();
  const wanted = [...new Set(ids)];
  const found = new Map<number, ProductCard>();
  const missing: number[] = [];
  for (const id of wanted) {
    const hit = s.cards.get(id);
    if (hit && started - hit.at < CARD_TTL_MS) found.set(id, hit.card);
    else missing.push(id);
  }
  if (missing.length > 0) {
    for (const card of await fetch(missing)) {
      found.set(card.id, card);
      // Forgotten while this read was on its way: the card may be from before the change, so it is not kept.
      if (started <= s.forgotAll || started <= (s.forgotten.get(card.id) ?? -Infinity)) continue;
      s.cards.set(card.id, { card, at: started });
    }
    if (s.cards.size > PRUNE_AT) prune(s, now());
  }
  return wanted.flatMap((id) => {
    const card = found.get(id);
    return card ? [card] : [];
  });
}

function prune(s: CardState, at: number): void {
  for (const [id, hit] of s.cards) if (at - hit.at >= CARD_TTL_MS) s.cards.delete(id);
  for (const [id, when] of s.forgotten) if (at - when >= CARD_TTL_MS) s.forgotten.delete(id);
}

/** These products changed, or — with no ids — anything may have: their cards are asked for again. */
export function forgetCards(ids?: Iterable<number>, now: () => number = Date.now): void {
  const s = state();
  const at = now();
  if (ids === undefined) {
    s.cards.clear();
    s.forgotten.clear();
    s.forgotAll = at;
    return;
  }
  for (const id of ids) {
    s.cards.delete(id);
    s.forgotten.set(id, at);
  }
}
