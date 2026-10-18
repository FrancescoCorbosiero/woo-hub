import "server-only";
import type { OperationInput, TermKey } from "@/lib/vetrina/catalog-ops";
import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import { readIndexFacts } from "@/server/collections/repo";
import { storeClient } from "@/server/collections/store";
import {
  ancestorIds,
  defaultCategoryIds,
  homepagePresence,
  matchingIds,
  readCatalogTrees,
  withDescendants,
  type CatalogTrees,
} from "@/server/vetrina/catalog";
import { VetrinaError } from "@/server/vetrina/source";
import type { VetrinaOperationItemRow } from "@/server/db/schema";
import type { WooClient } from "@/server/woo/client";
import { chunks, resolveTarget, rowsInOrder, termKeyOf, termName } from "./context";
import { readFresh, settleBatch } from "./live";
import { planOrder, type OrderMember, type OrderPlan } from "./order-plan";
import { bump, labelParams, otherTerms, reasonCounts, undoVerdict, type Reason } from "./plan";
import type { Assessment } from "./preview";
import * as repo from "./repo";
import { words } from "./words";
import type { RunCtx } from "./writes";

/**
 * "Ordina": products placed in a category's or a brand's own order — the
 * shop's order, WooCommerce's `menu_order`, which the storefront's pages
 * follow. The plan (order-plan.ts) picks the fewest numbers to change; the
 * run reads them live first, writes them through products/batch and files
 * each one (before → after) so "Annulla" puts them back.
 */

type OrderInput = Extract<OperationInput, { kind: "order" }>;

/** Products read and written per request (products/batch takes 100). */
const CHUNK = 50;
/** Products a preview names. */
const SAMPLE = 20;
/** A plan made again when the store shows other numbers than the index did. */
const REPLANS = 3;

export interface TermOrder {
  /** The term's products (its sub-terms' included) in the shop's order now. */
  members: OrderMember[];
  trees: CatalogTrees;
  names: Map<number, string>;
}

/** A category's or brand's products in the shop's order, as the catalog's "Ordina: Negozio" lists them. */
export async function readTermOrder(taxonomy: CatalogTaxonomy, id: number): Promise<TermOrder> {
  const [facts, trees] = await Promise.all([readIndexFacts(), readCatalogTrees()]);
  if (!trees[taxonomy].terms.has(id)) throw new VetrinaError("not_found", words().error.termGone, 404);
  const byId = new Map(facts.map((f) => [f.id, f]));
  const ids = matchingIds(facts, { taxonomy, termId: id, sort: "shop" }, trees);
  return {
    members: ids.map((pid) => ({ id: pid, menuOrder: byId.get(pid)!.menuOrder })),
    trees,
    names: new Map(ids.map((pid) => [pid, byId.get(pid)!.name])),
  };
}

const keyOf = (input: OrderInput): TermKey => termKeyOf(input.term.taxonomy, input.term.id);

/** The plan over the term as the index has it now. */
async function planNow(input: OrderInput, targets: number[]): Promise<{ plan: OrderPlan; order: TermOrder }> {
  const order = await readTermOrder(input.term.taxonomy, input.term.id);
  return { plan: planOrder(order.members, targets, input.position), order };
}

/** The targets whose place in the order changes, from where to where (1-based), in their new order. */
function moved(members: readonly OrderMember[], plan: OrderPlan, targets: readonly number[]): { id: number; from: number; to: number }[] {
  const was = new Map(members.map((m, i) => [m.id, i + 1]));
  const asked = new Set(targets);
  return plan.order.flatMap((id, i) => (asked.has(id) && was.get(id) !== i + 1 ? [{ id, from: was.get(id)!, to: i + 1 }] : []));
}

/**
 * Of these products, the other categories and brands they show in — not
 * the term itself, its sub-terms or the terms above it, whose pages follow
 * this order on purpose.
 */
function elsewhere(ids: readonly number[], rows: { id: number; categories: { id: number }[]; brands: { id: number }[] }[], input: OrderInput, trees: CatalogTrees) {
  const own = new Set([
    ...withDescendants(input.term.id, trees[input.term.taxonomy].children),
    ...ancestorIds(input.term.id, trees[input.term.taxonomy].parents),
  ]);
  const defaults = defaultCategoryIds(trees.category);
  const names = new Map<string, string>();
  for (const t of trees.category.terms.values()) {
    if (defaults.has(t.id) || (input.term.taxonomy === "category" && own.has(t.id))) continue;
    names.set(`category:${t.id}`, t.name);
  }
  for (const t of trees.brand.terms.values()) {
    if (input.term.taxonomy === "brand" && own.has(t.id)) continue;
    names.set(`brand:${t.id}`, t.name);
  }
  const wanted = new Set(ids);
  return otherTerms(
    rows.filter((r) => wanted.has(r.id)).map((r) => ({ terms: [...r.categories.map((c) => `category:${c.id}`), ...r.brands.map((b) => `brand:${b.id}`)] })),
    names,
  );
}

