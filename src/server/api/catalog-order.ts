import "server-only";
import { z } from "zod";
import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import type { OperationInput, OperationPreview, OperationView } from "@/lib/vetrina/catalog-ops";
import { readIndexFacts } from "@/server/collections/repo";
import { storeClient } from "@/server/collections/store";
import { matchingIds, readCatalogTrees, readOverview } from "@/server/vetrina/catalog";
import { parseOperationInput } from "@/server/vetrina/operations/input";
import * as operations from "@/server/vetrina/operations/service";
import { VetrinaError } from "@/server/vetrina/source";

/**
 * The catalog's order over the API (/api/v1/catalog/*): the terms, a term's
 * products in the shop's order, and "Ordina" — previewed (dryRun) or
 * started, as the Vetrina's sheets do. The order itself, its plan and its
 * undo are the catalog action's (src/server/vetrina/operations/order.ts):
 * the API adds nothing of its own but SKUs as a way to name products.
 */

const Taxonomy = z.enum(["category", "brand"]);
const Id = z.coerce.number().int().positive();

/** Every category or brand, with its parent and its products (sub-terms' included). */
export async function listTerms(taxonomy: CatalogTaxonomy) {
  const overview = await readOverview();
  return (taxonomy === "brand" ? overview.brands : overview.categories).map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    parent: t.parent,
    path: t.path,
    count: t.count,
  }));
}

export const TermQuery = z.object({
  taxonomy: Taxonomy.default("category"),
  id: Id,
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

/**
 * A term's products in the shop's order — the order its page on the shop
 * follows (before a homepage section's pins and "sold out last", which the
 * storefront adds) — a page at a time, with how the storefront sorts.
 */
export async function readOrder(query: z.infer<typeof TermQuery>) {
  const [facts, trees] = await Promise.all([readIndexFacts(), readCatalogTrees()]);
  const term = trees[query.taxonomy].terms.get(query.id);
  if (!term) throw new VetrinaError("not_found", `No ${query.taxonomy} ${query.id} in the shop.`, 404);
  const byId = new Map(facts.map((f) => [f.id, f]));
  const ids = matchingIds(facts, { taxonomy: query.taxonomy, termId: query.id, sort: "shop" }, trees);
  const storefrontSort = await (await storeClient()).getDefaultCatalogOrderby?.().catch(() => null);
  return {
    term: { taxonomy: query.taxonomy, id: term.id, name: term.name },
    total: ids.length,
    offset: query.offset,
    // "menu_order" = "Custom ordering + name": the shop's pages follow this order. Null when the key cannot read settings.
    storefrontSort: storefrontSort ?? null,
    products: ids.slice(query.offset, query.offset + query.limit).map((id, i) => {
      const f = byId.get(id)!;
      return {
        position: query.offset + i + 1,
        id,
        sku: f.sku,
        name: f.name,
        menuOrder: f.menuOrder,
        stockStatus: f.stockStatus,
        visibility: f.visibility,
        status: f.status,
      };
    }),
  };
}

export const OrderBody = z
  .object({
    taxonomy: Taxonomy.default("category"),
    id: Id,
    /** The products, in the order wanted: ids, SKUs, or both (ids first). */
    ids: z.array(z.number().int().positive()).optional(),
    skus: z.array(z.string().trim().min(1)).optional(),
    /** 1-based place of the first of them among the term's other products; "top" = 1, "bottom" = after all. */
    position: z.union([z.literal("top"), z.literal("bottom"), z.number().int().min(1)]).default("top"),
    /** Only say what it would do (the preview); nothing is written. */
    dryRun: z.boolean().default(false),
  })
  .refine((b) => (b.ids?.length ?? 0) + (b.skus?.length ?? 0) > 0, { message: "give ids or skus", path: ["ids"] });

/** SKUs as product ids, through the store index (any case); an unknown SKU is refused by name. */
async function idsOfSkus(skus: readonly string[]): Promise<number[]> {
  if (skus.length === 0) return [];
  const bySku = new Map((await readIndexFacts()).filter((f) => f.sku).map((f) => [f.sku.trim().toUpperCase(), f.id]));
  const unknown = skus.filter((s) => !bySku.has(s.toUpperCase()));
  if (unknown.length > 0) throw new VetrinaError("invalid", `Unknown SKU: ${unknown.slice(0, 10).join(", ")}${unknown.length > 10 ? "…" : ""}`, 400);
  return skus.map((s) => bySku.get(s.toUpperCase())!);
}

/** "Ordina" over the API: the preview with dryRun, else the action started (follow it at /api/v1/operations/{id}). */
export async function order(
  body: z.infer<typeof OrderBody>,
): Promise<{ dryRun: true; preview: OperationPreview } | { dryRun: false; operation: OperationView }> {
  const ids = [...new Set([...(body.ids ?? []), ...(await idsOfSkus(body.skus ?? []))])];
  const parsed = parseOperationInput({
    kind: "order",
    target: { kind: "ids", ids },
    term: { taxonomy: body.taxonomy, id: body.id },
    position: body.position === "top" ? 1 : body.position === "bottom" ? null : body.position,
  } satisfies OperationInput);
  if (!parsed.ok) throw new VetrinaError("invalid", parsed.error, 400);
  if (body.dryRun) return { dryRun: true, preview: await operations.previewOperation(parsed.data) };
  return { dryRun: false, operation: await operations.startOperation(parsed.data) };
}
