import "server-only";
import { sql } from "drizzle-orm";
import type { RuleScope, ScopedPricingRule } from "@core/config";
import { isStoreTermScope } from "@core/config";
import type { StoreTermRef } from "@core/core-spine";
import { db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { storeIndex } from "@/server/db/schema";
import { storeClient, storeReady } from "@/server/collections/store";
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
 * Margins tab's coverage, the Publisher and the rebuild), so every screen
 * agrees on which rule prices what.
 *
 * Read briefly cached, and never fatal: a failed read keeps the last good one;
 * with none, the products go unchanged — no store terms, so no store-term
 * rule matches, and every other rule prices them as before.
 */

/** A store-indexed product's own terms, by canonical SKU. */
export interface IndexedStoreTerms {
  sku: string;
  categories: number[];
  brands: number[];
}

/** Each term's parent (0 or absent = top level), per taxonomy. */
export interface StoreTermParents {
  category: ReadonlyMap<number, number>;
  brand: ReadonlyMap<number, number>;
}

/** Where the terms are read from — the index and the store, or a stand-in in tests. */
export interface StoreTermsSource {
  readIndex(): Promise<IndexedStoreTerms[]>;
  readParents(): Promise<StoreTermParents>;
}

/** The fields withStoreTerms fills. */
export interface StoreTermCarrier {
  sku: string;
  storeCategories?: StoreTermRef[];
  storeBrands?: StoreTermRef[];
}

/** No tree is deeper than this; a longer chain is a cycle in bad data. */
const MAX_DEPTH = 32;

/** How long a read serves: a whole sync reads the index a few times, not once per step. */
const TTL_MS = 60_000;

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

interface View {
  bySku: Map<string, { categories: number[]; brands: number[] }>;
  parents: StoreTermParents;
}

const NO_PARENTS: StoreTermParents = { category: new Map(), brand: new Map() };

/** One store's terms, read through `source` and cached for `ttlMs`. */
export function storeTermsCache(source: StoreTermsSource, opts: { ttlMs?: number; now?: () => number } = {}) {
  const ttlMs = opts.ttlMs ?? TTL_MS;
  const now = opts.now ?? Date.now;
  let current: { at: number; view: View } | null = null;
  let loading: Promise<View | null> | null = null;
  // Bumped by forget(): a read started before it must not become `current`.
  let generation = 0;

  async function load(): Promise<View> {
    const rows = await source.readIndex();
    const bySku: View["bySku"] = new Map();
    for (const row of rows) {
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
    let parents = NO_PARENTS;
    // The trees cost a WooCommerce read: only when some product has a term.
    if ([...bySku.values()].some((t) => t.categories.length > 0 || t.brands.length > 0)) {
      try {
        parents = await source.readParents();
      } catch (e) {
        // Without the trees, the last ones read; without those, each
        // product's own terms only — a parent's rule misses its sub-terms'
        // products until the store answers again.
        parents = current?.view.parents ?? NO_PARENTS;
        console.warn("[store-terms] term trees unreadable:", e instanceof Error ? e.message : String(e));
      }
    }
    return { bySku, parents };
  }

  async function view(): Promise<View | null> {
    if (current && now() - current.at < ttlMs) return current.view;
    if (loading) return loading;
    const gen = generation;
    const read: Promise<View | null> = load()
      .then((v) => {
        if (gen === generation) current = { at: now(), view: v };
        return v;
      })
      .catch((e) => {
        // The last good read, however old, prices better than none.
        console.warn("[store-terms] index unreadable:", e instanceof Error ? e.message : String(e));
        return current?.view ?? null;
      })
      .finally(() => {
        if (loading === read) loading = null;
      });
    loading = read;
    return read;
  }

  function termsOf(v: View, sku: string): Pick<StoreTermCarrier, "storeCategories" | "storeBrands"> | null {
    const own = v.bySku.get(skuKey(sku));
    if (!own) return null;
    return {
      storeCategories: expandStoreTerms(own.categories, v.parents.category),
      storeBrands: expandStoreTerms(own.brands, v.parents.brand),
    };
  }

  return {
    /**
     * The products, each with its store terms when the index holds its SKU
     * (copies; the originals are left alone). Unchanged when no enabled rule
     * is scoped to a store term, or when nothing can be read.
     */
    async withStoreTerms<T extends StoreTermCarrier>(
      products: readonly T[],
      rules: readonly ScopedPricingRule[],
    ): Promise<T[]> {
      if (products.length === 0 || !needsStoreTerms(rules)) return [...products];
      const v = await view();
      if (!v) return [...products];
      return products.map((p) => {
        const terms = termsOf(v, p.sku);
        return terms ? { ...p, ...terms } : p;
      });
    },

    /**
     * Every SKU a store-term scope reaches — the term's own products and its
     * sub-terms' — whoever prices them: the SKUs a reprice after saving such
     * a rule walks. Empty when nothing can be read.
     */
    async skusUnder(scope: Pick<RuleScope, "storeCategory" | "storeBrand">): Promise<string[]> {
      if (!isStoreTermScope(scope)) return [];
      const v = await view();
      if (!v) return [];
      const out: string[] = [];
      for (const sku of v.bySku.keys()) {
        const terms = termsOf(v, sku)!;
        if (scope.storeCategory != null && !terms.storeCategories!.some((t) => t.id === scope.storeCategory)) continue;
        if (scope.storeBrand != null && !terms.storeBrands!.some((t) => t.id === scope.storeBrand)) continue;
        out.push(sku);
      }
      return out;
    },

    /** Drop the cached read: the next one asks the index (and the trees) again. */
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
  async readParents() {
    // No store to ask: every term read as top level.
    if (!storeReady()) return NO_PARENTS;
    // The store the index mirrors (the demo shop while the Vetrina runs on
    // it), its listings remembered a few minutes by the taxonomy cache.
    const client = await storeClient();
    const [categories, brands] = await Promise.all([
      client.listCategories(),
      // A shop without brands — or whose brands cannot be read — still has its categories.
      client.listBrands().catch(() => []),
    ]);
    return { category: parentMap(categories), brand: parentMap(brands) };
  },
};

function ids(raw: unknown): number[] {
  return Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
}

function parentMap(terms: readonly { id: number; parent?: number }[]): Map<number, number> {
  return new Map(terms.map((t) => [t.id, Number((t as { parent?: unknown }).parent ?? 0) || 0]));
}

// One per server process, like the other in-process caches (kept across
// hot reloads in development).
const g = globalThis as { __storeHubStoreTerms?: ReturnType<typeof storeTermsCache> };
const shop = (g.__storeHubStoreTerms ??= storeTermsCache(shopSource));

/** See storeTermsCache().withStoreTerms — the shop's store index and term trees. */
export function withStoreTerms<T extends StoreTermCarrier>(
  products: readonly T[],
  rules: readonly ScopedPricingRule[],
): Promise<T[]> {
  return shop.withStoreTerms(products, rules);
}

/** withStoreTerms over a map's values, keys kept. */
export async function withStoreTermsIn<K, T extends StoreTermCarrier>(
  products: ReadonlyMap<K, T>,
  rules: readonly ScopedPricingRule[],
): Promise<Map<K, T>> {
  const entries = [...products];
  const priced = await withStoreTerms(
    entries.map(([, p]) => p),
    rules,
  );
  return new Map(entries.map(([k], i) => [k, priced[i]]));
}

/** See storeTermsCache().skusUnder. */
export function skusUnderStoreTerm(scope: Pick<RuleScope, "storeCategory" | "storeBrand">): Promise<string[]> {
  return shop.skusUnder(scope);
}

/**
 * Forget the cached read — for a caller that just changed what the index or
 * the trees hold (a product moved to a category, a rule about to be applied)
 * and must price with it now rather than within the minute.
 */
export function forgetStoreTerms(): void {
  shop.forget();
}
