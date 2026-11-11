import "server-only";
import type { SourceLike } from "@/server/kicks/service";
import { getAnyBySkus } from "@/server/catalog/repo";
import { growCatalogFromSkus } from "@/server/catalog/service";
import { dbCatalogStore } from "@/server/catalog/store";
import { catalogSpellings } from "@/server/vetrina/order-sources/compare-model";

/**
 * Codes the owner asked for, joined to the Hub's catalog before they are
 * published: each the catalog has already (as written, or with its spaces
 * as dashes) is taken as it is; each it lacks is confirmed on KicksDB first
 * and joins it. Publish then reads them from the catalog — the one path a
 * product takes from a source to the shop, whoever asked for it ("Aggiungi
 * prodotti", the compare screen's import).
 */
export interface CatalogJoin {
  /** Each code found, with the catalog's own key for it. */
  resolved: Map<string, string>;
  /** KicksDB answered: no such product — asking again changes nothing. */
  notFound: string[];
  /** KicksDB did not answer — asking again is the fix. */
  unreachable: string[];
}

/** `kicksdb` null: no KicksDB account, so a code the catalog lacks is not found. */
export async function joinCatalog(asked: readonly string[], market: string, kicksdb: SourceLike | null): Promise<CatalogJoin> {
  const known = await getAnyBySkus(market, [...new Set(asked.flatMap(catalogSpellings))]);
  const resolved = new Map<string, string>();
  const unknown: string[] = [];
  for (const sku of asked) {
    const hit = catalogSpellings(sku).find((k) => known.has(k));
    if (hit) resolved.set(sku, hit);
    else unknown.push(sku);
  }

  const notFound: string[] = [];
  const unreachable: string[] = [];
  if (unknown.length === 0) return { resolved, notFound, unreachable };
  if (!kicksdb) return { resolved, notFound: unknown, unreachable };

  const growth = await growCatalogFromSkus(kicksdb, dbCatalogStore, unknown, market);
  for (const j of growth.joined) resolved.set(j.requested, j.sku);
  notFound.push(...growth.rejected);
  unreachable.push(...growth.failed.map((f) => f.sku));
  // Asked twice in two spellings, or already there under another: what the catalog has, by now.
  const late = unknown.filter((s) => !resolved.has(s) && !growth.rejected.includes(s) && !growth.failed.some((f) => f.sku === s));
  if (late.length > 0) {
    const again = await getAnyBySkus(market, late.flatMap(catalogSpellings));
    for (const sku of late) {
      const hit = catalogSpellings(sku).find((k) => again.has(k));
      if (hit) resolved.set(sku, hit);
      else notFound.push(sku);
    }
  }
  return { resolved, notFound, unreachable };
}
