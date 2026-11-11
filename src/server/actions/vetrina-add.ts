"use server";

import { z } from "zod";
import { LOOKUP_BATCH, type AddLookup } from "@/lib/add-products";
import { isEuSize, LETTER_SIZES } from "@/lib/handmade";
import { skuKey } from "@/lib/skus";
import { addProducts } from "@/server/add-products/add";
import { createHandmadeProduct, type HandmadeOutcome } from "@/server/add-products/handmade";
import { recalled } from "@/server/add-products/kicks-memory";
import { lookupProducts } from "@/server/add-products/lookup";
import { getAnyBySkus } from "@/server/catalog/repo";
import { getActiveConfig } from "@/server/config/repo";
import { readCatalogTrees } from "@/server/vetrina/catalog";
import { catalogSpellings } from "@/server/vetrina/order-sources/compare-model";
import { attempt, type VetrinaResult } from "@/server/vetrina/service";
import { wooSiteUrl } from "@/server/woo/client";
import type { PublishOutcome } from "@/server/woo/publish";
import { deletePhoto, photosUploadable } from "@/server/wordpress/media";
import { seoPlugin, type SeoPlugin } from "@/server/wordpress/seo";
import { defaultLocale, type Locale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { inLanguage } from "@/server/vetrina/operations/words";
import { signedInActor } from "./signed-in";

/**
 * "Aggiungi prodotti" (src/lib/add-products.ts): look codes up, make one by
 * hand. The one-tap add runs through its own route, a batch per request
 * (src/app/(vetrina)/vetrina/negozio/aggiungi/importa), as Publish does.
 */

/** The owner's language, for the refusals said deep down (words()). */
async function language(): Promise<Locale> {
  try {
    return await getLocale();
  } catch {
    return defaultLocale;
  }
}

const Codes = z.array(z.string().trim().min(1).max(64)).min(1).max(LOOKUP_BATCH);

export async function lookupNewProducts(skus: string[]): Promise<VetrinaResult<AddLookup[]>> {
  const parsed = Codes.safeParse(skus);
  if (!parsed.success) return { ok: false, code: "invalid", error: "invalid codes" };
  return inLanguage(await language(), () => attempt(() => lookupProducts(parsed.data)));
}

const AddSchema = z.object({
  skus: z.array(z.string().trim().min(1).max(64)).min(1).max(200),
  dryRun: z.boolean(),
  includeGallery: z.boolean().optional(),
  force: z.boolean().optional(),
  replaceMedia: z.boolean().optional(),
});

/** One batch of the one-tap add, for its route: Publish's answer, so the same run drives it (src/lib/publish-run.ts). */
export async function runAdd(input: unknown): Promise<{ ok: boolean; error?: string; outcome?: PublishOutcome }> {
  const parsed = AddSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid input" };
  // A product the shop has is never made again: an add is never a reimport.
  const result = await inLanguage(await language(), () =>
    attempt(() => addProducts(parsed.data.skus, { dryRun: parsed.data.dryRun, includeGallery: parsed.data.includeGallery })),
  );
  if (!result.ok) return { ok: false, error: result.error };
  const by = await signedInActor();
  if (!parsed.data.dryRun && result.data.created > 0) {
    console.log(`[vetrina] ${result.data.created} product(s) added by code${by ? ` by ${by.name}` : ""}`);
  }
  return { ok: true, outcome: result.data };
}

/** What the form starts from: the shop's terms, and whatever is known of the code. */
export interface HandmadeSetup {
  /** The shop's categories, each with its path: "Scarpe › Sneakers". */
  categories: { id: number; path: string }[];
  brands: string[];
  seoPlugin: SeoPlugin;
  /** Photos can be uploaded from the phone (WordPress's Application Password is set). */
  photosUploadable: boolean;
  /** The site's address, for the Google preview. */
  site: string;
  prefill: {
    sku: string;
    title: string;
    brand: string;
    description: string;
    /** Photo addresses the shop would download. */
    photos: string[];
    /** Sizes known, without prices: clothes sizes KicksDB lists. */
    sizes: string[];
  } | null;
}

/** The sizes a known product brings to the form: only clothes and one-size labels — an EU one would have been added with one tap. */
function knownSizes(labels: readonly string[]): string[] {
  const letters = new Set<string>(LETTER_SIZES);
  const out = labels.map((l) => l.trim().toUpperCase()).filter((l) => letters.has(l) && !isEuSize(l));
  return [...new Set(out)];
}

export async function getHandmadeSetup(sku?: string | null): Promise<VetrinaResult<HandmadeSetup>> {
  return attempt(async () => {
    const [trees, plugin] = await Promise.all([readCatalogTrees(), seoPlugin()]);
    const categories = [...trees.category.paths.entries()]
      .map(([id, path]) => ({ id, path }))
      .sort((a, b) => a.path.localeCompare(b.path, "it"));
    const brands = [...trees.brand.terms.values()].map((t) => t.name).sort((a, b) => a.localeCompare(b, "it"));
    const site = wooSiteUrl().replace(/^https?:\/\//, "").replace(/\/wp-json.*$/, "").replace(/\/+$/, "");

    let prefill: HandmadeSetup["prefill"] = null;
    const code = (sku ?? "").trim().slice(0, 64);
    if (code) {
      const market = (await getActiveConfig()).source.market;
      const catalog = await getAnyBySkus(market, catalogSpellings(code)).catch(() => new Map());
      const known = catalogSpellings(code).map((k) => catalog.get(k)).find(Boolean) ?? recalled(market, code) ?? null;
      prefill = {
        sku: known?.sku ? skuKey(known.sku) : code,
        title: known?.title ?? "",
        brand: known?.brand ?? "",
        description: (known?.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        photos: [known?.image, ...(known?.gallery ?? [])].filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u)).slice(0, 6),
        sizes: known ? knownSizes(known.variants.map((v: { sizeLabel: string }) => v.sizeLabel)) : [],
      };
    }
    return { categories, brands, seoPlugin: plugin, photosUploadable: photosUploadable(), site, prefill };
  });
}

export async function makeHandmadeProduct(draft: unknown): Promise<VetrinaResult<HandmadeOutcome>> {
  const by = await signedInActor();
  return inLanguage(await language(), () => attempt(() => createHandmadeProduct(draft, by?.name ?? null)));
}

/** A photo uploaded for a product the owner took it back from, or never made: out of the library again. */
export async function removeUploadedPhoto(id: number): Promise<{ ok: boolean }> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false };
  return { ok: await deletePhoto(id) };
}
