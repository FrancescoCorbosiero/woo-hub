import type { OrderSourceItem, SourceMatchSummary, UnmatchedItem } from "@/lib/vetrina/order-sources";
import { nameKey, skuKey } from "./format";

/**
 * An order source against the shop: which product each item is. By SKU
 * first — letters and digits only, any case ("dd1391 100" is DD1391-100) —
 * then by name, cautiously: the name the same once accents, case and
 * punctuation are set aside; or every word of it in only one product's name
 * ("Nike Dunk Low Panda" is "Nike Dunk Low Retro White Black Panda" when no
 * other product has all four words) — or, of several, in the only one with
 * no other word ("Air Jordan 1 Mid Olive Grey", not its "(GS)"). A name more
 * products fit is left out — a wrong product at the top is worse than one
 * missing. A product taken once is not
 * taken again. Pure: order-sources.test.ts pins it down.
 */

export interface MatchProduct {
  id: number;
  sku: string;
  /** As the shop shows it (entities decoded). */
  name: string;
}

export interface SourceMatch {
  /** The shop's products in the source's order, each once. */
  ranked: number[];
  /** Per item, the products it took (several for one SKU the shop has twice). */
  perItem: number[][];
  unmatched: UnmatchedItem[];
}

/** Codes shorter than this are not trusted to be one product's. */
const MIN_SKU = 4;
/** A name of fewer words than this matches only exactly. */
const MIN_WORDS = 2;

const words = (name: string) => [...new Set(nameKey(name).split(" ").filter(Boolean))];

/**
 * Match a source's items to the shop's products, given in the shop's order
 * (so that a SKU the shop has twice takes its products in that order).
 */
export function matchSource(items: readonly OrderSourceItem[], products: readonly MatchProduct[]): SourceMatch {
  const bySku = new Map<string, number[]>();
  const byName = new Map<string, number[]>();
  const postings = new Map<string, number[]>();
  const wordCount = new Map<number, number>();
  for (const p of products) {
    const sku = skuKey(p.sku ?? "");
    if (sku.length >= MIN_SKU) bySku.set(sku, [...(bySku.get(sku) ?? []), p.id]);
    const key = nameKey(p.name);
    byName.set(key, [...(byName.get(key) ?? []), p.id]);
    const ws = words(p.name);
    wordCount.set(p.id, ws.length);
    for (const w of ws) {
      const list = postings.get(w);
      if (list) list.push(p.id);
      else postings.set(w, [p.id]);
    }
  }

  // A word's products as a set, built once: a source of thousands of names asks for "nike" thousands of times.
  const sets = new Map<string, Set<number>>();
  const setOf = (w: string) => {
    let s = sets.get(w);
    if (!s) sets.set(w, (s = new Set(postings.get(w) ?? [])));
    return s;
  };
  const taken = new Set<number>();
  const free = (ids: readonly number[] | undefined) => (ids ?? []).filter((id) => !taken.has(id));

  /** The products a code is: itself, or a code written inside a name ("Nike Dunk Low (DD1391-100)"). */
  function bySkuOf(item: OrderSourceItem): number[] {
    if (item.sku) {
      const ids = free(bySku.get(skuKey(item.sku)));
      if (ids.length > 0) return ids;
    }
    for (const token of (item.name ?? "").split(/[\s()[\],;|]+/)) {
      if (!/\d/.test(token) || token.length < 6) continue;
      const ids = free(bySku.get(skuKey(token)));
      if (ids.length > 0) return ids;
    }
    return [];
  }

  /** The product a name is, or why none: "none" or "ambiguous". */
  function byNameOf(text: string): number[] | "none" | "ambiguous" {
    const exact = free(byName.get(nameKey(text)));
    if (exact.length > 0) return exact;
    const ws = words(text);
    if (ws.length < MIN_WORDS) return "none";
    // The rarest word's products first: the fewest to check.
    const ordered = [...ws].sort((a, b) => (postings.get(a)?.length ?? 0) - (postings.get(b)?.length ?? 0));
    const first = postings.get(ordered[0]) ?? [];
    if (first.length === 0) return "none";
    const rest = ordered.slice(1).map(setOf);
    const candidates = free(first.filter((id) => rest.every((s) => s.has(id))));
    if (candidates.length === 0) return "none";
    if (candidates.length === 1) return candidates;
    // Several have every word: only one with no other word is it ("… Olive Grey", not "… Olive Grey (GS)");
    // otherwise the name is too short to tell them apart ("Nike Dunk Low").
    const same = candidates.filter((id) => wordCount.get(id) === ws.length);
    return same.length === 1 ? same : "ambiguous";
  }

  const ranked: number[] = [];
  const perItem: number[][] = [];
  const unmatched: UnmatchedItem[] = [];
  items.forEach((item, i) => {
    let ids = bySkuOf(item);
    let ambiguous = false;
    if (ids.length === 0) {
      // A code no product has may still be a model's name ("Gel-1130"): tried as one.
      const text = item.name ?? item.sku ?? "";
      const found = text ? byNameOf(text) : "none";
      if (found === "ambiguous") ambiguous = true;
      else if (found !== "none") ids = found;
    }
    perItem.push(ids);
    if (ids.length === 0) {
      unmatched.push({ position: i + 1, sku: item.sku, name: item.name, ambiguous });
      return;
    }
    for (const id of ids) {
      taken.add(id);
      ranked.push(id);
    }
  });
  return { ranked, perItem, unmatched };
}

/** How many of the unmatched items a summary lists. */
const SHOWN_UNMATCHED = 30;

/** A match as the screens and the API show it. */
export function matchSummary(items: readonly OrderSourceItem[], match: SourceMatch): SourceMatchSummary {
  return {
    items: items.length,
    matched: items.length - match.unmatched.length,
    unmatched: match.unmatched.slice(0, SHOWN_UNMATCHED),
    unmatchedCount: match.unmatched.length,
  };
}
