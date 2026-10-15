import "server-only";
import { sql } from "drizzle-orm";
import type { RuleScope, ScopedPricingRule } from "@core/config";
import { isStoreTermScope, storeTermsPrice } from "@core/config";
import type { PlanItem, StoreTermRef } from "@core/core-spine";
import { db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { storeIndex } from "@/server/db/schema";
import { demoMode, storeClient, storeReady } from "@/server/collections/store";
import { skuKey } from "@/lib/skus";

/**
 * A product's place in the STORE's own categories and brands, for the margin
 * rules scoped to one of them (RuleScope.storeCategory / storeBrand).
 *
 * No source knows where the shop files a product: the store index does
 * (store_index, one row per store product with its categories and brands,
 * kept fresh every few minutes), and the store's term trees give each term's
 * ancestors — a product filed under "Nike › Off-White" is in "Nike" too. Every
 * place that computes a price runs its products through withStoreTerms first
 * (the sync's planning, the drawer and the Vetrina's product sheet, the
 * Margins tab's coverage, the price audit, the Publisher and the rebuild), so
 * every screen agrees on which rule prices what.
 *
 * Read briefly cached, and never fatal. A failed read keeps the last good one
 * — the index's and each tree's, for the life of the process. With none to
 * keep, the product's store terms are UNKNOWN, which is not the same as none:
 * a "Nike" rule cannot tell that a product filed under "Nike › Off-White" is
 * its own, and the price computed without it is the general one. Such a
 * product is reported as uncertain (withStoreTermsChecked) — the sync holds
 * its price rather than write that one, the drawer flags it — but only when
 * some enabled rule could need what is missing, and only for a product the
 * engine prices from the market: a supplier's price never takes a store-term
 * rule anyway.
 */

/** A store-indexed product's own terms, by canonical SKU. */
export interface IndexedStoreTerms {
  sku: string;
  categories: number[];
  brands: number[];
}

export type StoreTaxonomy = "category" | "brand";

/** Each term's parent (0 or absent = top level), per taxonomy. */
export interface StoreTermParents {
  category: ReadonlyMap<number, number>;
  brand: ReadonlyMap<number, number>;
}

/** Where the terms are read from — the index and the store, or a stand-in in tests. */
export interface StoreTermsSource {
  readIndex(): Promise<IndexedStoreTerms[]>;
  /**
   * One taxonomy's tree: each term's parent. Throws when it cannot be read; a
   * shop without that taxonomy answers with an empty one.
   */
  readTree(taxonomy: StoreTaxonomy): Promise<ReadonlyMap<number, number>>;
}

/** The fields withStoreTerms reads and fills. */
export interface StoreTermCarrier {
  sku: string;
  /** Who prices it: only a market price (KicksDB, the default) takes a store-term rule. */
  source?: string;
  storeCategories?: StoreTermRef[];
  storeBrands?: StoreTermRef[];
}

/** Products with their store terms, and the SKUs (canonical) whose terms are not all known. */
export interface StoreTermsRead<T> {
  products: T[];
  /**
   * Products a store-term rule could price whose terms could not be read
   * whole: a price computed for them may miss its category's or brand's
   * margin. Never written by the sync; flagged where shown.
   */
  uncertain: Set<string>;
}

/**
 * Why a held product's price was not written — the plan row's reason, and
 * the Publisher's and the rebuild's per-product error.
 */
export const STORE_TERMS_HELD =
  "price held: the store's categories and brands could not be read, and a margin set on one of them may price this product";

/**
 * The run's note when it held some: said once however many steps held
 * products, so the report reads one sentence, not one per step.
 */
export const STORE_TERMS_HELD_NOTE =
  "Prices held for products a store category or brand margin may price: the store's categories and brands could not be read. Run the sync again shortly.";

/**
 * A held product's plan: none of its prices written. Every write that would
 * set a price becomes a skip with STORE_TERMS_HELD — but a locked size (its
 * price is the owner's, no rule's) is left alone, and an update that also
 * carries the feed's stock keeps the stock with the price dropped: the stock
 * the shop sells on is never held up by a margin. Returns the writes held.
 */
export function holdPlanPrices(items: PlanItem[]): number {
  let held = 0;
  for (const item of items) {
    if (item.locked) continue;
    if (item.action === "update") {
      if (item.proposedPrice == null) continue; // stock only already
      held += 1;
      if (item.stockQuantity !== undefined) {
        item.proposedPrice = null;
        continue;
      }
      item.action = "skip";
      item.reason = STORE_TERMS_HELD;
    } else if (item.action === "create") {
      held += 1;
      item.action = "skip";
      item.reason = STORE_TERMS_HELD;
    }
  }
  return held;
}

/** No tree is deeper than this; a longer chain is a cycle in bad data. */
const MAX_DEPTH = 32;

/** How long a read serves: a whole sync reads the index a few times, not once per step. */
const TTL_MS = 60_000;

/** How long a read that fell back (or found nothing to fall back on) serves before the store is asked again. */
const RETRY_MS = 5_000;

/**
 * Terms with every ancestor, each with its depth (0 = top level). A term the
 * tree does not know (deleted since the index read it) counts as top level.
 */
export function expandStoreTerms(own: readonly number[], parents: ReadonlyMap<number, number>): StoreTermRef[] {
  const depthOf = new Map<number, number>();
  for (const id of own) {
    if (!(id > 0) || depthOf.has(id)) continue;
    const chain = [id];
    const seen = new Set(chain);
    for (let p = parents.get(id) ?? 0; p > 0 && !seen.has(p) && chain.length <= MAX_DEPTH; p = parents.get(p) ?? 0) {
      seen.add(p);
      chain.push(p);
    }
    // chain = [term, parent, …, top]: the top is depth 0.
    chain.forEach((t, i) => depthOf.set(t, chain.length - 1 - i));
  }
  return [...depthOf].map(([id, depth]) => ({ id, depth })).sort((a, b) => a.depth - b.depth || a.id - b.id);
}

/** True when some enabled rule is scoped to a store term — otherwise nothing needs reading. */
export function needsStoreTerms(rules: readonly ScopedPricingRule[]): boolean {
  return rules.some((r) => r.enabled && isStoreTermScope(r.scope));
}

/** The taxonomies some enabled rule names a term of: what a product's terms must be known in. */
function taxonomiesNeeded(rules: readonly ScopedPricingRule[]): Record<StoreTaxonomy, boolean> {
  const enabled = rules.filter((r) => r.enabled);
  return {
    category: enabled.some((r) => r.scope.storeCategory != null),
    brand: enabled.some((r) => r.scope.storeBrand != null),
  };
}

type BySku = Map<string, { categories: number[]; brands: number[] }>;

interface View {
  /** Null: the index could not be read, and never has been. */
  bySku: BySku | null;
  /** Per taxonomy; null: its tree could not be read, and never has been. */
  parents: Record<StoreTaxonomy, ReadonlyMap<number, number> | null>;
}

const NO_PARENTS: ReadonlyMap<number, number> = new Map();
const UNKNOWN: View = { bySku: null, parents: { category: null, brand: null } };

/**
 * One store's terms, read through `source` and cached for `ttlMs` (a read
 * that had to fall back, for `retryMs` only). `blind` (the shop's: the
 * Vetrina on its demo shop) makes every product's terms unknown to the
 * pricing — the index then mirrors another shop than the one the prices
 * are written to — while skusUnder still lists the index's own.
 */
export function storeTermsCache(
  source: StoreTermsSource,
  opts: { ttlMs?: number; retryMs?: number; now?: () => number; blind?: () => boolean } = {},
) {
  const ttlMs = opts.ttlMs ?? TTL_MS;
  const retryMs = opts.retryMs ?? RETRY_MS;
  const now = opts.now ?? Date.now;
  const blind = opts.blind ?? (() => false);
  let current: { at: number; view: View; whole: boolean } | null = null;
  let loading: Promise<View> | null = null;
  // Bumped by forget(): a read started before it must not become `current`.
  let generation = 0;
  // The last good read of each part, kept for the process lifetime — forget()
  // only makes the next read ask again, never throws these away.
  let lastIndex: BySku | null = null;
  const lastTrees: Partial<Record<StoreTaxonomy, ReadonlyMap<number, number>>> = {};

  function warn(what: string, e: unknown): void {
    console.warn(`[store-terms] ${what} unreadable:`, e instanceof Error ? e.message : String(e));
  }

  async function load(gen: number): Promise<{ view: View; whole: boolean }> {
    let bySku: BySku | null;
    let whole = true;
    try {
      bySku = new Map();
      for (const row of await source.readIndex()) {
        const key = skuKey(row.sku);
        if (!key) continue;
        // Two store products under one SKU: the product is in both's terms.
        const held = bySku.get(key);
        if (held) {
          held.categories.push(...row.categories);
          held.brands.push(...row.brands);
        } else {
          bySku.set(key, { categories: [...row.categories], brands: [...row.brands] });
        }
      }
      if (gen === generation) lastIndex = bySku;
    } catch (e) {
      // The last good read, however old, prices better than none.
      warn("index", e);
      bySku = lastIndex;
      whole = false;
    }
    if (!bySku) return { view: UNKNOWN, whole: false };

    // Each tree costs a WooCommerce read: only when some product has a term
    // in it. Read apart, so a shop whose brands cannot be read still has its
    // categories' tree, and the other way round.
    const parents: View["parents"] = { category: NO_PARENTS, brand: NO_PARENTS };
    const values = [...bySku.values()];
    const wanted = (["category", "brand"] as const).filter((tax) =>
      values.some((t) => (tax === "category" ? t.categories : t.brands).length > 0),
    );
    const read = await Promise.allSettled(wanted.map((tax) => source.readTree(tax)));
    wanted.forEach((tax, i) => {
      const r = read[i];
      if (r.status === "fulfilled") {
        parents[tax] = r.value;
        if (gen === generation) lastTrees[tax] = r.value;
      } else {
        // The last tree read; without one, unknown — a parent's rule cannot
        // find its sub-terms' products, so those are held, not mispriced.
        warn(`${tax} tree`, r.reason);
        parents[tax] = lastTrees[tax] ?? null;
        whole = false;
      }
    });
    return { view: { bySku, parents }, whole };
  }

  async function view(): Promise<View> {
    if (current && now() - current.at < (current.whole ? ttlMs : retryMs)) return current.view;
    if (loading) return loading;
    const gen = generation;
    const read: Promise<View> = load(gen)
      .then(({ view: v, whole }) => {
        if (gen === generation) current = { at: now(), view: v, whole };
        return v;
      })
      .catch((e) => {
        // load() catches its reads; anything else is a bug, and still never
        // fails the pricing.
        warn("store terms", e);
        return current?.view ?? UNKNOWN;
      })
      .finally(() => {
        if (loading === read) loading = null;
      });
    loading = read;
    return read;
  }

  function termsOf(v: View, sku: string): Pick<StoreTermCarrier, "storeCategories" | "storeBrands"> | null {
    const own = v.bySku?.get(skuKey(sku));
    if (!own) return null;
    return {
      storeCategories: expandStoreTerms(own.categories, v.parents.category ?? NO_PARENTS),
      storeBrands: expandStoreTerms(own.brands, v.parents.brand ?? NO_PARENTS),
    };
  }

  /** Whether a store-term rule of `needed` taxonomies could price `p` by terms this view does not know. */
  function isUncertain(v: View, p: StoreTermCarrier, needed: Record<StoreTaxonomy, boolean>): boolean {
    if (!storeTermsPrice(p)) return false;
    // No index: no product's terms are known.
    if (!v.bySku) return true;
    const own = v.bySku.get(skuKey(p.sku));
    // Not filed anywhere the index knows: no store term to miss.
    if (!own) return false;
    return (
      (needed.category && own.categories.length > 0 && v.parents.category == null) ||
      (needed.brand && own.brands.length > 0 && v.parents.brand == null)
    );
  }

  async function checked<T extends StoreTermCarrier>(
    products: readonly T[],
    rules: readonly ScopedPricingRule[],
    listing = false,
  ): Promise<StoreTermsRead<T>> {
    if (products.length === 0 || !needsStoreTerms(rules)) return { products: [...products], uncertain: new Set() };
    const v = blind() && !listing ? UNKNOWN : await view();
    const needed = taxonomiesNeeded(rules);
    const uncertain = new Set<string>();
    const out = products.map((p) => {
      // A row without a SKU (bad data) has no terms to find — and must not
      // fail the pricing of the rest.
      if (typeof p.sku !== "string") return p;
      if (isUncertain(v, p, needed)) uncertain.add(skuKey(p.sku));
      const terms = termsOf(v, p.sku);
      return terms ? { ...p, ...terms } : p;
    });
    return { products: out, uncertain };
  }

  return {
    /**
     * The products, each with its store terms when the index holds its SKU
     * (copies; the originals are left alone), and the ones whose terms could
     * not be read whole (see StoreTermsRead.uncertain). Unchanged, none
     * uncertain, when no enabled rule is scoped to a store term.
     */
    withStoreTermsChecked: checked,

    /** withStoreTermsChecked's products only: for a screen that shows a price and flags nothing. */
    async withStoreTerms<T extends StoreTermCarrier>(
      products: readonly T[],
      rules: readonly ScopedPricingRule[],
    ): Promise<T[]> {
      return (await checked(products, rules)).products;
    },

    /**
     * The index's own terms, blind or not (the demo shop's, while the
     * Vetrina runs on it): for counting which of a term's products a margin
     * reaches, as the screen listing them does — never for a price.
     */
    async withListedTerms<T extends StoreTermCarrier>(
      products: readonly T[],
      rules: readonly ScopedPricingRule[],
    ): Promise<T[]> {
      return (await checked(products, rules, true)).products;
    },

    /**
     * Every SKU a store-term scope reaches — the term's own products and its
     * sub-terms' — whoever prices them: the SKUs a reprice after saving such
     * a rule walks. Empty when nothing can be read.
     */
    async skusUnder(scope: Pick<RuleScope, "storeCategory" | "storeBrand">): Promise<string[]> {
      if (!isStoreTermScope(scope)) return [];
      const v = await view();
      if (!v.bySku) return [];
      const out: string[] = [];
      for (const sku of v.bySku.keys()) {
        const terms = termsOf(v, sku)!;
        if (scope.storeCategory != null && !terms.storeCategories!.some((t) => t.id === scope.storeCategory)) continue;
        if (scope.storeBrand != null && !terms.storeBrands!.some((t) => t.id === scope.storeBrand)) continue;
        out.push(sku);
      }
      return out;
    },

    /**
     * The store terms a product will have once filed under these ids — a new
     * product the Publisher is about to create, which the index cannot hold
     * yet: each with its ancestors and depth. `categories` is the filing's
     * path, broadest first, so a category created by this very publish (not
     * in any tree read yet) still gets its place. {} when no enabled rule is
     * scoped to a store term; null when a tree some rule needs cannot be read
     * (the price is then held, never written without its margin).
     */
    async termsForFiling(
      own: { categories: readonly number[]; brands: readonly number[] },
      rules: readonly ScopedPricingRule[],
    ): Promise<Pick<StoreTermCarrier, "storeCategories" | "storeBrands"> | null> {
      if (!needsStoreTerms(rules)) return {};
      if (blind()) return null;
      const v = await view();
      const needed = taxonomiesNeeded(rules);
      const treeOf = async (tax: StoreTaxonomy, ids: readonly number[]) => {
        if (ids.length === 0) return NO_PARENTS;
        const held = v.parents[tax];
        // Read only when some indexed product is filed in this taxonomy: ask now.
        if (held != null && held !== NO_PARENTS) return held;
        return source.readTree(tax).catch((e) => {
          warn(`${tax} tree`, e);
          return lastTrees[tax] ?? null;
        });
      };
      const [catTree, brandTree] = await Promise.all([
        treeOf("category", own.categories),
        treeOf("brand", own.brands),
      ]);
      if ((needed.category && catTree == null) || (needed.brand && brandTree == null)) return null;
      // The filing's own path says each category's parent, the tree the rest.
      const catParents = new Map(catTree ?? NO_PARENTS);
      own.categories.forEach((id, i) => {
        if (i > 0) catParents.set(id, own.categories[i - 1]);
      });
      const leaf = own.categories.length > 0 ? [own.categories[own.categories.length - 1]] : [];
      return {
        storeCategories: expandStoreTerms(leaf, catParents),
        storeBrands: expandStoreTerms(own.brands, brandTree ?? NO_PARENTS),
      };
    },

    /**
     * Whether the terms `rules` need can all be read now: the index, and the
     * tree of each taxonomy a rule names (when some product is filed in it).
     * False on the demo shop.
     */
    async known(rules: readonly ScopedPricingRule[]): Promise<boolean> {
      if (blind()) return false;
      const v = await view();
      if (!v.bySku) return false;
      const needed = taxonomiesNeeded(rules);
      return !(needed.category && v.parents.category == null) && !(needed.brand && v.parents.brand == null);
    },

    /** Drop the cached read: the next one asks the index (and the trees) again. The last good parts stay. */
    forget(): void {
      generation += 1;
      current = null;
      loading = null;
    },
  };
}

/* ---------------------------------------------------------------- *
 * The shop's own: the store index and the store's term trees
 * ---------------------------------------------------------------- */

const shopSource: StoreTermsSource = {
  async readIndex() {
    const res = await db.execute(sql`
      select ${storeIndex.sku} as "sku",
             jsonb_path_query_array(${storeIndex.categories}, '$[*].id') as "categories",
             jsonb_path_query_array(${storeIndex.brands}, '$[*].id') as "brands"
      from ${storeIndex}
      where ${storeIndex.sku} <> ''
    `);
    return rowsOf<{ sku: string; categories: unknown; brands: unknown }>(res).map((r) => ({
      sku: r.sku,
      categories: ids(r.categories),
      brands: ids(r.brands),
    }));
  },
  async readTree(taxonomy) {
    // No store to ask: every term read as top level.
    if (!storeReady()) return NO_PARENTS;
    // The store the index mirrors (the demo shop while the Vetrina runs on
    // it), its listings remembered a few minutes by the taxonomy cache. A
    // shop without brands answers with none (the client reads the missing
    // taxonomy as empty); a failed read throws, and the cache falls back.
    const client = await storeClient();
    return parentMap(taxonomy === "category" ? await client.listCategories() : await client.listBrands());
  },
};

function ids(raw: unknown): number[] {
  return Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
}

function parentMap(terms: readonly { id: number; parent?: number }[]): Map<number, number> {
  return new Map(terms.map((t) => [t.id, Number((t as { parent?: unknown }).parent ?? 0) || 0]));
}

// One per server process, like the other in-process caches (kept across
// hot reloads in development). Blind while the Vetrina runs on its demo shop:
// the index then mirrors the demo, not the shop the sync writes to.
const g = globalThis as { __storeHubStoreTermsV2?: ReturnType<typeof storeTermsCache> };
const shop = (g.__storeHubStoreTermsV2 ??= storeTermsCache(shopSource, { blind: demoMode }));

/** See storeTermsCache().withStoreTerms — the shop's store index and term trees. */
export function withStoreTerms<T extends StoreTermCarrier>(
  products: readonly T[],
  rules: readonly ScopedPricingRule[],
): Promise<T[]> {
  return shop.withStoreTerms(products, rules);
}

/** See storeTermsCache().withListedTerms — counts on the screen that lists a term's products. */
export function withListedTerms<T extends StoreTermCarrier>(
  products: readonly T[],
  rules: readonly ScopedPricingRule[],
): Promise<T[]> {
  return shop.withListedTerms(products, rules);
}

/** See storeTermsCache().withStoreTermsChecked — for whatever writes a price, or must flag one. */
export function withStoreTermsChecked<T extends StoreTermCarrier>(
  products: readonly T[],
  rules: readonly ScopedPricingRule[],
): Promise<StoreTermsRead<T>> {
  return shop.withStoreTermsChecked(products, rules);
}

/** withStoreTermsChecked over a map's values, keys kept. */
export async function withStoreTermsIn<K, T extends StoreTermCarrier>(
  products: ReadonlyMap<K, T>,
  rules: readonly ScopedPricingRule[],
): Promise<{ products: Map<K, T>; uncertain: Set<string> }> {
  const entries = [...products];
  const read = await withStoreTermsChecked(
    entries.map(([, p]) => p),
    rules,
  );
  return { products: new Map(entries.map(([k], i) => [k, read.products[i]])), uncertain: read.uncertain };
}

/** See storeTermsCache().termsForFiling — the shop's term trees. */
export function storeTermsForFiling(
  own: { categories: readonly number[]; brands: readonly number[] },
  rules: readonly ScopedPricingRule[],
): Promise<Pick<StoreTermCarrier, "storeCategories" | "storeBrands"> | null> {
  return shop.termsForFiling(own, rules);
}

/** See storeTermsCache().skusUnder. */
export function skusUnderStoreTerm(scope: Pick<RuleScope, "storeCategory" | "storeBrand">): Promise<string[]> {
  return shop.skusUnder(scope);
}

/** See storeTermsCache().known. */
export function storeTermsKnown(rules: readonly ScopedPricingRule[]): Promise<boolean> {
  return shop.known(rules);
}

/**
 * Forget the cached read — for a caller that just changed what the index or
 * the trees hold (a product moved to a category, a rule about to be applied)
 * and must price with it now rather than within the minute.
 */
export function forgetStoreTerms(): void {
  shop.forget();
}
