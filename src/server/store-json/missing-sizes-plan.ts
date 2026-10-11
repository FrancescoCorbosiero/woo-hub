import { normalizeGtin } from "@/lib/gtin";
import { skuKey } from "@/lib/skus";
import { humanEuSize, normSize, variationEuSize, variationSizeLabel } from "./match";
import { rebuildParentAttributes } from "./rebuild-plan";
import type { StoreVariation } from "./model";

/**
 * Sizes a product on the store is missing — planned without touching the ones
 * it has.
 *
 * The sync only ever ADJUSTED existing variations: a size the source sells and
 * the store product lacks came out of the plan as a "create" row, and every
 * write path dropped it. So a product published while the supplier listed one
 * size kept that one size forever, however many the feed added later. The
 * only ways to add them were destructive (force reimport, rebuild: every
 * variation deleted and recreated).
 *
 * This adds exactly the missing ones: the same variation Publish would create
 * for that size (sku, pa_taglia label, price, stock, GTIN), and the size added
 * to the parent's pa_taglia options — never one removed. Planned against the
 * store as last read: the executor reads the product live first, so a size
 * that appeared meanwhile is not created twice.
 *
 * Pure: no HTTP, no DB.
 */

/** One plan row the store has no variation for. */
export interface MissingSizeRow {
  stockxVariantId: string;
  /** The source's label: the human EU size for a feed, often a US size for KicksDB. */
  sizeLabel: string;
  /** Canonical EU size key ("36.67"), when the source knows it. */
  euSize?: string | null;
  proposedPrice: number | null;
  /** Feed stock; absent = sell on demand (KicksDB). */
  stockQuantity?: number;
  upc?: string;
}

export interface MissingSizeCreate {
  stockxVariantId: string;
  /** Human label written to pa_taglia ("36 2/3"). */
  label: string;
  euNorm: string;
  price: number | null;
  /** Managed quantity written, or null for sell on demand. */
  stock: number | null;
  /** The variations/batch `create` row. */
  payload: Record<string, unknown>;
}

export type MissingSizeSkip = "onStore" | "noSize" | "noStock" | "noPrice" | "duplicate";

export interface MissingSizesPlan {
  create: MissingSizeCreate[];
  /** The parent's attributes with the new sizes in pa_taglia; null when they are listed already. */
  parentAttributes: Record<string, unknown>[] | null;
  skipped: { stockxVariantId: string; reason: MissingSizeSkip }[];
}

const isTaglia = (o: unknown): o is Record<string, unknown> =>
  !!o && typeof o === "object" && String((o as Record<string, unknown>).name ?? (o as Record<string, unknown>).slug ?? "").toLowerCase().includes("taglia");

/** "36.67" → "36 2/3", "36.33" → "36 1/3", "42.5" → "42.5", "42" → "42". */
function labelFromKey(euNorm: string): string | null {
  const n = Number.parseFloat(euNorm);
  if (!Number.isFinite(n)) return null;
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 100);
  if (frac === 67) return `${whole} 2/3`;
  if (frac === 33) return `${whole} 1/3`;
  return humanEuSize(euNorm);
}

/** The pa_taglia label for a row, or null when it has no EU size. */
function rowLabel(row: MissingSizeRow): { label: string; euNorm: string } | null {
  const euNorm = normSize(row.euSize ?? null) ?? null;
  if (!euNorm) return null;
  // The source's own label when it IS that EU size ("36 2/3" for the feed),
  // else one derived from the key (KicksDB labels are usually US sizes).
  const own = humanEuSize(row.sizeLabel);
  const label = own && normSize(own) === euNorm ? own : labelFromKey(euNorm);
  return label ? { label, euNorm } : null;
}

function sortLabels(labels: string[]): string[] {
  return [...labels].sort((a, b) => {
    const na = Number.parseFloat(normSize(a) ?? "");
    const nb = Number.parseFloat(normSize(b) ?? "");
    return Number.isNaN(na) || Number.isNaN(nb) ? a.localeCompare(b) : na - nb;
  });
}

