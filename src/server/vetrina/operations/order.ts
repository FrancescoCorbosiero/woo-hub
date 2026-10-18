import "server-only";
import type { OperationInput, OperationPreview, TermKey } from "@/lib/vetrina/catalog-ops";
import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import { decodeEntities } from "@/server/collections/index-rows";
import { readIndexFacts, type IndexFacts } from "@/server/collections/repo";
import { storeClient } from "@/server/collections/store";
import {
  ancestorIds,
  compareFacts,
  defaultCategoryIds,
  homepagePresence,
  matchingIds,
  readCatalogTrees,
  withDescendants,
  type CatalogTrees,
} from "@/server/vetrina/catalog";
import { getSource, matchAgainst } from "@/server/vetrina/order-sources/service";
import { VetrinaError } from "@/server/vetrina/source";
import type { VetrinaOperationItemRow } from "@/server/db/schema";
import type { WooClient } from "@/server/woo/client";
import { chunks, resolveTarget, rowsInOrder, termKeyOf, termName } from "./context";
import { readFresh, settleBatch } from "./live";
import { movedTargets, planOrder, type OrderMember, type OrderPlan } from "./order-plan";
import { bump, labelParams, otherTerms, reasonCounts, undoVerdict, type Reason } from "./plan";
import type { Assessment } from "./preview";
import * as repo from "./repo";
import { words, type Words } from "./words";
import type { RunCtx } from "./writes";

/**
 * "Ordina": products placed in a category's or a brand's own order — the
 * shop's order, WooCommerce's `menu_order`, which the storefront's pages
 * follow. And "Usa l'ordine di «X»" (sourceOrder): the products an order
 * source ranks first, in its order, in a category, a brand or the whole
 * catalog. The plan (order-plan.ts) picks the fewest numbers to change; the
 * run reads them live first, writes them through products/batch and files
 * each one (before → after) so "Annulla" puts them back.
 */

type OrderInput = Extract<OperationInput, { kind: "order" }>;
type SourceOrderInput = Extract<OperationInput, { kind: "sourceOrder" }>;
type Term = { taxonomy: CatalogTaxonomy; id: number };

/** Products read and written per request (products/batch takes 100). */
const CHUNK = 50;
/** Products a preview names. */
const SAMPLE = 20;
/** A plan made again when the store shows other numbers than the index did. */
const REPLANS = 3;

export interface TermOrder {
  /** The products (a term's, its sub-terms' included, or the whole shop's) in the shop's order now. */
  members: OrderMember[];
  /** The store's categories and brands; null for the whole shop, which does not need them. */
  trees: CatalogTrees | null;
  names: Map<number, string>;
  /** The index as read: every product, in the shop's order. */
  facts: IndexFacts[];
}

/**
 * A category's or brand's products in the shop's order, as the catalog's
 * "Ordina: Negozio" lists them — or, for no term, every product of the shop
 * (its "/shop" page's order).
 */
export async function readScopeOrder(term: Term | null): Promise<TermOrder> {
  const [unsorted, trees] = await Promise.all([readIndexFacts(), term ? readCatalogTrees() : Promise.resolve(null)]);
  const facts = unsorted.sort(compareFacts("shop"));
  if (term && !trees![term.taxonomy].terms.has(term.id)) throw new VetrinaError("not_found", words().error.termGone, 404);
  const byId = new Map(facts.map((f) => [f.id, f]));
  const ids = term ? matchingIds(facts, { taxonomy: term.taxonomy, termId: term.id, sort: "shop" }, trees!) : facts.map((f) => f.id);
  return {
    members: ids.map((pid) => ({ id: pid, menuOrder: byId.get(pid)!.menuOrder })),
    trees,
    names: new Map(ids.map((pid) => [pid, decodeEntities(byId.get(pid)!.name)])),
    facts,
  };
}

export async function readTermOrder(taxonomy: CatalogTaxonomy, id: number): Promise<TermOrder> {
  return readScopeOrder({ taxonomy, id });
}

const keyOf = (term: Term): TermKey => termKeyOf(term.taxonomy, term.id);

/**
 * Of these products, the other categories and brands they show in — not
 * the term itself, its sub-terms or the terms above it, whose pages follow
 * this order on purpose.
 */
