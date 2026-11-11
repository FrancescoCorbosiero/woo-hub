import { duplicateGtins, normalizeGtin } from "@/lib/gtin";
import { isEuSize, paragraphs, slugify, sortSizes, type HandmadeProduct } from "@/lib/handmade";
import { skuKey } from "@/lib/skus";
import { humanEuSize } from "@/server/store-json/match";
import { rebuildParentAttributes } from "@/server/store-json/rebuild-plan";
import { applyIdentity, type ResolvedIdentity } from "@/server/woo/publish-plan";

/**
 * A product made by hand → the WooCommerce bodies that make it: the planner
 * of src/server/add-products/handmade.ts, as publish-plan.ts is Publish's.
 * The same shape every product the Hub makes has — and a size the shop
 * already knows written exactly as Publish writes it: an EU size is the
 * same pa_taglia label ("42.5", "36 2/3") and the same SKU ("{SKU}-EU42.5");
 * a clothes size or the one size is its own label ("M", "Unica") and its own
 * SKU ("{SKU}-M"). The prices are the owner's and the stock is counted: the
 * shop owns this product, there is no source to price or stock it.
 *
 * Pure: no HTTP, no DB.
 */

export interface HandmadeVariationPlan {
  sizeLabel: string;
  sku: string;
  price: number;
  stock: number;
  upc: string | null;
  /** POST /products/{id}/variations/batch `create` row. */
  payload: Record<string, unknown>;
}

export interface HandmadePlan {
  sku: string;
  title: string;
  /** POST /products body. */
  parentBody: Record<string, unknown>;
  variations: HandmadeVariationPlan[];
  /** On sale at once (visible, with an uploaded photo); else hidden — until the queue's first photo, when visible. */
  status: "publish" | "draft";
  /** The photos uploaded to the library, attached by id with the create. */
  photoIds: number[];
  /** The photos the shop downloads itself, through the photo queue. */
  photoUrls: string[];
  /** Barcodes not written: unusable, or given to two sizes. */
  rejectedGtins: { sizeLabel: string; value: string; reason: string }[];
}

export interface HandmadePlanInput {
  product: HandmadeProduct;
  /** The brand, resolved against the shop's terms (and its pa_brand attribute). */
  identity?: ResolvedIdentity;
  /** The global pa_taglia attribute id, when the shop has one. */
  tagliaAttributeId?: number;
  /** The SEO plugin's fields (src/server/wordpress/seo.ts): none without one. */
  meta?: { key: string; value: string }[];
}

/** The pa_taglia label a size is written with. */
export function handmadeSizeLabel(label: string): string {
  const s = label.trim().replace(/\s+/g, " ");
  if (isEuSize(s)) return humanEuSize(s) ?? s;
  return /^[a-z0-9]{1,4}$/i.test(s) ? s.toUpperCase() : s;
}

/** The SKU a size's variation gets: Publish's "-EU{size}" for an EU size, the label's letters for the rest. */
export function handmadeVariationSku(parentSku: string, label: string): string {
  const sizeLabel = handmadeSizeLabel(label);
  if (isEuSize(sizeLabel)) return `${skuKey(parentSku)}-EU${sizeLabel}`;
  const letters = sizeLabel.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return `${skuKey(parentSku)}-${letters || "SIZE"}`;
}

export function planHandmade(input: HandmadePlanInput): HandmadePlan {
  const { product } = input;
  const sku = skuKey(product.sku);

  // Barcodes: only valid ones, and each to one size — a channel rejects the rest.
  const rejectedGtins: HandmadePlan["rejectedGtins"] = [];
  const gtins = product.sizes.map((size) => {
    if (!size.barcode) return null;
    const { gtin, rejection } = normalizeGtin(size.barcode);
    if (!gtin && rejection && rejection !== "empty") {
      rejectedGtins.push({ sizeLabel: handmadeSizeLabel(size.label), value: size.barcode, reason: rejection });
    }
    return gtin;
  });
  const shared = duplicateGtins(gtins);

  const variations = sortSizes(
    product.sizes.map((size, i) => ({ size, gtin: gtins[i] })),
    ({ size }) => size.label,
  ).map(({ size, gtin }): HandmadeVariationPlan => {
    const sizeLabel = handmadeSizeLabel(size.label);
    let upc = gtin;
    if (upc && shared.has(upc)) {
      rejectedGtins.push({ sizeLabel, value: upc, reason: "duplicate" });
      upc = null;
    }
    const payload: Record<string, unknown> = {
      sku: handmadeVariationSku(sku, size.label),
      attributes: [
        input.tagliaAttributeId != null ? { id: input.tagliaAttributeId, option: sizeLabel } : { name: "pa_taglia", option: sizeLabel },
      ],
      regular_price: size.price.toFixed(2),
      manage_stock: true,
      stock_quantity: size.stock,
      stock_status: size.stock > 0 ? "instock" : "outofstock",
    };
    if (upc) payload.global_unique_id = upc;
    return { sizeLabel, sku: payload.sku as string, price: size.price, stock: size.stock, upc, payload };
  });

  const photoIds: number[] = [];
  const photoUrls: string[] = [];
  for (const photo of product.photos) {
    if ("id" in photo) photoIds.push(photo.id);
    else if (!photoUrls.includes(photo.url)) photoUrls.push(photo.url);
  }
  const status = product.visible && photoIds.length > 0 ? "publish" : "draft";

  const parentBody: Record<string, unknown> = {
    name: product.title,
    type: "variable",
    status,
    sku,
    attributes: rebuildParentAttributes(
      null,
      variations.map((v) => v.sizeLabel),
      input.tagliaAttributeId,
    ),
  };
  const description = paragraphs(product.description);
  if (description) parentBody.description = description;
  if (photoIds.length > 0) parentBody.images = photoIds.map((id) => ({ id }));
  const slug = slugify(product.seo.slug);
  if (slug) parentBody.slug = slug;
  // The brand both ways, as Publish writes it (the shop's brands, and pa_brand for the channels that read only that).
  applyIdentity(parentBody, input.identity);
  // The categories are the owner's choice, never a guess.
  if (product.categoryIds.length > 0) parentBody.categories = product.categoryIds.map((id) => ({ id }));
  else delete parentBody.categories;
  if (input.meta?.length) parentBody.meta_data = input.meta;

  return { sku, title: product.title, parentBody, variations, status, photoIds, photoUrls, rejectedGtins };
}
