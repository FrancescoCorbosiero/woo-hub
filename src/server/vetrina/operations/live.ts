import "server-only";
import { toIndexRow } from "@/server/collections/index-rows";
import { deleteIndexRows, upsertIndexRows } from "@/server/collections/repo";
import { patchSnapshotProducts } from "@/server/store-json/repo";
import type { ProductBatchRow, WooClient, WooIndexProduct } from "@/server/woo/client";
import { priceCents, saleFields, saleOf, type LiveSize, type SaleState } from "./plan";

/**
 * The store, read right before a write and written through its own batch
 * endpoints — the store the automatic categories use (storeClient(): the
 * shop, or the demo shop), never a second client. Every read and every
 * answer refreshes the store index, so the catalog shows the result at once.
 */

/** The fields a sale reads of a size: no descriptions, no meta. */
const SIZE_FIELDS = "id,sku,regular_price,sale_price,date_on_sale_from,date_on_sale_to";

const statusOf = (e: unknown) => (e as { status?: number })?.status;
/** The store said no to this request (a 4xx): that product is refused, the rest go on. */
export const refusedByStore = (e: unknown) => {
  const status = statusOf(e);
  return status != null && status >= 400 && status < 500;
};
export const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** These products as the store has them now. The index learns them, and forgets the ones gone from the store. */
export async function readFresh(client: WooClient, ids: readonly number[]): Promise<Map<number, WooIndexProduct>> {
  if (ids.length === 0) return new Map();
  const { products } = await client.getProductIndexPage({ page: 1, perPage: ids.length, include: [...ids] });
  const wanted = new Set(ids);
  const live = new Map(products.filter((p) => wanted.has(p.id)).map((p) => [p.id, p]));
  await upsertIndexRows([...live.values()].map(toIndexRow));
  await deleteIndexRows(ids.filter((id) => !live.has(id)));
  return live;
}

/** The index learns the products a batch saved; the ids it refused come back. */
export async function settleBatch(ids: readonly number[], answers: ProductBatchRow[]): Promise<{ saved: Map<number, WooIndexProduct>; refused: number[] }> {
  const byId = new Map(answers.map((a) => [a.id, a]));
  const saved = new Map<number, WooIndexProduct>();
  const refused: number[] = [];
  for (const id of ids) {
    const answer = byId.get(id);
    if (answer?.product && !answer.error) saved.set(id, answer.product);
    else refused.push(id);
  }
  await upsertIndexRows([...saved.values()].map(toIndexRow));
  return { saved, refused };
}

export interface ProductSizes {
  /** Sold in sizes (WooCommerce's "variable"): each size has its own prices. */
  variable: boolean;
  sizes: LiveSize[];
}

/** A product's prices as the store has them now: its sizes, or — sold as one item — its own. Null when it is gone. */
export async function readSizes(client: WooClient, product: { id: number; type?: string | null }): Promise<ProductSizes | null> {
  if (product.type === "variable") {
    try {
      const variations = await client.getAllVariations(product.id, { fields: SIZE_FIELDS });
      return {
        variable: true,
        sizes: variations.map((v) => ({ variationId: v.id, regular: priceCents(v.regular_price), sale: saleOf(v) })),
      };
    } catch (e) {
      if (statusOf(e) === 404) return null;
      throw e;
    }
  }
  const full: Record<string, unknown> | null = await client.getProduct(product.id);
  if (!full) return null;
  return { variable: false, sizes: [{ variationId: null, regular: priceCents(full.regular_price), sale: saleOf(full) }] };
}

/** How long a preview takes a product's sizes as it last read them: the sale sheet asks again on every slider stop. */
const PREVIEW_SIZES_MS = 60_000;

interface PreviewSizes {
  read: Map<number, { sizes: ProductSizes | null; at: number }>;
  forgotAt: number;
}
// One copy per process, like the actions' queue that forgets it.
const previews = globalThis as { __vetrinaPreviewSizes?: PreviewSizes };

/**
 * readSizes for a preview only: what was read in the last minute is taken as
 * it is. Running the action reads the sizes again, live, and plans from those.
 */
