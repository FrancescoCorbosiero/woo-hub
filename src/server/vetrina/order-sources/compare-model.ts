import { skuKey as catalogKey } from "@/lib/skus";
import type { SourceProduct } from "@core/core-spine";
import type { ComparedItem, OrderSourceItem, SourceComparison, SourcePairs } from "@/lib/vetrina/order-sources";
import { decodeEntities } from "@/server/collections/index-rows";
import type { IndexFacts } from "@/server/collections/repo";
import { nameKey } from "./format";
import { pairKey, type SourceMatch } from "./match";

/**
 * The comparison's pure parts (compare.ts reads the shop and the catalog
 * around them; import.ts asks KicksDB): a price gap and the threshold, the
 * shop's products whose names come close to an item's, the comparison of
 * each item, and how close a KicksDB title is to a name.
 * compare-model.test.ts pins them down.
 */

/** Candidates named per item. */
const CANDIDATES = 3;
/**
 * Items a comparison names candidates for: the uncertain first, then the
 * missing, in the source's order. A source of 20 000 with 15 000 missing
 * would otherwise spend seconds of the server's one thread on suggestions
 * nobody reads; the rest are asked for one at a time (compare.ts,
 * itemCandidates), when an item's pairing opens.
 */
export const CANDIDATE_ITEMS = 300;
/** A name sharing less than this share of words with the item's is no candidate (shared words over all words). */
const MIN_SIMILARITY = 0.3;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The shop's price against the other site's, % to one decimal: positive when the shop asks more. Null when either is unknown. */
export function priceGap(ours: number | null | undefined, theirs: number | null | undefined): number | null {
  if (ours == null || theirs == null || !(ours > 0) || !(theirs > 0)) return null;
  // Under a cent is the same price.
  if (Math.abs(ours - theirs) < 0.005) return 0;
  // A gap that rounds to nothing is 0, never -0.
  return round1(((ours - theirs) / theirs) * 100) || 0;
}

/** Beyond the threshold, as the gap is shown (to one decimal): 2.04% is not "more than 2%". */
export const differs = (gap: number | null, threshold: number) => gap != null && Math.abs(gap) > threshold;

type Candidate = ComparedItem["candidates"][number];

/** The shop's products a candidate is chosen among: not the trashed, names as the shop shows them. */
export function candidatePool(facts: readonly IndexFacts[]): { id: number; sku: string; name: string }[] {
  return facts.filter((f) => f.status !== "trash").map((f) => ({ id: f.id, sku: f.sku, name: decodeEntities(f.name) }));
}

const wordsOf = (text: string) => [...new Set(nameKey(text).split(" ").filter(Boolean))];

/**
 * The shop's products whose names come closest to each text: the words they
 * share over all their words, best first, at most CANDIDATES. What an item
 * no product matched — or several did — offers to pair by hand.
 */
export function nameCandidates(
  texts: ReadonlyMap<number, string>,
  products: readonly { id: number; sku: string; name: string }[],
): Map<number, Candidate[]> {
  const postings = new Map<string, number[]>();
  const sizes: number[] = [];
  products.forEach((p, k) => {
    const ws = wordsOf(p.name);
    sizes.push(ws.length);
    for (const w of ws) {
      const list = postings.get(w);
      if (list) list.push(k);
      else postings.set(w, [k]);
    }
  });
  const out = new Map<number, Candidate[]>();
  for (const [at, text] of texts) {
    const ws = wordsOf(text);
    const shared = new Map<number, number>();
    for (const w of ws) for (const k of postings.get(w) ?? []) shared.set(k, (shared.get(k) ?? 0) + 1);
    out.set(
      at,
      [...shared]
        .map(([k, n]) => ({ k, score: n / (ws.length + sizes[k] - n) }))
        .filter((s) => s.score >= MIN_SIMILARITY)
        .sort((a, b) => b.score - a.score || a.k - b.k)
        .slice(0, CANDIDATES)
        .map(({ k }) => ({ id: products[k].id, sku: products[k].sku, name: products[k].name })),
    );
  }
  return out;
}

/**
 * The comparison itself, pure: the items, the shop as matched to them, the
 * pairs, the threshold, and which missing items (by index) the Hub's catalog
 * has.
 */
