import "server-only";
import type { SourceProduct } from "@core/core-spine";
import { checkHandmade, type HandmadeField, type HandmadeProduct } from "@/lib/handmade";
import { skuKey } from "@/lib/skus";
import { demoMode } from "@/server/collections/store";
import { getActiveConfig } from "@/server/config/repo";
import { db } from "@/server/db/client";
import { applyAudit } from "@/server/db/schema";
import { withProductOwner } from "@/server/overrides/model";
import { updateOverrides } from "@/server/overrides/repo";
import { upsertSnapshotProducts } from "@/server/store-json/repo";
import type { StoreProductModel, StoreVariation } from "@/server/store-json/model";
import { words } from "@/server/vetrina/operations/words";
import { VetrinaError } from "@/server/vetrina/source";
import { getWooClient, wooConfigured, wooSiteUrl } from "@/server/woo/client";
import { buildIdentityResolver } from "@/server/woo/identity";
import { dropMedia, queueMedia, setMediaProduct } from "@/server/woo/media";
import { createOrAdopt, resolveTagliaId } from "@/server/woo/publish";
import { publishing } from "@/server/woo/publishing";
import { assertSnapshotIsThisStore } from "@/server/woo/site-guard";
import { withTaxonomyCache } from "@/server/woo/taxonomy-cache";
import { photosTaken } from "@/server/wordpress/media";
import { seoMeta, seoPlugin } from "@/server/wordpress/seo";
import { isWriter, NOT_WRITER } from "@/server/writer";
import { planHandmade, type HandmadePlan } from "./handmade-plan";

/**
 * "Aggiungi prodotti", by hand: a product nobody else knows, made on the shop
 * from what the owner filled in (src/lib/handmade.ts). The shop owns it from
 * then on — a "store" pin in the Hub's overrides, which every source honours
 * (the feed's ownership, the store sync, Publish): its prices, stock and
 * words are the owner's, written in WordPress or from the Vetrina, and no
 * sync ever writes over them. Nothing of it is kept in the Hub but the pin:
 * the shop is its one copy, and the Hub's copy of the shop learns it at once.
 *
 * Publish's own rules hold: a live look-up of the SKU before the create (a
 * second product with the same code is the one mistake running it again
 * cannot undo), the photos the shop downloads go through the photo queue,
 * one audit row, the Hub's copy of the shop patched.
 */

export type HandmadeOutcome =
  | {
      ok: true;
      productId: number;
      sku: string;
      title: string;
      /** On sale now, or hidden (until its first photo, when the owner wants it on sale). */
      status: "publish" | "draft";
      permalink: string | null;
      /** The product in WordPress. */
      editUrl: string;
      sizes: number;
      /** Photos the shop is downloading. */
      photosQueued: number;
      /** Barcodes not written. */
      rejectedGtins: HandmadePlan["rejectedGtins"];
      /** Sizes WooCommerce refused: the product exists, without them. */
      failedSizes: string[];
    }
  | { ok: false; code: "invalid"; invalid: HandmadeField[] }
  /** The shop has a product with this code already. */
  | { ok: false; code: "skuTaken"; productId: number; title: string; editUrl: string };

export function wpEditUrl(productId: number): string {
  const site = wooSiteUrl().replace(/\/+$/, "").replace(/\/wp-json.*$/, "");
  return `${site}/wp-admin/post.php?post=${productId}&action=edit`;
}

/** Only the brand is resolved for a product made by hand: its categories are the owner's choice, never inferred. */
function brandOnly(product: HandmadeProduct, market: string): SourceProduct {
  return {
    stockxId: "",
    sku: product.sku,
    title: product.title,
    brand: product.brand,
    image: "",
    market,
    currency: "EUR",
    source: "store",
    variants: [],
  };
}

export async function createHandmadeProduct(input: unknown, by?: string | null): Promise<HandmadeOutcome> {
  const checked = checkHandmade(input);
  if (!checked.ok) return { ok: false, code: "invalid", invalid: checked.invalid };
  const product = checked.product;
  if (demoMode()) throw new VetrinaError("invalid", words().add.demo, 400);
  if (!wooConfigured()) throw new VetrinaError("not_configured", words().term.notConfigured, 503);
  if (!isWriter()) throw new VetrinaError("not_configured", NOT_WRITER, 503);
  await assertSnapshotIsThisStore();

  const sku = skuKey(product.sku);
  // One maker at a time per code: Publish's own claim, so a double tap, or a
  // Publish of the same code, cannot make two.
  if (publishing.has(sku)) throw new VetrinaError("stale", words().add.busy, 409);
  publishing.add(sku);
  try {
    return await make(product, sku, by ?? null);
  } finally {
    publishing.delete(sku);
  }
}