/** What "Ordina" would do: the products moved, from where to where, and what to know. `live`: ask the store how its pages sort. */
export async function assessOrder(input: OrderInput, opts: { live: boolean }): Promise<Assessment> {
  const w = words();
  const { ids } = await resolveTarget(input.target);
  const { plan, order } = await planNow(input, ids);
  const term = termName(order.trees, keyOf(input));
  const moves = moved(order.members, plan, ids);
  const others = plan.writes.length - moves.length;

  const refusal = plan.position == null ? w.error.notInTerm(term) : plan.writes.length === 0 ? w.error.inOrder : null;
  const untouched = new Map<Reason, number>();
  bump(untouched, (count) => w.untouched.notInTerm(count, term), plan.outside.length);
  if (plan.position != null) bump(untouched, w.untouched.inPlace, new Set(ids).size - plan.outside.length - moves.length);

  const warnings: string[] = [];
  if (others > 0) warnings.push(w.warning.orderRoom(others));
  if (plan.writes.length > 0) {
    const written = plan.writes.map((x) => x.id);
    const { rows } = await rowsInOrder(written);
    const other = elsewhere(written, rows, input, order.trees);
    if (other.count > 0) warnings.push(w.warning.orderElsewhere(other.count, other.names, other.total));
  }
  if (input.term.taxonomy === "category") {
    const sections = (await homepagePresence()).terms.get(keyOf(input)) ?? [];
    if (sections.length > 0) warnings.push(w.warning.orderPins(sections.map((s) => s.title || s.key)));
  }
  if (opts.live) {
    const sort = await (await storeClient()).getDefaultCatalogOrderby?.().catch(() => null);
    if (sort && sort !== "menu_order") warnings.push(w.warning.orderNotUsed(sort));
  }

  return {
    preview: {
      kind: "order",
      changes: refusal ? 0 : moves.length,
      untouched: reasonCounts(untouched),
      sample: moves.slice(0, SAMPLE).map((m) => ({
        id: m.id,
        name: order.names.get(m.id) ?? `#${m.id}`,
        before: w.state.place(m.from),
        after: w.state.place(m.to),
      })),
      warnings: refusal ? [refusal, ...warnings] : warnings,
    },
    label: labelParams(input, { count: moves.length, term, position: input.position == null ? null : plan.position }),
    termKey: null,
    total: plan.writes.length,
    refusal,
  };
}

/**
 * Run "Ordina": the plan made over the index, its products read live — and
 * made again while the store shows other numbers than the index had (the
 * read taught the index) — then written, a chunk at a time, each filed first.
 */
export async function runOrder(ctx: RunCtx, input: OrderInput): Promise<void> {
  const { op, client, tally } = ctx;
  const { ids } = await resolveTarget(input.target);
  let plan = (await planNow(input, ids)).plan;
  for (let round = 1; round < REPLANS; round++) {
    const stale = await staleWrites(client, plan);
    if (!stale) break;
    plan = (await planNow(input, ids)).plan;
  }
  tally.total = plan.writes.length;
  await ctx.step();
  for (const chunk of chunks(plan.writes, CHUNK)) {
    await repo.addItems(
      op.id,
      chunk.map((x) => ({ productId: x.id, field: "menu_order", before: x.before, after: x.after })),
    );
    const answers = await client.batchUpdateProducts(chunk.map((x) => ({ id: x.id, menu_order: x.after })));
    const { saved, refused } = await settleBatch(
      chunk.map((x) => x.id),
      answers,
    );
    await repo.dropItems(
      op.id,
      "menu_order",
      refused.map((productId) => ({ productId })),
    );
    tally.changed += saved.size;
    tally.failed += refused.length;
    tally.done += chunk.length;
    await ctx.step();
  }
}

/** Whether the store shows another number than the plan started from, for one of its products (the index learns it). */
async function staleWrites(client: WooClient, plan: OrderPlan): Promise<boolean> {
  let stale = false;
  for (const chunk of chunks(plan.writes, CHUNK)) {
    const live = await readFresh(
      client,
      chunk.map((x) => x.id),
    );
    if (chunk.some((x) => (live.get(x.id)?.menu_order ?? null) !== x.before)) stale = true;
  }
  return stale;
}

/** What an order's undo did with each product: put back (or found so), left (changed since or gone), refused. */
export interface OrderUndoTally {
  restored: Set<number>;
  kept: Set<number>;
  failed: Set<number>;
}

/** "Annulla": each number back where the store still shows the one the action wrote. */
export async function undoOrder(ctx: RunCtx, items: VetrinaOperationItemRow[], out: OrderUndoTally): Promise<void> {
  for (const chunk of chunks(items, CHUNK)) {
    const live = await readFresh(
      ctx.client,
      chunk.map((i) => i.productId),
    );
    const restore: { id: number; before: number }[] = [];
    for (const item of chunk) {
      const p = live.get(item.productId);
      if (!p) {
        out.kept.add(item.productId);
        continue;
      }
      const verdict = undoVerdict(p.menu_order ?? 0, item.before as number, item.after as number, (a, b) => a === b);
      if (verdict === "restore") restore.push({ id: item.productId, before: item.before as number });
      else if (verdict === "already") out.restored.add(item.productId);
      else out.kept.add(item.productId);
    }
    if (restore.length > 0) {
      const answers = await ctx.client.batchUpdateProducts(restore.map((r) => ({ id: r.id, menu_order: r.before })));
      const { saved, refused } = await settleBatch(
        restore.map((r) => r.id),
        answers,
      );
      for (const id of saved.keys()) out.restored.add(id);
      for (const id of refused) out.failed.add(id);
    }
    ctx.tally.done += chunk.length;
    await ctx.step();
  }
}