export function compareItems(
  items: readonly OrderSourceItem[],
  facts: readonly IndexFacts[],
  match: SourceMatch,
  pairs: SourcePairs | null | undefined,
  opts: { threshold: number; inCatalog: ReadonlySet<number>; candidates?: number },
): Pick<SourceComparison, "items" | "summary"> {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const ambiguousAt = new Set(match.unmatched.filter((u) => u.ambiguous).map((u) => u.position));
  // The items left without a product: the uncertain first, then the missing, at most CANDIDATE_ITEMS of them.
  const openAt = items.flatMap((_, i) => ((match.perItem[i] ?? []).length === 0 ? [i] : []));
  const chosen = [...openAt.filter((i) => ambiguousAt.has(i + 1)), ...openAt.filter((i) => !ambiguousAt.has(i + 1))].slice(
    0,
    opts.candidates ?? CANDIDATE_ITEMS,
  );
  const open = new Map(chosen.map((i) => [i, items[i].name ?? items[i].sku ?? ""]));
  const candidates = open.size > 0 ? nameCandidates(open, candidatePool(facts)) : new Map<number, Candidate[]>();

  const compared = items.map((item, i): ComparedItem => {
    const id = match.perItem[i]?.[0];
    const fact = id != null ? byId.get(id) : undefined;
    const pair = pairs?.[pairKey(item)];
    const price = item.price ?? null;
    if (fact) {
      const gap = priceGap(fact.price, price);
      return {
        position: i + 1,
        sku: item.sku,
        name: item.name,
        price,
        status: "matched",
        paired: pair === fact.id,
        product: { id: fact.id, sku: fact.sku, name: decodeEntities(fact.name), price: fact.price, onSale: fact.onSale, status: fact.status },
        gap,
        differs: differs(gap, opts.threshold),
        candidates: [],
        inCatalog: false,
      };
    }
    return {
      position: i + 1,
      sku: item.sku,
      name: item.name,
      price,
      status: ambiguousAt.has(i + 1) ? "ambiguous" : "missing",
      paired: pair === null,
      product: null,
      gap: null,
      differs: false,
      candidates: candidates.get(i) ?? [],
      inCatalog: opts.inCatalog.has(i),
    };
  });

  const matched = compared.filter((c) => c.status === "matched");
  const differing = matched.filter((c) => c.differs);
  const missing = compared.filter((c) => c.status === "missing");
  return {
    items: compared,
    summary: {
      items: compared.length,
      matched: matched.length,
      differ: differing.length,
      dearer: differing.filter((c) => (c.gap ?? 0) > 0).length,
      cheaper: differing.filter((c) => (c.gap ?? 0) < 0).length,
      missing: missing.length,
      importable: missing.filter((c) => c.inCatalog).length,
      ambiguous: compared.filter((c) => c.status === "ambiguous").length,
    },
  };
}

/** A SKU as the Hub's catalog may hold it: as written, and with its spaces as dashes ("DD1391 100" is DD1391-100). */
export function catalogSpellings(sku: string): string[] {
  const plain = catalogKey(sku);
  const dashed = plain.replace(/\s+/g, "-");
  return dashed === plain ? [plain] : [plain, dashed];
}

/** KicksDB's products offered per item. */
const MATCHES = 3;
/** A KicksDB title sharing less than this share of words with the item's name is not offered. */
const MIN_TITLE_SIMILARITY = 0.25;

/** The words two names share over all their words, 0–1. */
export function similarity(a: string, b: string): number {
  const wa = new Set(wordsOf(a));
  const wb = new Set(wordsOf(b));
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / (wa.size + wb.size - shared);
}

/** KicksDB's answers for a name, the closest first, those too far left out. */
export function closest(name: string, products: readonly SourceProduct[]): { product: SourceProduct; score: number }[] {
  const seen = new Set<string>();
  return products
    .filter((p) => p.sku && !seen.has(catalogKey(p.sku)) && seen.add(catalogKey(p.sku)))
    .map((product) => ({ product, score: Math.round(similarity(name, product.title) * 100) / 100 }))
    .filter((m) => m.score >= MIN_TITLE_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, MATCHES);
}
