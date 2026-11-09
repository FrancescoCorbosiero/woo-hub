import "server-only";
import type { OperationInput, OperationPreview } from "@/lib/vetrina/catalog-ops";
import { getCatalogEntry } from "@/server/catalog/repo";
import { loadDrawerData } from "@/server/catalog/drawer-data";
import { readIndexFacts, type IndexFacts } from "@/server/collections/repo";
import { demoMode, storeClient } from "@/server/collections/store";
import { getActiveConfig } from "@/server/config/repo";
import type { VetrinaOperationItemRow } from "@/server/db/schema";
import { manualPriceFor, withVariationPrice } from "@/server/overrides/model";
import { getOverrides, updateOverrides } from "@/server/overrides/repo";
import { supersedeStoreEdits } from "@/server/sync/ledger";
import { runPriceSync } from "@/server/sync/price-sync";
import type { WooClient } from "@/server/woo/client";
import { messageOf, readFresh, settleBatch } from "./live";
import type { Assessment } from "./preview";
import * as repo from "./repo";
import { words } from "./words";

/**
 * "Allinea i prezzi" (lib/vetrina/catalog-ops.ts, priceMatch): each product
 * brought to the price another site shows for it — its cheapest size at that
 * price, every other size moved by the same amount, so the sizes keep their
 * spread.
 *
 * The engine (KicksDB, the supplier's feed) prices the Hub's products again
 * and again: a price written over it would last until the next sync. So a
 * product the Hub prices gets its new prices as LOCKS — the "manual is
 * sacred" of the product's sheet, which the sync writes exactly and never
 * changes — written through the ordinary sync (the live check included). A
 * simple product the Hub does not price (the shop's own) gets its regular
 * price written, nothing else ever writing it. Left as they are, and said
 * why: a product on sale (the sync leaves a sale's sizes alone), one with no
 * price of the Hub's, one at that price already, one with sizes the Hub does
 * not price.
 *
 * "Annulla" puts back each lock (or price) that is still as the action left
 * it, and has the sync write the prices again.
 */

type PriceMatchInput = Extract<OperationInput, { kind: "priceMatch" }>;

export interface SizeShift {
  euSize: string;
  now: number;
  next: number;
  /** The market's lowest ask for it, when known: a price under it sells at a loss. */
  ask: number | null;
}

export type ProductPlan =
  | { mode: "locks"; productId: number; sku: string; name: string; from: number; target: number; sizes: SizeShift[] }
  | { mode: "simple"; productId: number; sku: string; name: string; from: number; target: number };

export type Skip = "gone" | "onSale" | "unpriced" | "same" | "sizes";

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Under a cent is the same price. */
const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * One product's plan, as the sync will price it now: its sizes' prices —
 * a lock, else a price someone set in WordPress and the sync keeps, else the
 * engine's — the cheapest of them, and each moved by the same amount.
 */
export async function planProduct(
  client: WooClient,
  item: { productId: number; price: number },
  fact: IndexFacts | undefined,
  market: string,
): Promise<ProductPlan | Skip> {
  if (!fact || fact.status === "trash") return "gone";
  if (fact.onSale) return "onSale";
  const target = round2(item.price);
  const entry = fact.sku ? await getCatalogEntry(market, fact.sku).catch(() => null) : null;
  if (entry) {
    const drawer = await loadDrawerData(market, entry.sku, await getActiveConfig());
    const priced = (drawer?.variants ?? []).flatMap((v) => {
      const now = v.manual ?? v.storeEdit?.storePrice ?? v.proposed;
      return v.euSize && now != null ? [{ euSize: v.euSize, now, ask: v.ask }] : [];
    });
    if (priced.length === 0) return "unpriced";
    const from = Math.min(...priced.map((s) => s.now));
    if (sameMoney(from, target)) return "same";
    const shift = target - from;
    return {
      mode: "locks",
      productId: item.productId,
      sku: entry.sku,
      name: fact.name,
      from,
      target,
      sizes: priced.map((s) => ({ ...s, next: Math.max(1, round2(s.now + shift)) })),
    };
  }
  // Not the Hub's to price: the shop's own simple product takes the price itself; one with sizes is changed from its sheet.
  const live = (await client.getProduct(item.productId).catch(() => null)) as { type?: string; regular_price?: string } | null;
  if (!live) return "gone";
  if (live.type !== "simple") return "sizes";
  const regular = Number.parseFloat(live.regular_price ?? "");
  if (!Number.isFinite(regular)) return "unpriced";
  if (sameMoney(regular, target)) return "same";
  return { mode: "simple", productId: item.productId, sku: fact.sku, name: fact.name, from: regular, target };
}

