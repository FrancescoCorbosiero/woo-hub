import "server-only";
import type { SourceProduct } from "@core/core-spine";
import type { SourceLike } from "@/server/kicks/service";
import { skuKey } from "@/lib/skus";

/**
 * What KicksDB answered about a code, for a while: "Aggiungi prodotti" asks
 * it once when the owner looks a code up, and the add a minute later takes
 * the answer from here instead of paying for the same call again. A "no such
 * product" is kept too (a shorter while): looking the same paste up twice
 * asks KicksDB nothing new.
 *
 * On globalThis: the look-up runs in a server action, the add in a route —
 * two bundles, each with its own copy of this module.
 */

const FOUND_MS = 30 * 60_000;
const MISSING_MS = 10 * 60_000;
/** Codes kept at most: the oldest go first. */
const LIMIT = 2_000;

interface Answer {
  product: SourceProduct | null;
  at: number;
}

const g = globalThis as { __storeHubKicksAnswers?: Map<string, Answer> };
const answers = (g.__storeHubKicksAnswers ??= new Map<string, Answer>());

const keyOf = (market: string, sku: string) => `${market.toUpperCase()}:${skuKey(sku)}`;

/** The answer kept for a code: the product, null for "no such product", undefined when not asked lately. */
export function recalled(market: string, sku: string, now = Date.now()): SourceProduct | null | undefined {
  const key = keyOf(market, sku);
  const answer = answers.get(key);
  if (!answer) return undefined;
  if (now - answer.at > (answer.product ? FOUND_MS : MISSING_MS)) {
    answers.delete(key);
    return undefined;
  }
  return answer.product;
}

export function remember(market: string, sku: string, product: SourceProduct | null, now = Date.now()): void {
  const key = keyOf(market, sku);
  answers.delete(key);
  answers.set(key, { product, at: now });
  while (answers.size > LIMIT) {
    const oldest = answers.keys().next().value;
    if (oldest === undefined) break;
    answers.delete(oldest);
  }
}

/** Forget every answer: the tests start clean. */
export function forgetAnswers(): void {
  answers.clear();
}

/**
 * The KicksDB source, answering from memory what it was asked lately — what
 * growCatalogFromSkus is handed by the add, so a code looked up a minute ago
 * joins the catalog without a second call.
 */
export function rememberingSource(source: SourceLike): SourceLike {
  return {
    getPricesBatch: (skus, market) => source.getPricesBatch(skus, market),
    getProduct: (query, market) => source.getProduct(query, market),
    async findBySku(sku, market) {
      const known = recalled(market, sku);
      if (known !== undefined) return known;
      const product = await source.findBySku(sku, market);
      remember(market, sku, product);
      return product;
    },
  };
}