function elsewhere(rows: { categories: { id: number }[]; brands: { id: number }[] }[], term: Term, trees: CatalogTrees) {
  const own = new Set([
    ...withDescendants(term.id, trees[term.taxonomy].children),
    ...ancestorIds(term.id, trees[term.taxonomy].parents),
  ]);
  const defaults = defaultCategoryIds(trees.category);
  const names = new Map<string, string>();
  for (const t of trees.category.terms.values()) {
    if (defaults.has(t.id) || (term.taxonomy === "category" && own.has(t.id))) continue;
    names.set(`category:${t.id}`, t.name);
  }
  for (const t of trees.brand.terms.values()) {
    if (term.taxonomy === "brand" && own.has(t.id)) continue;
    names.set(`brand:${t.id}`, t.name);
  }
  return otherTerms(
    rows.map((r) => ({ terms: [...r.categories.map((c) => `category:${c.id}`), ...r.brands.map((b) => `brand:${b.id}`)] })),
    names,
  );
}

type Move = { id: number; from: number; to: number };

/**
 * What every order's preview says, besides its own reasons: the products
 * renumbered to make room, those that move in other categories too (one
 * number per product), a homepage section's pins first on the category's
 * page, and a storefront that does not sort by the shop's order.
 */
async function orderWarnings(
  w: Words,
  plan: OrderPlan,
  moves: readonly Move[],
  term: Term | null,
  trees: CatalogTrees | null,
  live: boolean,
): Promise<string[]> {
  const warnings: string[] = [];
  const moved = new Set(moves.map((m) => m.id));
  const others = plan.writes.filter((x) => !moved.has(x.id)).length;
  if (others > 0) warnings.push(w.warning.orderRoom(others));
  // The whole catalog at once: every category follows the same order, nothing moves "elsewhere".
  if (term && trees && plan.writes.length > 0) {
    const { rows } = await rowsInOrder(plan.writes.map((x) => x.id));
    const other = elsewhere(rows, term, trees);
    if (other.count > 0) warnings.push(w.warning.orderElsewhere(other.count, other.names, other.total));
  }
  if (term?.taxonomy === "category") {
    const sections = (await homepagePresence()).terms.get(keyOf(term)) ?? [];
    if (sections.length > 0) warnings.push(w.warning.orderPins(sections.map((s) => s.title || s.key)));
  }
  if (live) {
    const sort = await (await storeClient()).getDefaultCatalogOrderby?.().catch(() => null);
    if (sort && sort !== "menu_order") warnings.push(w.warning.orderNotUsed(sort));
  }
  return warnings;
}

/** The products moved, from where to where, in the preview's words. */
function sampleOf(moves: readonly Move[], names: ReadonlyMap<number, string>, w: Words): OperationPreview["sample"] {
  return moves.slice(0, SAMPLE).map((m) => ({
    id: m.id,
    name: names.get(m.id) ?? `#${m.id}`,
    before: w.state.place(m.from),
    after: w.state.place(m.to),
  }));
}

/* ---------------------------------------------------------------- *
 * "Ordina": these products, at a place
 * ---------------------------------------------------------------- */

/** The plan over the term as the index has it now. */
async function planNow(input: OrderInput, targets: number[]): Promise<{ plan: OrderPlan; order: TermOrder }> {
  const order = await readTermOrder(input.term.taxonomy, input.term.id);
  return { plan: planOrder(order.members, targets, input.position), order };
}

/** What "Ordina" would do: the products moved, from where to where, and what to know. `live`: ask the store how its pages sort. */
export async function assessOrder(input: OrderInput, opts: { live: boolean }): Promise<Assessment> {
  const w = words();
  const { ids } = await resolveTarget(input.target);
  const { plan, order } = await planNow(input, ids);
  const term = termName(order.trees!, keyOf(input.term));
  const moves = movedTargets(order.members, plan.order, ids);
  const inTerm = new Set(ids).size - plan.outside.length;
  // The rows of "Riordina": the term's order changed where they were dragged, not a block put in one place.
  const reordered = input.reorder === true;

  const refusal = plan.position == null ? w.error.notInTerm(term) : plan.writes.length === 0 ? w.error.inOrder : null;
  const untouched = new Map<Reason, number>();
  bump(untouched, (count) => w.untouched.notInTerm(count, term), plan.outside.length);
  if (plan.position != null && !reordered) bump(untouched, w.untouched.inPlace, inTerm - moves.length);
  const warnings = await orderWarnings(w, plan, moves, input.term, order.trees, opts.live);

  return {
    preview: {
      kind: "order",
      changes: refusal ? 0 : moves.length,
      untouched: reasonCounts(untouched),
      sample: sampleOf(moves, order.names, w),
      warnings: refusal ? [refusal, ...warnings] : warnings,
    },
    label: labelParams(input, {
      count: moves.length,
      term,
      position: input.position == null ? null : plan.position,
      reordered,
    }),
    termKey: null,
    total: plan.writes.length,
    refusal,
  };
}

