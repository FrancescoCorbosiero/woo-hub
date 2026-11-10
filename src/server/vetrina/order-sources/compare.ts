import "server-only";
import { PRICE_GAP_PERCENT, type ComparedItem, type OrderSourceItem, type SourceComparison, type SourcePairs } from "@/lib/vetrina/order-sources";
import { getAnyBySkus } from "@/server/catalog/repo";
import { getActiveConfig } from "@/server/config/repo";
import { words } from "@/server/vetrina/operations/words";
import { VetrinaError } from "@/server/vetrina/source";
import { candidatePool, catalogSpellings, compareItems, nameCandidates } from "./compare-model";
import { pairKey } from "./match";
import * as repo from "./repo";
import { getSource, matchAgainst, shopForMatching } from "./service";

/**
 * A source against the shop, item by item (docs/order-sources.md, "Il
 * confronto"): which product each item is — matched, paired by hand, one of
 * several, none — its price on the other site against the shop's, beyond a
 * threshold (2%: not the cents), and, for an item the shop lacks, whether the
 * Hub's catalog has it (Publish can make it). Read each time it is asked: the
 * shop's price is the index's — the cheapest size's, a sale's when on sale —
 * as the storefront shows it.
 */

/** Which of these items (by index) the Hub's catalog has, by SKU — KicksDB verified, or the supplier's feed. */
async function inCatalogOf(items: readonly OrderSourceItem[], indexes: readonly number[]): Promise<Set<number>> {
  const spellings = new Map<number, string[]>();
  for (const i of indexes) {
    const sku = items[i]?.sku;
    if (sku) spellings.set(i, catalogSpellings(sku));
  }
  if (spellings.size === 0) return new Set();
  const market = (await getActiveConfig()).source.market;
  const found = await getAnyBySkus(market, [...new Set([...spellings.values()].flat())]);
  return new Set([...spellings].filter(([, keys]) => keys.some((k) => found.has(k))).map(([i]) => i));
}

/** The comparison of a source with the shop, now. */
export async function compareSource(id: string, opts: { threshold?: number } = {}): Promise<SourceComparison> {
  const threshold = opts.threshold ?? PRICE_GAP_PERCENT;
  const [row, facts] = await Promise.all([getSource(id), shopForMatching()]);
  const match = matchAgainst(row.items, facts, row.pairs);
  const missing = row.items.flatMap((_, i) => ((match.perItem[i] ?? []).length === 0 ? [i] : []));
  const inCatalog = await inCatalogOf(row.items, missing);
  return {
    source: { id: row.id, name: row.name, origin: row.origin },
    threshold,
    ...compareItems(row.items, facts, match, row.pairs, { threshold, inCatalog }),
  };
}

/**
 * One item's candidates: the shop's products whose names come closest — what
 * the comparison names for its first uncertain and missing items only
 * (CANDIDATE_ITEMS), asked for any other when its pairing opens.
 */
export async function itemCandidates(id: string, position: number): Promise<ComparedItem["candidates"]> {
  const [row, facts] = await Promise.all([getSource(id), shopForMatching()]);
  const item = row.items[position - 1];
  if (!item) throw new VetrinaError("invalid", words().source.itemGone, 400);
  return nameCandidates(new Map([[0, item.name ?? item.sku ?? ""]]), candidatePool(facts)).get(0) ?? [];
}

/**
 * An item paired by hand: with a product of the shop (its id), with none
 * (null: "not in the shop" — a name that fitted the wrong product), or left
 * to the matcher again (undefined). A product is one item's: paired here, it
 * is no other item's pair.
 */
export async function pairItem(id: string, position: number, productId: number | null | undefined): Promise<SourceComparison> {
  const row = await getSource(id);
  const item = row.items[position - 1];
  if (!item) throw new VetrinaError("invalid", words().source.itemGone, 400);
  if (productId != null) {
    const facts = await shopForMatching();
    if (!facts.some((f) => f.id === productId && f.status !== "trash")) throw new VetrinaError("invalid", words().source.productGone, 400);
  }
  const key = pairKey(item);
  const pairs: SourcePairs = Object.fromEntries(
    Object.entries(row.pairs ?? {}).filter(([k, v]) => k !== key && (productId == null || v !== productId)),
  );
  if (productId !== undefined) pairs[key] = productId;
  if (!(await repo.setSourcePairs(id, pairs))) throw new VetrinaError("not_found", words().source.gone, 404);
  return compareSource(id);
}