export async function previewSizes(client: WooClient, product: { id: number; type?: string | null }): Promise<ProductSizes | null> {
  const memo = (previews.__vetrinaPreviewSizes ??= { read: new Map(), forgotAt: 0 });
  const started = Date.now();
  const hit = memo.read.get(product.id);
  if (hit && started - hit.at < PREVIEW_SIZES_MS) return hit.sizes;
  const sizes = await readSizes(client, product);
  // Forgotten while on its way (an action finished): the read may be from before it.
  if (started > memo.forgotAt) memo.read.set(product.id, { sizes, at: started });
  return sizes;
}

/** An action finished, or ↻: previews read the sizes again. */
export function forgetPreviewSizes(): void {
  const memo = previews.__vetrinaPreviewSizes;
  if (!memo) return;
  memo.read.clear();
  memo.forgotAt = Date.now();
}

export interface SaleWrite {
  variationId: number | null;
  sale: SaleState;
}

/**
 * Write sales: a product's sizes in one batch, a product sold as one item
 * through the products' batch (row by row answers, and no check of each
 * field as the single-product route does, which can refuse the empty dates
 * that end a sale). Only the sale price and its dates — never the regular
 * price. Returns what the store took and what it refused: a refusal (a 4xx)
 * is that product's, the run goes on; anything else stops it — and, for the
 * sizes whose answer says, their regular price as the store holds it after
 * the write (a sale is computed from the regular price read before it).
 */
export async function writeSales(
  client: WooClient,
  productId: number,
  variable: boolean,
  writes: SaleWrite[],
): Promise<{ written: SaleWrite[]; refused: SaleWrite[]; regular?: Map<number, number | null> }> {
  if (writes.length === 0) return { written: [], refused: [] };
  try {
    if (!variable) {
      const answers = await client.batchUpdateProducts([{ id: productId, ...saleFields(writes[0].sale) }]);
      // The index learns the product as the store saved it.
      const { refused } = await settleBatch([productId], answers);
      return refused.length > 0 ? { written: [], refused: writes } : { written: writes, refused: [] };
    }
    const res = await client.batchVariations(productId, {
      update: writes.map((w) => ({ id: w.variationId, ...saleFields(w.sale) })),
    });
    const written: SaleWrite[] = [];
    const refused: SaleWrite[] = [];
    const regular = new Map<number, number | null>();
    writes.forEach((w, i) => {
      // The store answers row by row in the order asked; a refused row may come without its id.
      const row = res.update.find((r) => r.id === w.variationId) ?? res.update[i];
      if (!row || row.error) refused.push(w);
      else {
        written.push(w);
        if (w.variationId != null && "regular_price" in row) regular.set(w.variationId, priceCents(row.regular_price));
      }
    });
    return { written, refused, regular };
  } catch (e) {
    // The product gone between the read and the write, a value the store will not take.
    if (refusedByStore(e)) return { written: [], refused: writes };
    throw e;
  }
}

/**
 * The snapshot learns the sizes' new sales, so the price engine's next plan
 * sees them: a size on sale keeps its regular price while its product
 * follows the sale rule. Once for many products (a chunk of a run): every
 * patch rewrites the snapshot, so one per product would rewrite it hundreds
 * of times. Read, changed and written back under the snapshot's write lock,
 * so nothing written meanwhile is lost; products without a SKU included.
 * Best-effort, like every snapshot patch: a snapshot not updated is stale,
 * never wrong for long (the next pull reads the store).
 */
export async function patchSnapshotSales(written: ReadonlyMap<number, SaleWrite[]>): Promise<void> {
  const sizes = new Map<number, SaleWrite[]>();
  for (const [productId, list] of written) {
    const own = list.filter((w) => w.variationId != null);
    if (own.length > 0) sizes.set(productId, own);
  }
  if (sizes.size === 0) return;
  try {
    await patchSnapshotProducts([...sizes.keys()], (product) => {
      for (const w of sizes.get(product.id) ?? []) {
        const v = product.variations.find((x) => x.id === w.variationId);
        if (!v) continue;
        v.sale_price = w.sale.price;
        v.date_on_sale_from = w.sale.from;
        v.date_on_sale_to = w.sale.to;
      }
    });
  } catch (e) {
    console.warn(`[vetrina-ops] snapshot not patched for ${sizes.size} product(s): ${messageOf(e)}`);
  }
}
