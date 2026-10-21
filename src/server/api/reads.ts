import "server-only";
import { z } from "zod";
import { blockConfig } from "@/config";
import { CATALOG_PAGE_MAX, CATALOG_SORTS, QUICK_VIEWS } from "@/lib/vetrina/catalog";
import { railCategory } from "@/lib/collections/rail";
import { editableFields } from "@/lib/vetrina/fields";
import { railSourceOf } from "@/lib/vetrina/sections";
import type { RailSummary } from "@/lib/vetrina/types";
import { readPage } from "@/server/vetrina/catalog";
import { readHome } from "@/server/vetrina/service";

/**
 * The reads a script or an assistant needs before asking an action
 * (/api/v1/homepage, /api/v1/catalog/products): what the homepage shows
 * and the products, compact — the keys and ids the actions take, and what
 * the owner would see, nothing a screen only draws.
 */

/** What a section shows, as an action would name it again; null for what none can (a fixed list, tags). */
function shows(rail: RailSummary) {
  const source = railSourceOf(rail);
  if (!source) return null;
  if ("list" in source) return { list: source.list };
  return { taxonomy: source.taxonomy, slug: source.slug, name: rail.terms[0]?.name ?? source.slug };
}

/** The products shown first, as the owner would read them on the card. */
const SHOWN = 12;

/**
 * The homepage, top to bottom: each product section with its key (what the
 * actions take), what it shows, its switch, its pinned and hidden products,
 * and the first products the site shows; the other blocks with the texts
 * the owner may edit. And what the sections themselves may do (powers).
 */
export async function readHomepage() {
  const { home, powers, collections } = await readHome();
  let position = 0;
  return {
    link: home.link,
    modifiedGmt: home.modifiedGmt,
    powers: { source: powers.source, add: powers.add, move: powers.move, remove: powers.remove, switchOff: powers.switchOff, lists: powers.lists },
    blocks: home.blocks.map((block) => {
      if (block.kind === "rail") {
        const rail = block.rail;
        const category = railCategory(rail);
        return {
          kind: "section" as const,
          position: ++position,
          key: rail.key,
          attrsHash: rail.attrsHash,
          title: rail.title,
          eyebrow: rail.eyebrow,
          shows: shows(rail),
          // A category an automatic rule fills: its products are the rule's.
          automatic: category != null && collections[category] != null,
          switchedOff: rail.switchedOff,
          limit: rail.limit,
          fallback: rail.fallback,
          pinned: rail.pin,
          hidden: rail.exclude,
          editable: rail.editable,
          products: rail.products.slice(0, SHOWN).map((p) => ({ id: p.id, sku: p.sku, name: p.name })),
        };
      }
      const editable = block.fields ? editableFields(block.name, blockConfig(block.name).edit.fields, block.fields) : [];
      return {
        kind: "block" as const,
        path: block.path,
        name: block.name,
        attrsHash: block.attrsHash ?? null,
        // The texts the owner may change (blockEdit), as they are now.
        fields: Object.fromEntries(editable.map((field) => [field, block.fields?.[field] ?? ""])),
      };
    }),
  };
}

const Id = z.coerce.number().int().positive();

/** The catalog's query, from the address: the same an action's `target: { kind: "query" }` takes, and a page. */
export const ProductsQuery = z.object({
  taxonomy: z.enum(["category", "brand"]).optional(),
  termId: Id.optional(),
  view: z.enum(QUICK_VIEWS).optional(),
  q: z.string().max(100).optional(),
  stock: z.enum(["instock", "outofstock"]).optional(),
  visibility: z.enum(["visible", "hidden"]).optional(),
  onSale: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  within: Id.optional(),
  sort: z.enum(CATALOG_SORTS).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(CATALOG_PAGE_MAX).default(40),
});

/** Products as the catalog lists them for a query: their ids (what the actions take) and what the owner would read. */
export async function readProducts(query: z.infer<typeof ProductsQuery>) {
  const page = await readPage(query);
  return {
    total: page.total,
    offset: page.offset,
    products: page.products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      price: p.price,
      onSale: p.onSale,
      stockStatus: p.stockStatus,
      visibility: p.visibility,
      status: p.status,
      categories: p.categories.map((c) => c.name),
      brands: p.brands.map((b) => b.name),
      tags: p.tags.map((t) => t.name),
      // The homepage sections showing it, and where.
      sections: p.sections.map((s) => ({ key: s.key, title: s.title, position: s.position, pinned: s.pinned })),
    })),
  };
}