/** The plans for the items, in their order, and what is left as it is, by why. */
export async function planAll(
  client: WooClient,
  input: PriceMatchInput,
): Promise<{ plans: ProductPlan[]; skipped: Map<Skip, number> }> {
  const [facts, config] = await Promise.all([readIndexFacts(), getActiveConfig()]);
  const byId = new Map(facts.map((f) => [f.id, f]));
  const plans: ProductPlan[] = [];
  const skipped = new Map<Skip, number>();
  // The same product named twice: its last price stands.
  const items = [...new Map(input.items.map((i) => [i.productId, i])).values()];
  for (const item of items) {
    const plan = await planProduct(client, item, byId.get(item.productId), config.source.market);
    if (typeof plan === "string") skipped.set(plan, (skipped.get(plan) ?? 0) + 1);
    else plans.push(plan);
  }
  return { plans, skipped };
}

const SAMPLE = 20;

/** Its preview: the products moved, from → to; what is left, by why; what to know first. */
export function previewOf(plans: readonly ProductPlan[], skipped: ReadonlyMap<Skip, number>): OperationPreview {
  const w = words();
  const reason: Record<Skip, (n: number) => string> = {
    gone: w.untouched.gone,
    onSale: w.untouched.priceOnSale,
    unpriced: w.untouched.priceUnpriced,
    same: w.untouched.priceSame,
    sizes: w.untouched.priceSizes,
  };
  const locked = plans.filter((p) => p.mode === "locks");
  const below = locked.filter((p) => p.sizes.some((s) => s.ask != null && s.next < s.ask)).length;
  return {
    kind: "priceMatch",
    changes: plans.length,
    untouched: [...skipped].map(([why, count]) => ({ reason: reason[why](count), count })),
    sample: plans.slice(0, SAMPLE).map((p) => ({ id: p.productId, name: p.name, before: w.state.from(w.money(p.from)), after: w.state.from(w.money(p.target)) })),
    warnings: [...(locked.length > 0 ? [w.warning.priceLocks(locked.length)] : []), ...(below > 0 ? [w.warning.priceBelowMarket(below)] : [])],
  };
}

/** The preview, for the sheet, a proposal and the start: the products as they are priced now. */
export async function assessPriceMatch(input: PriceMatchInput): Promise<Assessment> {
  const { plans, skipped } = await planAll(await storeClient(), input);
  return {
    preview: previewOf(plans, skipped),
    label: { kind: "priceMatch", count: plans.length, source: input.source ?? "" },
    termKey: null,
    total: plans.length,
    refusal: null,
  };
}

/* ---------------------------------------------------------------- *
 * The run, and its undo
 * ---------------------------------------------------------------- */

interface LockRecord {
  sku: string;
  prices: Record<string, number | null>;
}

/**
 * The Hub's products whose locks changed, priced again through the ordinary
 * sync, a slice at a time — then read back, so the index (and the
 * comparison) shows the new prices. Never on the demo shop.
 */
async function reprice(client: WooClient, locked: readonly { sku: string; productId: number }[]): Promise<void> {
  if (demoMode() || locked.length === 0) return;
  for (let i = 0; i < locked.length; i += 25) {
    const slice = locked.slice(i, i + 25);
    try {
      await runPriceSync({ skus: slice.map((l) => l.sku), liveCheck: true });
    } catch (e) {
      // The locks are saved: the next sync writes them all the same.
      console.warn(`[vetrina-ops] locked prices not written now (the next sync does it): ${messageOf(e)}`);
      continue;
    }
    // The index learns the prices written (the comparison shows them at once); its next check would too.
    await readFresh(client, slice.map((l) => l.productId)).catch(() => undefined);
  }
}

