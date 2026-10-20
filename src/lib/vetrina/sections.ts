import { railTaxonomy } from "./catalog";
import { RAIL_LISTS, type RailFallback, type RailList, type RailSource, type RailSummary } from "./types";

/**
 * A homepage's sections as sections: what each one shows, and their order on
 * the page — the rules golden-hive-blocks 5.15.0 applies when the Vetrina
 * adds a section, takes one away, puts them in another order or points one
 * at something else. Pure module: the screens and the server share it.
 */

/** What the site's plugin reports for each part of it (/homepage's features). */
export const SECTION_FEATURES = {
  source: "rail-source",
  switchOff: "rail-hidden",
  add: "layout-insert",
  remove: "layout-remove",
  move: "layout-arrange",
} as const;

export type SectionFeature = keyof typeof SECTION_FEATURES;

/** The site's plugin can do it (an older one reports none of these). */
export function siteCan(features: readonly string[], what: SectionFeature): boolean {
  return features.includes(SECTION_FEATURES[what]);
}

export function isRailList(value: string): value is RailList {
  return (RAIL_LISTS as readonly string[]).includes(value);
}

/**
 * What a section shows now, as a write would name it: its one category or
 * brand, or the shop-wide list it is. Null for what a write cannot name — a
 * fixed list of products, a tag, several categories at once.
 */
export function railSourceOf(rail: Pick<RailSummary, "taxonomy" | "terms" | "atts">): RailSource | null {
  const taxonomy = railTaxonomy(rail.taxonomy);
  if (taxonomy) return rail.terms.length === 1 ? { taxonomy, slug: rail.terms[0].slug } : null;
  if (rail.atts.ids || rail.atts.tag || rail.atts.category || rail.atts.brand) return null;
  const type = (rail.atts.type ?? "").trim().toLowerCase() || "recent";
  return isRailList(type) ? { list: type } : null;
}

/** The plugin's name for what a section shows — its key, without the "#n" telling equal ones apart. */
export function sourceKey(source: RailSource): string {
  return "list" in source ? `type:${source.list}` : `${source.taxonomy}:${source.slug}`;
}

/**
 * The automatic order a section showing this falls back to when it names
 * none (golden-hive-blocks' ghb_hub_default_fallback): a category's or a
 * brand's own order, the best sellers by sales, a shop-wide list by date.
 */
export function defaultFallbackFor(source: RailSource): RailFallback {
  if (!("list" in source)) return "menu_order";
  if (source.list === "best_selling") return "popularity";
  if (source.list === "top_rated") return "rating";
  return "date";
}

export function sameSource(a: RailSource | null, b: RailSource | null): boolean {
  return a != null && b != null && sourceKey(a) === sourceKey(b);
}

/** A section's key without its "#n": what it shows. */
export function keyBase(key: string): string {
  const hash = key.lastIndexOf("#");
  return hash < 0 ? key : key.slice(0, hash);
}

/**
 * The sections' keys with one moved by `delta` places (−1: up, +1: down);
 * null when it cannot go further.
 */
export function moveKey(keys: readonly string[], key: string, delta: number): string[] | null {
  const from = keys.indexOf(key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= keys.length || delta === 0) return null;
  const next = keys.slice();
  next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}

/**
 * The keys the sections will have once arranged in `order`: a key's "#n"
 * counts the sections showing the same thing above it, so two of them
 * swapping places swap numbers. old key → new key.
 */
export function keysAfterArrange(order: readonly string[]): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const key of order) {
    const base = keyBase(key);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(key, `${base}#${n}`);
  }
  return out;
}
