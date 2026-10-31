import "server-only";
import { isDeletable } from "@/lib/vetrina/catalog";
import { restoreCatalogRows, takeCatalogRows, type CatalogRowRecord } from "@/server/catalog/repo";
import { deleteIndexRows } from "@/server/collections/repo";
import { demoMode } from "@/server/collections/store";
import type { VetrinaOperationItemRow } from "@/server/db/schema";
import { productSource, readSourceFacts } from "@/server/vetrina/sources";
import { removeSnapshotProducts, upsertSnapshotProducts } from "@/server/store-json/repo";
import { cancelMedia } from "@/server/woo/media";
import { toStoreProduct } from "@/server/woo/store-product";
import { chunks, mapLimit } from "./context";
import { readFresh, refusedByStore } from "./live";
import * as repo from "./repo";
import type { RunCtx } from "./writes";

/**
 * "Elimina", run and undone. A product goes to WordPress's trash — which
 * WordPress empties by itself after 30 days — and out of the Hub: its copy of
 * the shop (so no sync plans it), the store index (so the Vetrina stops
 * listing it), the catalog (so Publish never offers it again; a deliberate
 * import brings it back), the photo queue. A product the supplier's feed
 * carries is left as it is: the feed decides what is in the shop. Which
 * products those are is the sources' rule (src/server/vetrina/sources.ts),
 * the one the owner sees as their colour, read strictly: a feed that cannot
 * be read stops the run before anything goes.
 *
 * Each product is its own request: WooCommerce's batch endpoint deletes for
 * good, never to the trash. Its sizes, its status and its catalog rows are
 * filed before it goes, so "Annulla" can bring it back as it was. A request
 * that gets no answer may have trashed the product all the same: it is
 * looked at before the run stops, and what did go leaves the Hub with the
 * rest.
 *
 * On the demo shop only the demo's products go: the Hub's copy of the shop,
 * its catalog and its photos are the real shop's, whose ids and SKUs the
 * demo's may share.
 */

/** Products read per request. */
const CHUNK = 25;
/** Products deleted side by side within a chunk. */
const AT_ONCE = 4;

/** What bringing a deleted product back needs, filed before it goes to the trash. */
export interface DeletedRecord {
  /** Its status before ("publish", "draft", "private"): the one "Annulla" puts back. */
  status: string;
  sku: string;
  /**
   * Its sizes, each with its status ("publish", or "private" for one switched
   * off). WooCommerce trashes them with their product, and bringing the
   * product back through the API brings back the product alone.
   */
  sizes: { id: number; status: string }[];
  /** Its catalog rows as they were: the Hub forgets them, and "Annulla" puts them back. */
  catalog: CatalogRowRecord[];
}

const statusOf = (row: unknown, fallback: string) => {
  const status = (row as { status?: unknown } | null)?.status;
  return typeof status === "string" && status !== "" ? status : fallback;
};