/** Write one product's plan, filed for "Annulla"; true when written. */
async function writePlan(opId: string, client: WooClient, plan: ProductPlan): Promise<boolean> {
  if (plan.mode === "simple") {
    await repo.addItems(opId, [{ productId: plan.productId, field: "price", before: { regular: plan.from }, after: { regular: plan.target } }]);
    const answers = await client.batchUpdateProducts([{ id: plan.productId, regular_price: plan.target.toFixed(2) }]);
    // The index learns the new price with the store's answer.
    const { saved } = await settleBatch([plan.productId], answers);
    if (!saved.has(plan.productId)) {
      await repo.dropItems(opId, "price", [{ productId: plan.productId }]);
      return false;
    }
    return true;
  }
  const before: LockRecord = { sku: plan.sku, prices: {} };
  const after: LockRecord = { sku: plan.sku, prices: {} };
  await updateOverrides((current) => {
    let next = current;
    for (const size of plan.sizes) {
      before.prices[size.euSize] = manualPriceFor(current, plan.sku, size.euSize);
      after.prices[size.euSize] = size.next;
      next = withVariationPrice(next, plan.sku, size.euSize, size.next);
    }
    return next;
  });
  await repo.addItems(opId, [{ productId: plan.productId, field: "lock", before, after }]);
  // The newest word on those sizes: over a price someone changed in WordPress (sync/ledger.ts).
  await supersedeStoreEdits(plan.sku, plan.sizes.map((s) => s.euSize)).catch(() => undefined);
  return true;
}

/** The run: each product planned again now (the engine may have moved since the preview), written, then the sync. */
export async function runPriceMatch(
  ctx: { op: { id: string }; client: WooClient; tally: { done: number; total: number; changed: number; failed: number }; step(): Promise<void> },
  input: PriceMatchInput,
): Promise<void> {
  const { plans } = await planAll(ctx.client, input);
  ctx.tally.total = plans.length;
  await ctx.step();
  const locked: { sku: string; productId: number }[] = [];
  for (const plan of plans) {
    try {
      if (await writePlan(ctx.op.id, ctx.client, plan)) {
        ctx.tally.changed += 1;
        if (plan.mode === "locks") locked.push({ sku: plan.sku, productId: plan.productId });
      } else ctx.tally.failed += 1;
    } catch (e) {
      console.warn(`[vetrina-ops] «${plan.name}»: price not matched: ${messageOf(e)}`);
      ctx.tally.failed += 1;
    }
    ctx.tally.done += 1;
    await ctx.step();
  }
  await reprice(ctx.client, locked);
}

/** "Annulla": each lock (or price) back while it is as the action left it; a size changed since stays. */
export async function undoPriceMatch(
  client: WooClient,
  items: readonly VetrinaOperationItemRow[],
): Promise<{ restored: number; kept: number; failed: number }> {
  let restored = 0;
  let kept = 0;
  let failed = 0;
  const relocked: { sku: string; productId: number }[] = [];
  for (const item of items) {
    if (item.field === "lock") {
      const before = item.before as LockRecord;
      const after = item.after as LockRecord;
      const current = await getOverrides();
      const back = Object.keys(after.prices).filter((eu) => manualPriceFor(current, after.sku, eu) === after.prices[eu]);
      if (back.length === 0) {
        kept += 1;
        continue;
      }
      await updateOverrides((now) => back.reduce((next, eu) => withVariationPrice(next, after.sku, eu, before.prices[eu] ?? null), now));
      await supersedeStoreEdits(after.sku, back).catch(() => undefined);
      relocked.push({ sku: after.sku, productId: item.productId });
      if (back.length === Object.keys(after.prices).length) restored += 1;
      else kept += 1;
    } else if (item.field === "price") {
      const before = item.before as { regular: number };
      const after = item.after as { regular: number };
      const live = (await client.getProduct(item.productId).catch(() => null)) as { regular_price?: string } | null;
      const now = Number.parseFloat(live?.regular_price ?? "");
      if (!live || !sameMoney(now, after.regular)) {
        kept += 1;
        continue;
      }
      const answers = await client.batchUpdateProducts([{ id: item.productId, regular_price: before.regular.toFixed(2) }]);
      const { saved } = await settleBatch([item.productId], answers);
      if (saved.has(item.productId)) restored += 1;
      else failed += 1;
    }
  }
  await reprice(client, relocked);
  return { restored, kept, failed };
}
