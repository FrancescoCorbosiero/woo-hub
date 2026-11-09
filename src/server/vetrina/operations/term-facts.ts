import "server-only";
import type { TermSnapshot, TermTaxonomy } from "@/lib/vetrina/term-ops";
import { termInMenus } from "@/server/api/menus";
import { decodeEntities } from "@/server/collections/index-rows";
import { collectionsByTerm } from "@/server/collections/service";
import { getActiveConfig } from "@/server/config/repo";
import { homepagePresence, termKey as presenceKey } from "@/server/vetrina/catalog";
import { VetrinaError } from "@/server/vetrina/source";
import type { StoreTermKind, WooClient } from "@/server/woo/client";
import { termKey } from "@/server/woo/term-aliases";
import { words } from "./words";

/**
 * What the taxonomy actions read about the store's terms (terms.ts,
 * term-moves.ts): a taxonomy's terms as they are now, which is under which,
 * and what else leans on a term — an automatic category's rule, a margin of
 * its own, a homepage section (each a reason not to merge or delete it) and
 * the site's menus (a warning: their item would lead nowhere).
 */

/** The REST collection of each taxonomy. */
export const REST: Record<TermTaxonomy, StoreTermKind> = { category: "categories", brand: "brands", tag: "tags" };

export interface LiveTerm {
  id: number;
  /** Entities decoded: "Saldi & Outlet". */
  name: string;
  slug: string;
  /** 0 at the top level (always, for a tag). */
  parent: number;
}

export type TermList = Map<number, LiveTerm>;

/** A taxonomy's terms as the store has them now (the cached list, dropped by every term write). */
export async function readTerms(client: WooClient, taxonomy: TermTaxonomy): Promise<TermList> {
  const rows: { id: number; name: string; slug: string; parent?: number }[] =
    taxonomy === "category" ? await client.listCategories() : taxonomy === "brand" ? await client.listBrands() : await client.listTags();
  return new Map(rows.map((t) => [t.id, { id: t.id, name: decodeEntities(t.name), slug: t.slug, parent: taxonomy === "tag" ? 0 : (t.parent ?? 0) }]));
}

/** A term of the list, or the refusal that it is gone. */
export function termIn(list: TermList, id: number, taxonomy: TermTaxonomy): LiveTerm {
  const term = list.get(id);
  if (!term) throw new VetrinaError("not_found", words().term.gone(taxonomy), 404);
  return term;
}

/** Its direct sub-terms. */
export const childrenIn = (list: TermList, id: number): number[] => [...list.values()].filter((t) => t.parent === id).map((t) => t.id);

/** A term and every term below it. */
export function descendantsIn(list: TermList, id: number): Set<number> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of list.values()) {
      if (!out.has(t.id) && out.has(t.parent)) {
        out.add(t.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Its ancestors, nearest first (a loop stops the walk). */
export function ancestorsIn(list: TermList, id: number): number[] {
  const out: number[] = [];
  const seen = new Set([id]);
  for (let p = list.get(id)?.parent ?? 0; p > 0 && !seen.has(p); p = list.get(p)?.parent ?? 0) {
    seen.add(p);
    out.push(p);
  }
  return out;
}

/** The term with this name under this parent, as WordPress compares names (without case); `self` aside. */
export function namedUnder(list: TermList, name: string, parent: number, self = 0): LiveTerm | undefined {
  const key = termKey(name);
  return [...list.values()].find((t) => t.id !== self && t.parent === parent && termKey(t.name) === key);
}

/** A term as an action found it, its description read live: enough to make it again. */
export async function snapshotOf(client: WooClient, taxonomy: TermTaxonomy, term: LiveTerm): Promise<TermSnapshot> {
  const description = await client
    .getStoreTerm(REST[taxonomy], term.id)
    .then((t) => t.description ?? "")
    .catch(() => "");
  return { id: term.id, name: term.name, slug: term.slug, parent: term.parent, description };
}

/** What else leans on a term. */
export interface TermTies {
  /** An automatic category's rule decides its products. */
  automatic: boolean;
  /** A margin of its own (a pricing rule scoped to it). */
  margin: boolean;
  /** The homepage sections showing exactly it, by title. */
  sections: string[];
  /** The site's menus with an item leading to it (null: not known — WordPress not connected or slow). */
  menus: string[] | null;
}

const within = <T>(ms: number, promise: Promise<T>, fallback: T): Promise<T> =>
  Promise.race([promise.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

/** Read side by side, each best-effort but the margin's (the config is the Hub's own). */
export async function tiesOf(taxonomy: TermTaxonomy, id: number): Promise<TermTies> {
  const nested = taxonomy !== "tag";
  const [collections, config, presence, menus] = await Promise.all([
    taxonomy === "category" ? collectionsByTerm().catch(() => ({}) as Record<number, unknown>) : Promise.resolve({} as Record<number, unknown>),
    getActiveConfig(),
    nested ? homepagePresence() : Promise.resolve(null),
    // The menus ask WordPress: a slow site leaves the warning out rather than the owner waiting.
    nested
      ? within(
          4_000,
          termInMenus({ kind: taxonomy, id }).then((found) => [...new Set(found.found.map((f) => f.menu))]),
          null,
        )
      : Promise.resolve([] as string[]),
  ]);
  const margin = config.pricingRules.some((r) => (taxonomy === "category" ? r.scope.storeCategory === id : taxonomy === "brand" && r.scope.storeBrand === id));
  const sections = nested && presence ? (presence.terms.get(presenceKey(taxonomy, id)) ?? []).map((s) => s.title) : [];
  return { automatic: id in collections, margin, sections, menus };
}

/** The refusal of taking a term away (merge, delete): the first tie that holds it, in the owner's words. */
export function removalRefusal(name: string, ties: TermTies): string | null {
  const w = words();
  if (ties.automatic) return w.error.automatic(name);
  if (ties.margin) return w.term.margin(name);
  if (ties.sections.length > 0) return w.term.homepage(name, ties.sections);
  return null;
}

/** Whether any of these terms carries a margin of its own (a move changes which margin the term's products take). */
export async function marginAmong(taxonomy: TermTaxonomy, ids: readonly number[]): Promise<boolean> {
  if (taxonomy === "tag" || ids.length === 0) return false;
  const config = await getActiveConfig();
  const wanted = new Set(ids);
  return config.pricingRules.some((r) => {
    const scoped = taxonomy === "category" ? r.scope.storeCategory : r.scope.storeBrand;
    return scoped != null && wanted.has(scoped);
  });
}
