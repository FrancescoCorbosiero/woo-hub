import "server-only";
import { blockConfig, hubConfig } from "@/config";
import { railCategory } from "@/lib/collections/rail";
import { railTaxonomy } from "@/lib/vetrina/catalog";
import type { HomepageSectionOption, OperationTarget } from "@/lib/vetrina/catalog-ops";
import type { RailSummary } from "@/lib/vetrina/types";
import { decodeEntities, type IndexRow } from "@/server/collections/index-rows";
import { collectionsByTerm } from "@/server/collections/service";
import { withDescendants, type CatalogTrees } from "@/server/vetrina/catalog";
import { readHome } from "@/server/vetrina/service";
import { resolveTarget, rowsInOrder } from "./context";

/**
 * The homepage's sections as "Metti in homepage" sees them: what fills each
 * one — which decides what pinning a product there does — and which
 * products it can show.
 */

/** The block every product section is (the editor's own, see server/vetrina/service.ts). */
const RAIL_BLOCK = "golden-hive/shortcode-wrapper";

type Rail = Pick<RailSummary, "taxonomy" | "terms"> & Partial<Pick<RailSummary, "atts">>;

/** What fills a section: one manual category, one automatic one, one brand, or anything else. */
export function sectionFill(rail: Rail, automatic: boolean): Pick<HomepageSectionOption, "fill" | "term"> {
  const category = railCategory(rail);
  const name = rail.terms[0] ? decodeEntities(rail.terms[0].name) : "";
  if (category != null) {
    return { fill: automatic ? "automatic" : "category", term: { taxonomy: "category", id: category, name } };
  }
  if (railTaxonomy(rail.taxonomy) === "brand" && rail.terms.length === 1) {
    return { fill: "brand", term: { taxonomy: "brand", id: rail.terms[0].id, name } };
  }
  return { fill: "other", term: null };
}

/**
 * What fills a section, for an action that writes into it: whether its
 * category is automatic is read for certain — never the homepage's
 * best-effort answer, which says "manual" when the rules cannot be read,
 * and a product added by hand to an automatic category fights its rule.
 */
export async function railFill(rail: Rail): Promise<Pick<HomepageSectionOption, "fill" | "term">> {
  const category = railCategory(rail);
  return sectionFill(rail, category != null && (await collectionsByTerm())[category] != null);
}

/** The owner may pin there: a section of a category, brand or tag (not a hand-picked list), and the config lets pins change. */
export function pinnable(rail: Pick<RailSummary, "editable">): boolean {
  return rail.editable && blockConfig(RAIL_BLOCK).edit.pins;
}

/**
 * Of these products, the ones the section can show, per the store index: in
 * its category or brand — sub-terms included, as the shop's own listings
 * are — or carrying its tag; for a shop-wide list (no term), any product, or
 * those on sale for the list of what is on sale.
 */
export function sectionMembers(rail: Rail, rows: readonly IndexRow[], trees: CatalogTrees): Set<number> {
  const ids = rail.terms.map((t) => t.id);
  const within = (children: CatalogTrees["category"]["children"]) => {
    const all = new Set<number>();
    for (const id of ids) for (const d of withDescendants(id, children)) all.add(d);
    return all;
  };
  let holds: (row: IndexRow) => boolean;
  switch (rail.taxonomy) {
    case "product_cat": {
      const all = within(trees.category.children);
      holds = (row) => row.categories.some((c) => all.has(c.id));
      break;
    }
    case "product_brand": {
      const all = within(trees.brand.children);
      holds = (row) => row.brands.some((b) => all.has(b.id));
      break;
    }
    case "product_tag":
      holds = (row) => row.tags.some((t) => ids.includes(t.id));
      break;
    default: {
      // A shop-wide list ([gh_product_rail type="…"]) names no term; a fixed list or a tag rail does.
      const atts = rail.atts ?? {};
      const list = rail.terms.length === 0 && !atts.ids && !atts.tag && !atts.category && !atts.brand ? (atts.type ?? "recent") : null;
      holds = list == null ? () => false : list === "sale" ? (row) => row.onSale : () => true;
    }
  }
  return new Set(rows.filter(holds).map((r) => r.id));
}

/**
 * The homepage's product sections, in page order, for the "Metti in
 * homepage" sheet. For some products (`target`), each also says how many of
 * them pinning there would place — the sheet dims a section that takes
 * none (a brand section for another brand's product); the preview has the
 * last word.
 */
export async function homepageSections(target?: OperationTarget): Promise<HomepageSectionOption[]> {
  const [{ home, collections }, chosen] = await Promise.all([readHome(), target ? targetRows(target) : null]);
  const max = hubConfig.vetrina.maxPins;
  return home.blocks.flatMap((block) => {
    if (block.kind !== "rail") return [];
    const { rail } = block;
    const category = railCategory(rail);
    const fill = sectionFill(rail, category != null && collections[category] != null);
    const option: HomepageSectionOption = {
      key: rail.key,
      title: rail.title.trim() || rail.key,
      ...fill,
      pinned: rail.pin.length,
      pinnable: pinnable(rail),
    };
    if (chosen) {
      const members = sectionMembers(rail, chosen.rows, chosen.trees);
      for (const p of rail.products) if (chosen.ids.has(p.id)) members.add(p.id);
      const takes = !option.pinnable ? 0 : fill.fill === "category" ? chosen.rows.length : members.size;
      option.takes = Math.min(takes, max);
    }
    return [option];
  });
}

async function targetRows(target: OperationTarget): Promise<{ ids: Set<number>; rows: IndexRow[]; trees: CatalogTrees }> {
  const { ids, trees } = await resolveTarget(target);
  const { rows } = await rowsInOrder(ids);
  return { ids: new Set(ids), rows, trees };
}