export async function runDelete(ctx: RunCtx, ids: number[]): Promise<void> {
  const { op, client, tally } = ctx;
  const hub = !demoMode();
  // Decided as it runs: the feed may have taken a product on since the preview.
  const sources = await readSourceFacts();
  for (const chunk of chunks(ids, CHUNK)) {
    const live = await readFresh(client, chunk);
    const todo = chunk.flatMap((id) => {
      const p = live.get(id);
      return p && isDeletable(productSource(p.sku ?? "", sources)) ? [p] : [];
    });
    const deleted: number[] = [];
    try {
      await mapLimit(todo, AT_ONCE, async (p) => {
        const sku = p.sku ?? "";
        const sizes =
          p.type === "variable"
            ? (await client.getAllVariations(p.id, { fields: "id,status" })).map((v) => ({ id: v.id, status: statusOf(v, "publish") }))
            : [];
        // Out of the catalog, and filed with what it was, before the write: a lost answer can still be undone.
        const catalog = hub && sku ? await takeCatalogRows([sku]) : [];
        const record: DeletedRecord = { status: statusOf(p, "publish"), sku, sizes, catalog };
        await repo.addItems(op.id, [{ productId: p.id, field: "deleted", before: record, after: "trash" }]);
        // Still in the shop after all: in the Hub as it was, and nothing to undo.
        const stays = async () => {
          await restoreCatalogRows(catalog);
          await repo.dropItems(op.id, "deleted", [{ productId: p.id }]);
        };
        // Its photos before the product: the first to land puts its product on sale, out of the trash.
        if (hub && sku) await cancelMedia([sku]);
        try {
          await client.deleteProduct(p.id);
        } catch (e) {
          if (refusedByStore(e)) {
            await stays();
            tally.failed += 1;
            return;
          }
          // No answer: WordPress often finishes all the same. Looked at before the run stops; when even
          // that fails, it stays filed, and "Annulla" finds out.
          const now = await client.getProduct(p.id).catch(() => undefined);
          if (now !== undefined) {
            if (now && now.status !== "trash") await stays();
            else deleted.push(p.id);
          }
          throw e;
        }
        deleted.push(p.id);
      });
    } finally {
      // Out of the Hub's copy of the shop and of the Vetrina's lists at once, not at the next pull — those
      // trashed before a request failed too: the 5-minute check of the index never sees the trash.
      if (hub) await removeSnapshotProducts(deleted);
      await deleteIndexRows(deleted);
      tally.changed += deleted.length;
    }
    tally.done += chunk.length;
    await ctx.step();
  }
}

/** What a delete's undo did with each product: back (or found back), left (gone for good, or changed since), refused. */
export interface DeleteUndoTally {
  restored: Set<number>;
  kept: Set<number>;
  failed: Set<number>;
}

/**
 * "Annulla": each product out of the trash with the status it had, its sizes
 * with theirs, and known to the Hub again. One put back by hand meanwhile is
 * found back; one emptied from the trash cannot come back, and one whose
 * status changed since is someone's newer word — both are left (kept). So is
 * one whose SKU another product carries now: WooCommerce does not count the
 * trash's SKUs, so the same product can be imported and published again
 * meanwhile, and bringing the old one back would make two of it.
 */
export async function undoDelete(ctx: RunCtx, items: VetrinaOperationItemRow[], out: DeleteUndoTally): Promise<void> {
  const { client } = ctx;
  const hub = !demoMode();
  for (const chunk of chunks(items, CHUNK)) {
    const back: number[] = [];
    await mapLimit(chunk, AT_ONCE, async (item) => {
      const id = item.productId;
      const was = item.before as DeletedRecord;
      try {
        const now = await client.getProduct(id);
        if (!now) {
          out.kept.add(id);
          return;
        }
        if (now.status === "trash") {
          if (was.sku && (await client.findProductsBySku(was.sku)).some((other) => other.id !== id && other.status !== "trash")) {
            out.kept.add(id);
            return;
          }
          await client.updateProduct(id, { status: was.status });
          for (const part of chunks(was.sizes, 100)) {
            const res = await client.batchVariations(id, { update: part.map((s) => ({ id: s.id, status: s.status })) });
            const refused = res.update.filter((row) => row.error != null).length;
            if (refused > 0) console.warn(`[vetrina] product ${id} back without ${refused} of its sizes: the store refused them`);
          }
          out.restored.add(id);
        } else if (now.status === was.status) out.restored.add(id);
        else out.kept.add(id);
      } catch (e) {
        if (!refusedByStore(e)) throw e;
        out.failed.add(id);
        return;
      }
      // In the shop again, one way or another: the Hub knows it again.
      if (hub) {
        await restoreCatalogRows(was.catalog);
        await relearn(ctx, id);
      }
      back.push(id);
    });
    // The Vetrina lists them again.
    await readFresh(client, back);
    ctx.tally.done += chunk.length;
    await ctx.step();
  }
}

/** A product back in the shop, back in the Hub's copy of it — as the pull would have it: published products only. */
async function relearn(ctx: RunCtx, id: number): Promise<void> {
  const product = await ctx.client.getProduct(id);
  if (!product || product.status !== "publish") return;
  const variations = product.type === "variable" ? await ctx.client.getAllVariations(id) : [];
  await upsertSnapshotProducts([toStoreProduct(product, variations)]);
}
