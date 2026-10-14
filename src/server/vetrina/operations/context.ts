import "server-only";
import {
  MAX_OPERATION_PRODUCTS,
  MAX_TERM_PRODUCTS,
  type OperationInput,
  type OperationTarget,
  type TermKey,
} from "@/lib/vetrina/catalog-ops";
import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import type { IndexRow } from "@/server/collections/index-rows";
import { readIndexRowsById } from "@/server/collections/repo";
import { readCatalogTrees, resolveQueryTarget, type CatalogTrees } from "@/server/vetrina/catalog";
import { VetrinaError } from "@/server/vetrina/source";
import { words } from "./words";

/**
 * What an action acts on, resolved: a list of products in order — the ids
 * given, or every product a catalog query matches now — never more than
 * MAX_OPERATION_PRODUCTS; and around them the store's term trees, for names.
 */

export interface ResolvedTarget {
  ids: number[];
  trees: CatalogTrees;
}

export async function resolveTarget(target: OperationTarget, opts: { wholeTerm?: boolean } = {}): Promise<ResolvedTarget> {
  if (target.kind === "ids") {
    const ids = [...new Set(target.ids)];
    if (ids.length > MAX_OPERATION_PRODUCTS) throw new VetrinaError("invalid", words().error.tooMany(ids.length), 400);
    return { ids, trees: await readCatalogTrees() };
  }
  // A whole term's own hide or sale cannot be narrowed: it takes the term, however big (MAX_TERM_PRODUCTS).
  const cap = opts.wholeTerm ? MAX_TERM_PRODUCTS : MAX_OPERATION_PRODUCTS;
  const { ids, total, trees } = await resolveQueryTarget(target.query, cap);
  if (total > cap) throw new VetrinaError("invalid", opts.wholeTerm ? words().error.termTooBig(total) : words().error.tooMany(total), 400);
  return { ids, trees };
}

/** A whole term's own action (its key set; input.ts holds its target to the whole term): no cap of a selection's. */
export function wholeTermAction(input: OperationInput): boolean {
  return (input.kind === "hide" || input.kind === "sale" || input.kind === "unsale") && input.termKey != null;
}

/** These products' index rows in this order, and the ids the index does not hold (gone from the shop). */
export async function rowsInOrder(ids: readonly number[]): Promise<{ rows: IndexRow[]; missing: number[] }> {
  const byId = new Map((await readIndexRowsById([...ids])).map((r) => [r.id, r]));
  const rows: IndexRow[] = [];
  const missing: number[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row) rows.push(row);
    else missing.push(id);
  }
  return { rows, missing };
}

export function parseTermKey(key: string): { taxonomy: CatalogTaxonomy; id: number } | null {
  const m = /^(category|brand):([1-9]\d{0,9})$/.exec(key);
  return m ? { taxonomy: m[1] as CatalogTaxonomy, id: Number(m[2]) } : null;
}

export const termKeyOf = (taxonomy: CatalogTaxonomy, id: number): TermKey => `${taxonomy}:${id}`;

/** A whole term's name, for the log's labels; refused when the store no longer has it. */
export function termName(trees: CatalogTrees, key: TermKey): string {
  const term = parseTermKey(key);
  const name = term ? trees[term.taxonomy].terms.get(term.id)?.name : undefined;
  if (!name) throw new VetrinaError("not_found", words().error.termGone, 404);
  return name;
}

/**
 * At most `limit` calls at once, results in order. A call that fails stops
 * the rest from starting, and the failure comes back only once the calls
 * under way have ended: nothing of a failed run is still writing when the
 * next action starts.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;
  const worker = async () => {
    while (!failure && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw (failure as { error: unknown }).error;
  return out;
}

export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