export function planMissingSizes(input: {
  parentSku: string;
  parentAttributes: unknown;
  variations: StoreVariation[];
  rows: MissingSizeRow[];
}): MissingSizesPlan {
  const { parentSku, parentAttributes, variations, rows } = input;
  const present = new Set(variations.map((v) => variationEuSize(parentSku, v)).filter((s): s is string => !!s));
  const gtinsTaken = new Set(variations.map((v) => String(v.global_unique_id ?? "").trim()).filter(Boolean));

  const tagliaEntry = Array.isArray(parentAttributes) ? parentAttributes.find(isTaglia) : undefined;
  const tagliaId = typeof tagliaEntry?.id === "number" && tagliaEntry.id > 0 ? tagliaEntry.id : undefined;

  const create: MissingSizeCreate[] = [];
  const skipped: MissingSizesPlan["skipped"] = [];
  const planned = new Set<string>();
  for (const row of rows) {
    const size = rowLabel(row);
    if (!size) {
      skipped.push({ stockxVariantId: row.stockxVariantId, reason: "noSize" });
      continue;
    }
    if (present.has(size.euNorm)) {
      skipped.push({ stockxVariantId: row.stockxVariantId, reason: "onStore" });
      continue;
    }
    if (planned.has(size.euNorm)) {
      skipped.push({ stockxVariantId: row.stockxVariantId, reason: "duplicate" });
      continue;
    }
    // A size with nothing to sell would only add a sold-out button.
    if (row.stockQuantity != null && row.stockQuantity <= 0) {
      skipped.push({ stockxVariantId: row.stockxVariantId, reason: "noStock" });
      continue;
    }
    if (row.proposedPrice == null) {
      skipped.push({ stockxVariantId: row.stockxVariantId, reason: "noPrice" });
      continue;
    }
    planned.add(size.euNorm);

    const payload: Record<string, unknown> = {
      sku: `${skuKey(parentSku)}-EU${size.label}`,
      attributes: [tagliaId != null ? { id: tagliaId, option: size.label } : { name: "pa_taglia", option: size.label }],
      regular_price: row.proposedPrice.toFixed(2),
    };
    const stock = row.stockQuantity ?? null;
    if (stock != null) {
      payload.manage_stock = true;
      payload.stock_quantity = stock;
      payload.stock_status = "instock";
    } else {
      payload.manage_stock = false;
      payload.stock_status = "instock";
    }
    const { gtin } = normalizeGtin(row.upc ?? "");
    if (gtin && !gtinsTaken.has(gtin)) {
      payload.global_unique_id = gtin;
      gtinsTaken.add(gtin);
    }
    create.push({
      stockxVariantId: row.stockxVariantId,
      label: size.label,
      euNorm: size.euNorm,
      price: row.proposedPrice,
      stock,
      payload,
    });
  }

  // The parent lists every size it had, plus the new ones: a variation whose
  // size is not among the parent's options cannot be picked on the storefront.
  let nextAttributes: Record<string, unknown>[] | null = null;
  if (create.length > 0) {
    const existing = Array.isArray(tagliaEntry?.options) ? (tagliaEntry.options as unknown[]).map(String) : [];
    const listed = new Set(existing.map((o) => normSize(o)).filter(Boolean));
    const options = [...existing];
    for (const v of variations) {
      const label = variationSizeLabel(parentSku, v);
      const key = normSize(label);
      if (label && key && !listed.has(key)) {
        options.push(label);
        listed.add(key);
      }
    }
    let added = options.length > existing.length;
    for (const c of create) {
      if (listed.has(c.euNorm)) continue;
      options.push(c.label);
      listed.add(c.euNorm);
      added = true;
    }
    if (added) nextAttributes = rebuildParentAttributes(parentAttributes, sortLabels(options), tagliaId);
  }

  return { create, parentAttributes: nextAttributes, skipped };
}