/** Run "Ordina" over its target, resolved now. */
export async function runOrder(ctx: RunCtx, input: OrderInput): Promise<void> {
  const { ids } = await resolveTarget(input.target);
  await writePlan(ctx, async () => (await planNow(input, ids)).plan);
}

/* ---------------------------------------------------------------- *
 * "Usa l'ordine di «X»": an order source's ranking
 * ---------------------------------------------------------------- */

/**
 * A source's plan: the products it ranks that the scope holds (a term's, or
 * the whole shop's), in its order, at the top; the others after them, in
 * their order.
 */
async function planFromSource(input: SourceOrderInput) {
  const [source, order] = await Promise.all([getSource(input.sourceId), readScopeOrder(input.term)]);
  const match = matchAgainst(source.items, order.facts);
  const inScope = new Set(order.members.map((m) => m.id));
  const ranked = match.ranked.filter((id) => inScope.has(id));
  return { source, order, match, ranked, plan: planOrder(order.members, ranked, 1) };
}

/** What "Usa l'ordine di «X»" would do: the products moved, those the source does not rank, what to know. */
export async function assessSourceOrder(input: SourceOrderInput, opts: { live: boolean }): Promise<Assessment> {
  const w = words();
  const { source, order, match, ranked, plan } = await planFromSource(input);
  const scope = input.term ? termName(order.trees!, keyOf(input.term)) : w.source.wholeCatalog;
  const moves = movedTargets(order.members, plan.order, ranked);

  const refusal =
    ranked.length === 0
      ? input.term
        ? w.source.noneInTerm(scope, source.name)
        : w.source.noneInShop(source.name)
      : plan.writes.length === 0
        ? w.source.inOrder(source.name)
        : null;
  const untouched = new Map<Reason, number>();
  bump(untouched, (count) => w.untouched.notRanked(count, source.name), order.members.length - ranked.length);
  bump(untouched, w.untouched.inPlace, ranked.length - moves.length);
  const warnings = await orderWarnings(w, plan, moves, input.term, order.trees, opts.live);
  // On the whole catalog, the source's own products the shop does not have: worth knowing once.
  if (!input.term && match.unmatched.length > 0) warnings.push(w.warning.sourceUnmatched(match.unmatched.length, source.items.length));

  return {
    preview: {
      kind: "sourceOrder",
      changes: refusal ? 0 : moves.length,
      untouched: reasonCounts(untouched),
      sample: sampleOf(moves, order.names, w),
      warnings: refusal ? [refusal, ...warnings] : warnings,
    },
    label: labelParams(input, { count: moves.length, term: input.term ? scope : null, source: source.name }),
    termKey: null,
    total: plan.writes.length,
    refusal,
  };
}

/** Run "Usa l'ordine di «X»": the source read and matched again now, as it is. */
export async function runSourceOrder(ctx: RunCtx, input: SourceOrderInput): Promise<void> {
  await writePlan(ctx, async () => (await planFromSource(input)).plan);
}

/* ---------------------------------------------------------------- *
 * Writing a plan, and its undo
 * ---------------------------------------------------------------- */

/**
 * Write an order's plan: made over the index, its products read live — and
 * made again while the store shows other numbers than the index had (the
 * read taught the index) — then written, a chunk at a time, each filed first.
 */
async function writePlan(ctx: RunCtx, makePlan: () => Promise<OrderPlan>): Promise<void> {
  const { op, client, tally } = ctx;
  let plan = await makePlan();
  for (let round = 1; round < REPLANS; round++) {
    const stale = await staleWrites(client, plan);
    if (!stale) break;
    plan = await makePlan();
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