async function make(product: HandmadeProduct, sku: string, by: string | null): Promise<HandmadeOutcome> {
  const client = withTaxonomyCache(getWooClient());
  // LIVE, never the Hub's copy: a product made in WordPress a minute ago counts.
  const existing = (await client.findProductsBySku(sku))[0];
  if (existing) return { ok: false, code: "skuTaken", productId: existing.id, title: existing.name ?? sku, editUrl: wpEditUrl(existing.id) };

  const config = await getActiveConfig();
  const [tagliaAttributeId, plugin] = await Promise.all([resolveTagliaId(client), seoPlugin()]);
  const identity = product.brand
    ? await buildIdentityResolver(client, [brandOnly(product, config.source.market)], {
        ...config.taxonomy,
        useSourceTree: [],
        rules: [],
        defaultCategory: "",
        write: { ...config.taxonomy.write, genderAttribute: false },
      })
        .then((resolver) => resolver.for(brandOnly(product, config.source.market)))
        .catch((e) => {
          console.warn(`[handmade] brand skipped: ${e instanceof Error ? e.message : String(e)}`);
          return undefined;
        })
    : undefined;
  const plan = planHandmade({ product, identity, tagliaAttributeId, meta: seoMeta(plugin, product.seo) });

  // Filed BEFORE the create, as Publish does: a create that outlives this
  // process still gets its photos, found by SKU.
  if (plan.photoUrls.length > 0) {
    await queueMedia({ sku, storeProductId: null, title: plan.title, urls: plan.photoUrls, publish: product.visible });
  }
  let made: Awaited<ReturnType<typeof createOrAdopt>>;
  try {
    made = await createOrAdopt(client, sku, plan.parentBody, identity, new Set());
  } catch (e) {
    if (plan.photoUrls.length > 0) await dropMedia(sku).catch(() => undefined);
    throw e;
  }
  const productId = made.product.id;
  photosTaken(plan.photoIds);
  if (made.adopted && ((await client.getAllVariations(productId)).length > 0 || made.product.name !== plan.title)) {
    // Found under this code after a lost answer, with sizes of its own: not this one.
    if (plan.photoUrls.length > 0) await dropMedia(sku).catch(() => undefined);
    return { ok: false, code: "skuTaken", productId, title: made.product.name ?? sku, editUrl: wpEditUrl(productId) };
  }
  if (plan.photoUrls.length > 0) await setMediaProduct(sku, productId).catch(() => undefined);

  const res = await client.batchVariations(productId, { create: plan.variations.map((v) => v.payload) });
  const variations: StoreVariation[] = [];
  const failedSizes: string[] = [];
  plan.variations.forEach((v, i) => {
    const row = res.create[i];
    const id = row && row.error == null && typeof row.id === "number" ? row.id : 0;
    if (id <= 0) {
      failedSizes.push(v.sizeLabel);
      return;
    }
    variations.push({
      id,
      sku: v.sku,
      regular_price: v.price.toFixed(2),
      sale_price: null,
      global_unique_id: v.upc,
      stock_quantity: v.stock,
      manage_stock: true,
      stock_status: v.stock > 0 ? "instock" : "outofstock",
      attributes: [{ name: "pa_taglia", option: v.sizeLabel }],
    } as StoreVariation);
  });

  // The shop owns it: no source writes to it from now on. Filed before the
  // copy is patched, so no sync between the two can take it for a source's.
  await updateOverrides((current) => withProductOwner(current, sku, "store"));
  await upsertSnapshotProducts([
    {
      id: productId,
      sku,
      name: plan.title,
      status: made.product.status ?? plan.status,
      attributes: (plan.parentBody as { attributes: unknown[] }).attributes,
      variations,
    } as StoreProductModel,
  ]).catch((e) => console.warn(`[handmade] the Hub's copy of the shop not patched: ${e instanceof Error ? e.message : String(e)}`));

  await db
    .insert(applyAudit)
    .values({
      status: failedSizes.length === 0 ? "applied" : "partial",
      dryRun: false,
      updatedCount: variations.length,
      failed: failedSizes.map((size) => ({ stockxVariantId: `handmade:${sku}:${size}`, error: "size refused by WooCommerce" })),
      result: { kind: "handmade", sku, productId, sizes: variations.length, photos: plan.photoIds.length + plan.photoUrls.length, by },
      finishedAt: new Date(),
    })
    .catch((e) => console.warn(`[handmade] audit not recorded: ${e instanceof Error ? e.message : String(e)}`));
  console.log(`[handmade] ${sku} made by hand (#${productId}, ${variations.length} sizes)${by ? ` by ${by}` : ""}`);

  return {
    ok: true,
    productId,
    sku,
    title: plan.title,
    status: made.product.status === "publish" ? "publish" : "draft",
    permalink: made.product.status === "publish" ? (made.product.permalink ?? null) : null,
    editUrl: wpEditUrl(productId),
    sizes: variations.length,
    photosQueued: plan.photoUrls.length,
    rejectedGtins: plan.rejectedGtins,
    failedSizes,
  };
}
