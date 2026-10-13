"use server";

import { z } from "zod";
import {
  CATALOG_PAGE_MAX,
  CATALOG_SORTS,
  QUICK_VIEWS,
  type CatalogOverview,
  type CatalogPage,
  type CatalogQuery,
  type CatalogSearch,
  type CatalogTaxonomy,
  type CatalogTermDetail,
  type ProductPlacement,
} from "@/lib/vetrina/catalog";
import { readOverview, readPage, readPlacement, readTerm, search } from "@/server/vetrina/catalog";
import { attempt, type VetrinaResult } from "@/server/vetrina/service";

/**
 * The Vetrina catalog's server actions: thin, validated wrappers over
 * server/vetrina/catalog.ts. Every one answers { ok, data } or
 * { ok: false, code, error }, like the homepage editor's.
 */

const Taxonomy = z.enum(["category", "brand"]);
const Id = z.number().int().positive();
const Text = z.string().max(100);

const QuerySchema = z
  .object({
    taxonomy: Taxonomy.optional(),
    termId: Id.optional(),
    view: z.enum(QUICK_VIEWS).optional(),
    q: Text.optional(),
    stock: z.enum(["instock", "outofstock"]).optional(),
    visibility: z.enum(["visible", "hidden"]).optional(),
    onSale: z.boolean().optional(),
    within: Id.optional(),
    sort: z.enum(CATALOG_SORTS).optional(),
    offset: z.number().int().min(0).max(1_000_000).optional(),
    limit: z.number().int().positive().max(CATALOG_PAGE_MAX).optional(),
  })
  // A term without its taxonomy would quietly read as a category.
  .refine((q) => q.termId == null || q.taxonomy != null, { message: "termId needs its taxonomy." });

export async function loadCatalogOverview(): Promise<VetrinaResult<CatalogOverview>> {
  return attempt(() => readOverview());
}

export async function loadCatalogTerm(input: {
  taxonomy: CatalogTaxonomy;
  id: number;
}): Promise<VetrinaResult<CatalogTermDetail>> {
  const parsed = z.object({ taxonomy: Taxonomy, id: Id }).safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Categoria o brand non valido." };
  return attempt(() => readTerm(parsed.data.taxonomy, parsed.data.id));
}

export async function loadCatalogPage(input: CatalogQuery): Promise<VetrinaResult<CatalogPage>> {
  const parsed = QuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Richiesta non valida." };
  return attempt(() => readPage(parsed.data));
}

export async function searchCatalog(input: { q: string }): Promise<VetrinaResult<CatalogSearch>> {
  const parsed = z.object({ q: Text }).safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Ricerca non valida." };
  return attempt(() => search(parsed.data.q));
}

export async function loadProductPlacement(input: { id: number }): Promise<VetrinaResult<ProductPlacement>> {
  const parsed = z.object({ id: Id }).safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Prodotto non valido." };
  return attempt(() => readPlacement(parsed.data.id));
}
