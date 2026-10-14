import "server-only";
import { hubConfig } from "@/config";
import type { OperationInput, TermKey } from "@/lib/vetrina/catalog-ops";
import { queueProductWrite, requestCheck } from "@/server/collections/runner";
import { collectionsByTerm } from "@/server/collections/service";
import type {
  OperationSectionRecord,
  OperationUndoOutcome,
  VetrinaOperationItemRow,
  VetrinaOperationRow,
} from "@/server/db/schema";
import { readCatalogTrees, type CatalogTrees } from "@/server/vetrina/catalog";
import { publishRail, readRail } from "@/server/vetrina/service";
import { VetrinaError } from "@/server/vetrina/source";
import type { WooClient } from "@/server/woo/client";
import { chunks, mapLimit, resolveTarget, rowsInOrder, termName, wholeTermAction } from "./context";
import { patchSnapshotSales, readFresh, readSizes, settleBatch, writeSales, type SaleWrite } from "./live";
import {
  filedBefore,
  listAfter,
  pinList,
  planSale,
  planUnsale,
  sameIds,
  saleUndoVerdict,
  undoList,
  undoVerdict,
  visibilityAfter,
  type FiledSale,
  type LiveSize,
  type SaleState,
  type SizePlan,
} from "./plan";
import { repriceMoved, runMargin, undoMargin, type TermMove } from "./margin";
import { findTag } from "./preview";
import * as repo from "./repo";
import { pinnable, railFill, sectionMembers } from "./sections";
import { heldByTermHides, heldTerms, standingTermHide, standingTermHides, termNewcomers } from "./standing";
import { words } from "./words";

/**
 * The catalog's actions, run: each product read again right before it is
 * written, written through the store's batch endpoints a few at a time,
 * every value it changes filed first (before → after) so "Annulla" can put
 * it back, and the index refreshed from the store's answers. And the undo,
 * which writes a value back only where the store still shows what the
 * action wrote.
 *
 * Tags and categories are written inside the automatic categories' queue
 * (queueProductWrite), so a decision never reads a product between this
 * read and this write. The automatic categories then catch up
 * (requestCheck) after anything their rules read: tags and categories, and
 * a sale — a rule can ask for products on sale, or under a price.
 */

/** Products read and written per request. */
const CHUNK = 25;
/** A sale reads each product's sizes one by one: progress is reported more often. */
const SALE_CHUNK = 12;
/**
 * A sale's products read and written side by side, within a chunk: one
 * after another, a 2,000-product sale would take an hour or two, with every
 * other action waiting behind it. A few at a time, as the preview reads.
 */
const SALE_AT_ONCE = 4;

export interface Tally {
  done: number;
  total: number;
  changed: number;
  failed: number;
}

export interface RunCtx {
  op: VetrinaOperationRow;
  client: WooClient;
  tally: Tally;
  /** Write the progress to the action's row: the owner's progress bar. */
  step(): Promise<void>;
}

/* ---------------------------------------------------------------- *
 * Hide and show
 * ---------------------------------------------------------------- */

async function runVisibility(
  ctx: RunCtx,
  kind: "hide" | "show",
  ids: number[],
  trees: CatalogTrees,
  keepHeld = false,
  restore = false,
): Promise<void> {
  const { op, client, tally } = ctx;
  // A whole term's hide that no longer hides anything is closed before any
  // product is hidden or shown here: hiding one of its products one by one
  // must not bring it back.
  await standingTermHides();
  const termHide = op.kind === "hide" && op.termKey != null;
  if (termHide) {
    // Two hides of one term started at once: the later one gives way.
    if (await standingTermHide(op.termKey!, op)) {
      throw new VetrinaError("invalid", words().error.alreadyHidden(termName(trees, op.termKey as TermKey)), 400);
    }
    // Any earlier hide of the term is over: this one is the term's from now on.
    await repo.endOtherTermHides(op.termKey!, op.id);
  }
  // Decided as it runs: a term hidden since the preview holds its products too.
  const held = keepHeld ? await heldByTermHides(ids) : new Map<number, unknown>();
  // Back as each was before its hide ("only in search" stays so), not visible everywhere.
  const was = kind === "show" && restore ? await repo.visibilityBeforeHide(ids) : new Map<number, string>();
  for (const chunk of chunks(ids, CHUNK)) {
    const live = await readFresh(client, chunk);
    const todo: { id: number; before: string; after: string }[] = [];
    // A whole term's products hidden already: met, so never taken for newcomers to hide later.
    const met: number[] = [];
    for (const id of chunk) {
      const p = live.get(id);
      if (!p || held.has(id)) continue;
      const before = p.catalog_visibility || "visible";
      const after = visibilityAfter(kind, before, was.get(id));
      if (after) todo.push({ id, before, after });
      else if (termHide) met.push(id);
    }
    if (met.length > 0) await repo.addItems(op.id, met.map((productId) => ({ productId, field: "member", before: null, after: null })));
    if (todo.length > 0) {
      await repo.addItems(
        op.id,
        todo.map((t) => ({ productId: t.id, field: "visibility", before: t.before, after: t.after })),
      );
      const answers = await client.batchUpdateProducts(todo.map((t) => ({ id: t.id, catalog_visibility: t.after })));
      const { saved, refused } = await settleBatch(
        todo.map((t) => t.id),
        answers,
      );
      await repo.dropItems(
        op.id,
        "visibility",
        refused.map((productId) => ({ productId })),
      );
      tally.changed += saved.size;
      tally.failed += refused.length;
    }
    tally.done += chunk.length;
    await ctx.step();
  }
  // Products shown here may be all a whole term's hide still hid: it closes now.
  if (kind === "show") await standingTermHides();
}

/**
 * A hidden category's or brand's newcomers hidden with it — hiding a term
 * hides its products everywhere, those that join it later too (published
 * into it, added by an automatic rule, moved there in WordPress or from the
 * Vetrina): each filed under the term's own hide, so its "Mostra" brings
 * them back as they were; one already hidden is filed as met. Runs in the
 * actions' queue (runner.ts queueSweep), never beside an action or an undo.
 * Returns the products it hid.
 */
export async function sweepTermHides(client: WooClient): Promise<number> {
  let hidden = 0;
  for (const hide of await standingTermHides()) {
    if (hide.status !== "done" && hide.status !== "failed") continue;
    for (const chunk of chunks(await termNewcomers(hide), CHUNK)) {
      const live = await readFresh(client, chunk);
      const todo: { id: number; before: string }[] = [];
      const met: number[] = [];
      for (const id of chunk) {
        const p = live.get(id);
        if (!p) continue;
        const before = p.catalog_visibility || "visible";
        if (visibilityAfter("hide", before)) todo.push({ id, before });
        else met.push(id);
      }
      if (met.length > 0) await repo.addItems(hide.id, met.map((productId) => ({ productId, field: "member", before: null, after: null })));
      if (todo.length === 0) continue;
      await repo.addItems(
        hide.id,
        todo.map((t) => ({ productId: t.id, field: "visibility", before: t.before, after: "hidden" })),
      );
      const answers = await client.batchUpdateProducts(todo.map((t) => ({ id: t.id, catalog_visibility: "hidden" })));
      const { saved, refused } = await settleBatch(
        todo.map((t) => t.id),
        answers,
      );
      // A refusal is tried again on the next sweep.
      await repo.dropItems(
        hide.id,
        "visibility",
        refused.map((productId) => ({ productId })),
      );
      await repo.addChanged(hide.id, saved.size);
      hidden += saved.size;
    }
  }
  return hidden;
}

/* ---------------------------------------------------------------- *
 * Tags and categories
 * ---------------------------------------------------------------- */

type TermField = "tags" | "categories";
type TermChange = { add: number } | { remove: number };

/**
 * Add or remove one tag or category on these products: their whole lists
 * read live and written back, inside the automatic categories' queue.
 * `written`: changed; `already`: had nothing to change; `refused` by the store;
 * `moves`: for categories, where each written product sits now and sat
 * before (a margin set on a category follows its products).
 */
async function writeTerms(
  op: VetrinaOperationRow,
  client: WooClient,
  ids: number[],
  field: TermField,
  change: TermChange,
): Promise<{ written: number[]; already: number[]; refused: number[]; moves: TermMove[] }> {
  return queueProductWrite(async () => {
    const live = await readFresh(client, ids);
    const todo: { id: number; before: number[]; after: number[] }[] = [];
    const already: number[] = [];
    for (const id of ids) {
      const p = live.get(id);
      if (!p) continue;
      const before = (p[field] ?? []).map((t) => t.id);
      const after = listAfter(before, change);
      if (after) todo.push({ id, before, after });
      else already.push(id);
    }
    if (todo.length === 0) return { written: [], already, refused: [], moves: [] };
    await repo.addItems(
      op.id,
      todo.map((t) => ({ productId: t.id, field, before: t.before, after: t.after })),
    );
    const answers = await client.batchUpdateProducts(todo.map((t) => ({ id: t.id, [field]: t.after.map((id) => ({ id })) })));
    const { saved, refused } = await settleBatch(
      todo.map((t) => t.id),
      answers,
    );
    await repo.dropItems(
      op.id,
      field,
      refused.map((productId) => ({ productId })),
    );
    const moves: TermMove[] = [];
    for (const t of todo) {
      const p = saved.get(t.id);
      if (!p) continue;
      // The store may show more than was written — WooCommerce puts a product
      // left without categories in its default one — and the undo compares
      // against what the store shows.
      const shown = (p[field] ?? []).map((x) => x.id);
      if (!sameIds(shown, t.after)) await repo.setItemAfter(op.id, t.id, field, shown);
      if (field === "categories" && p.sku) moves.push(categoryMove(p.sku, t.before, shown, p.brands));
    }
    return { written: [...saved.keys()], already, refused, moves };
  });
}

/** A product moved between categories, its brands as they are. */
const categoryMove = (sku: string, before: number[], after: number[], brands: { id: number }[] | null | undefined): TermMove => {
  const own = (brands ?? []).map((b) => b.id);
  return { sku, before: { categories: before, brands: own }, after: { categories: after, brands: own } };
};

async function runTerms(ctx: RunCtx, ids: number[], field: TermField, change: TermChange): Promise<void> {
  let written = 0;
  const moves: TermMove[] = [];
  for (const chunk of chunks(ids, CHUNK)) {
    const outcome = await writeTerms(ctx.op, ctx.client, chunk, field, change);
    written += outcome.written.length;
    moves.push(...outcome.moves);
    ctx.tally.changed += outcome.written.length;
    ctx.tally.failed += outcome.refused.length;
    ctx.tally.done += chunk.length;
    await ctx.step();
  }
  // The automatic categories' rules read tags and categories: they follow now.
  if (written > 0) requestCheck();
  // A product put under another category's margin takes its price now, through the engine.
  await repriceMoved(moves);
}

/** A tag by id, or by name — created on the store when it has none of that name, as the product sheet does. */
async function ensureTag(client: WooClient, tag: { id?: number; name: string }): Promise<number> {
  const found = await findTag(tag);
  if (found.id != null) return found.id;
  const created =
    (await client.createTag(found.name)) ??
    (await client.listTags()).find((t) => t.name.trim().toLowerCase() === found.name.toLowerCase());
  if (!created) throw new VetrinaError("failed", words().error.tagRefused(found.name));
  return created.id;
}

/** A category an automatic rule decides is never written by hand: checked again when the action runs. */
async function refuseAutomatic(categoryId: number, trees: CatalogTrees): Promise<void> {
  const category = trees.category.terms.get(categoryId);
  if (!category) throw new VetrinaError("not_found", words().error.categoryGone, 404);
  if ((await collectionsByTerm())[categoryId] != null) {
    throw new VetrinaError("invalid", words().error.automatic(category.name), 400);
  }
}

/* ---------------------------------------------------------------- *
 * Sale and its end
 * ---------------------------------------------------------------- */

const writes = (plans: SizePlan[]) => plans.filter((p): p is Extract<SizePlan, { write: true }> => p.write);

async function runSales(ctx: RunCtx, ids: number[], plan: (sizes: LiveSize[]) => SizePlan[]): Promise<void> {
  const { op, client, tally } = ctx;
  let written = 0;
  for (const chunk of chunks(ids, SALE_CHUNK)) {
    const live = await readFresh(client, chunk);
    // What the store took, product by product: the snapshot learns it once per chunk.
    const taken = new Map<number, SaleWrite[]>();
    await mapLimit(chunk, SALE_AT_ONCE, async (id) => {
      const p = live.get(id);
      if (!p) return;
      const read = await readSizes(client, p);
      if (!read) return;
      const todo = writes(plan(read.sizes));
      if (todo.length === 0) return;
      // Filed before the write, product by product: an answer lost still leaves it undoable.
      await repo.addItems(
        op.id,
        todo.map((w) => ({ productId: id, variationId: w.variationId, field: "sale", before: filedBefore(w), after: w.after })),
      );
      const outcome = await writeSales(
        client,
        id,
        read.variable,
        todo.map((w) => ({ variationId: w.variationId, sale: w.after })),
      );
      await repo.dropItems(
        op.id,
        "sale",
        outcome.refused.map((w) => ({ productId: id, variationId: w.variationId })),
      );
      const settled = await realign(ctx, id, read.variable, todo, outcome, plan);
      if (settled.length > 0) {
        tally.changed += 1;
        written += 1;
        taken.set(id, settled);
      }
      if (outcome.refused.length > 0) tally.failed += 1;
    });
    await patchSnapshotSales(taken);
    // The shelf price and "in saldo" the catalog lists follow the sizes.
    await readFresh(client, chunk);
    tally.done += chunk.length;
    await ctx.step();
  }
  // The automatic categories' rules can read a sale (on sale, a price): they follow now.
  if (written > 0) requestCheck();
}

/**
 * The engine may write a size's regular price between a sale's read and its
 * write (the feed cycle runs every quarter of an hour, a sale over thousands
 * of products for minutes). A sale price computed from the old regular price
 * would announce another discount than the one asked — so where the store's
 * answer shows the regular price moved, the size is planned again from the
 * new one and written again; one the sale no longer lowers is put back as
 * it was, and forgotten. Returns the sales the product holds now.
 */
async function realign(
  ctx: RunCtx,
  productId: number,
  variable: boolean,
  todo: Extract<SizePlan, { write: true }>[],
  outcome: Awaited<ReturnType<typeof writeSales>>,
  plan: (sizes: LiveSize[]) => SizePlan[],
): Promise<SaleWrite[]> {
  // Taking a sale off does not depend on the regular price.
  if (ctx.op.kind !== "sale") return outcome.written;
  const moved = outcome.written.flatMap((w) => {
    const filed = todo.find((t) => t.variationId === w.variationId);
    const now = w.variationId != null ? outcome.regular?.get(w.variationId) : undefined;
    return filed && now !== undefined && now !== filed.regular ? [{ filed, size: { variationId: w.variationId, regular: now, sale: w.sale } }] : [];
  });
  if (moved.length === 0) return outcome.written;
  const again = plan(moved.map((m) => m.size));
  const rewrite: SaleWrite[] = [];
  const revert: SaleWrite[] = [];
  moved.forEach((m, i) => {
    const next = again[i];
    if (next?.write) rewrite.push({ variationId: m.filed.variationId, sale: next.after });
    else if (next && next.reason !== "same") revert.push({ variationId: m.filed.variationId, sale: m.filed.before });
  });
  const second = await writeSales(ctx.client, productId, variable, [...rewrite, ...revert]);
  const took = new Set(second.written.map((w) => w.variationId));
  for (const w of rewrite) {
    if (!took.has(w.variationId)) continue;
    const m = moved.find((x) => x.filed.variationId === w.variationId)!;
    await repo.setSaleItem(ctx.op.id, productId, w.variationId, filedBefore({ ...m.filed, regular: m.size.regular }), w.sale);
  }
  const reverted = revert.filter((w) => took.has(w.variationId));
  await repo.dropItems(
    ctx.op.id,
    "sale",
    reverted.map((w) => ({ productId, variationId: w.variationId })),
  );
  const gone = new Set(reverted.map((w) => w.variationId));
  const rewritten = new Map(rewrite.filter((w) => took.has(w.variationId)).map((w) => [w.variationId, w]));
  return outcome.written.filter((w) => !gone.has(w.variationId)).map((w) => rewritten.get(w.variationId) ?? w);
}

/* ---------------------------------------------------------------- *
 * A place on the homepage
 * ---------------------------------------------------------------- */

async function runPin(ctx: RunCtx, ids: number[], trees: CatalogTrees, sectionKey: string): Promise<void> {
  const { op, client, tally } = ctx;
  const { rail } = await readRail(sectionKey);
  if (!pinnable(rail)) throw new VetrinaError("invalid", words().error.notPinnable, 400);
  // Whether the category is automatic, read for certain: adding to one by hand would fight its rule.
  const { fill, term } = await railFill(rail);
  const max = hubConfig.vetrina.maxPins;
  const { rows } = await rowsInOrder(ids);
  const members = sectionMembers(rail, rows, trees);
  for (const id of rail.visible) members.add(id);
  const known = new Set(rows.map((r) => r.id));
  const targets = ids.filter((id) => known.has(id) || members.has(id));

  // A manual category's section shows a product once it is in the category:
  // the ones that will be pinned are added to it first (and filed, for the undo).
  const added = new Set<number>();
  let categoryWritten = false;
  if (fill === "category" && term) {
    const outsiders = pinList(targets, [], max).placed.filter((id) => !members.has(id));
    const moves: TermMove[] = [];
    for (const chunk of chunks(outsiders, CHUNK)) {
      const outcome = await writeTerms(op, client, chunk, "categories", { add: term.id });
      for (const id of [...outcome.written, ...outcome.already]) added.add(id);
      categoryWritten ||= outcome.written.length > 0;
      moves.push(...outcome.moves);
      tally.changed += outcome.written.length;
      tally.failed += outcome.refused.length;
    }
    await ctx.step();
    await repriceMoved(moves);
  }
  if (categoryWritten) requestCheck();

  const plan = pinList(
    targets.filter((id) => members.has(id) || added.has(id)),
    rail.pin,
    max,
  );
  const exclude = rail.exclude.filter((id) => !plan.placed.includes(id));
  tally.done = ids.length;
  // Nothing to place, or nothing moves (all of them pinned there already, in
  // this order): no new homepage revision — and no pins trimmed on the way.
  if (plan.placed.length === 0 || (sameList(plan.pin, rail.pin) && sameList(exclude, rail.exclude))) {
    tally.changed = plan.placed.length;
    await ctx.step();
    return;
  }
  // Filed BEFORE the write, like every value an action changes: a write whose
  // answer is lost (a timeout) or cut off by a restart still leaves the pins
  // it may have put there undoable.
  const section: OperationSectionRecord = {
    key: rail.key,
    title: rail.title.trim() || rail.key,
    before: { pin: rail.pin, exclude: rail.exclude },
    after: { pin: plan.pin, exclude },
    attrsHash: null,
  };
  tally.changed = plan.placed.length;
  await repo.updateOperation(op.id, { section });
  await ctx.step();
  const result = await publishRail({
    key: rail.key,
    expectedModifiedGmt: rail.modifiedGmt,
    expectedAttrsHash: rail.attrsHash,
    pin: plan.pin,
    exclude,
    fallback: rail.fallback,
  });
  await repo.updateOperation(op.id, { section: { ...section, attrsHash: result.attrsHash } });
  await ctx.step();
}

/** The same ids in the same order. */
const sameList = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/* ---------------------------------------------------------------- *
 * Running an action
 * ---------------------------------------------------------------- */

/** Run an action over its target, resolved again now: a catalog query acts on what it matches when it runs. */
export async function runOperation(ctx: RunCtx): Promise<void> {
  const input: OperationInput = ctx.op.input;
  // A margin is a pricing rule and a reprice, not writes product by product (margin.ts).
  if (input.kind === "margin") return runMargin(ctx, input);
  const { ids, trees } = await resolveTarget(input.target, { wholeTerm: wholeTermAction(input) });
  ctx.tally.total = ids.length;
  await ctx.step();
  switch (input.kind) {
    case "hide":
      return runVisibility(ctx, "hide", ids, trees);
    case "show":
      return runVisibility(ctx, "show", ids, trees, input.keepHeld === true, input.restore === true);
    case "sale":
      return runSales(ctx, ids, (sizes) => planSale(sizes, input));
    case "unsale":
      return runSales(ctx, ids, planUnsale);
    case "tag":
      return runTerms(ctx, ids, "tags", { add: await ensureTag(ctx.client, input.tag) });
    case "untag":
      return runTerms(ctx, ids, "tags", { remove: input.tagId });
    case "categorize":
      await refuseAutomatic(input.categoryId, trees);
      return runTerms(ctx, ids, "categories", { add: input.categoryId });
    case "uncategorize":
      await refuseAutomatic(input.categoryId, trees);
      return runTerms(ctx, ids, "categories", { remove: input.categoryId });
    case "pin":
      return runPin(ctx, ids, trees, input.sectionKey);
  }
}

/* ---------------------------------------------------------------- *
 * Undo
 * ---------------------------------------------------------------- */

type Item = VetrinaOperationItemRow;

/**
 * Products put back (or found as they were), left alone because changed
 * since, refused by the store — and left hidden because another whole term
 * hidden by the owner still holds them.
 */
interface UndoTally {
  restored: Set<number>;
  kept: Set<number>;
  failed: Set<number>;
  held: Set<number>;
  /** The hidden terms holding them, by name, the most first: the toast names them. */
  heldBy?: string[];
}

const productsOf = (items: Item[]) => [...new Set(items.map((i) => i.productId))];

function byProduct(items: Item[]): Map<number, Item[]> {
  const out = new Map<number, Item[]>();
  for (const item of items) {
    const list = out.get(item.productId);
    if (list) list.push(item);
    else out.set(item.productId, [item]);
  }
  return out;
}

/**
 * The products an undone hide must leave hidden: those inside another whole
 * category or brand the owner hid, whose hide still stands. Each goes to the
 * newest such hide, which files it from then on: that "Mostra" brings it
 * back as it was before either. Never a hide of the same term: an older one
 * is over (this one took over from it).
 */
async function heldElsewhere(op: VetrinaOperationRow, ids: number[]): Promise<Map<number, VetrinaOperationRow>> {
  if (op.kind !== "hide") return new Map();
  return heldByTermHides(ids, (row) => row.id === op.id || (op.termKey != null && row.termKey === op.termKey));
}

async function undoVisibility(ctx: RunCtx, items: Item[], out: UndoTally): Promise<void> {
  const grouped = byProduct(items);
  const held = await heldElsewhere(ctx.op, [...grouped.keys()]);
  // Hidden again since by a newer hide (one product's, from its sheet): the owner's later word, that hide's to undo.
  const hiddenSince = ctx.op.kind === "hide" ? await repo.hiddenSinceBy(ctx.op, [...grouped.keys()]) : new Set<number>();
  for (const chunk of chunks([...grouped.keys()], CHUNK)) {
    const live = await readFresh(ctx.client, chunk);
    const restore: { id: number; before: string }[] = [];
    for (const id of chunk) {
      const item = grouped.get(id)![0];
      const p = live.get(id);
      if (!p) {
        out.kept.add(id);
        continue;
      }
      const verdict = undoVerdict(p.catalog_visibility || "visible", item.before as string, item.after as string, (a, b) => a === b);
      const holder = verdict === "restore" ? held.get(id) : undefined;
      if (verdict === "restore" && hiddenSince.has(id)) out.kept.add(id);
      else if (holder) {
        await repo.addItems(holder.id, [{ productId: id, field: "visibility", before: item.before, after: item.after }]);
        out.held.add(id);
      } else if (verdict === "restore") restore.push({ id, before: item.before as string });
      else if (verdict === "already") out.restored.add(id);
      else out.kept.add(id);
    }
    if (restore.length > 0) {
      const answers = await ctx.client.batchUpdateProducts(restore.map((r) => ({ id: r.id, catalog_visibility: r.before })));
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
  if (out.held.size > 0) {
    const holders = new Map([...out.held].flatMap((id) => (held.has(id) ? [[id, held.get(id)!] as const] : [])));
    out.heldBy = heldTerms(holders, await readCatalogTrees()).map((t) => t.term);
  }
}

async function undoTerms(ctx: RunCtx, items: Item[], field: TermField, out: UndoTally): Promise<void> {
  const grouped = byProduct(items);
  let written = 0;
  const moves: TermMove[] = [];
  for (const chunk of chunks([...grouped.keys()], CHUNK)) {
    await queueProductWrite(async () => {
      const live = await readFresh(ctx.client, chunk);
      const restore: { id: number; list: number[] }[] = [];
      for (const id of chunk) {
        const item = grouped.get(id)![0];
        const p = live.get(id);
        if (!p) {
          out.kept.add(id);
          continue;
        }
        const now = (p[field] ?? []).map((t) => t.id);
        const { verdict, list } = undoList(now, item.before as number[], item.after as number[]);
        if (verdict === "restore") restore.push({ id, list });
        else if (verdict === "already") out.restored.add(id);
        else out.kept.add(id);
      }
      if (restore.length === 0) return;
      const answers = await ctx.client.batchUpdateProducts(restore.map((r) => ({ id: r.id, [field]: r.list.map((id) => ({ id })) })));
      const { saved, refused } = await settleBatch(
        restore.map((r) => r.id),
        answers,
      );
      for (const id of saved.keys()) out.restored.add(id);
      for (const id of refused) out.failed.add(id);
      written += saved.size;
      if (field === "categories") {
        for (const r of restore) {
          const was = live.get(r.id);
          const now = saved.get(r.id);
          if (was?.sku && now) moves.push(categoryMove(was.sku, (was.categories ?? []).map((c) => c.id), (now.categories ?? []).map((c) => c.id), now.brands));
        }
      }
    });
    ctx.tally.done += chunk.length;
    await ctx.step();
  }
  if (written > 0) requestCheck();
  await repriceMoved(moves);
}

async function undoSales(ctx: RunCtx, items: Item[], out: UndoTally): Promise<void> {
  const grouped = byProduct(items);
  let written = 0;
  for (const chunk of chunks([...grouped.keys()], SALE_CHUNK)) {
    const live = await readFresh(ctx.client, chunk);
    const taken = new Map<number, SaleWrite[]>();
    await mapLimit(chunk, SALE_AT_ONCE, async (id) => {
      const p = live.get(id);
      const read = p ? await readSizes(ctx.client, p) : null;
      if (!read) {
        out.kept.add(id);
        return;
      }
      const restore: SaleWrite[] = [];
      let already = false;
      let changed = false;
      for (const item of grouped.get(id)!) {
        const size = read.sizes.find((s) => s.variationId === item.variationId);
        const verdict = size ? saleUndoVerdict(size, item.before as FiledSale, item.after as SaleState) : "changed";
        if (verdict === "restore") {
          // Its sizes are written with the sale fields only: the regular price filed beside them is never written.
          const { regular: _regular, ...before } = item.before as FiledSale;
          restore.push({ variationId: item.variationId, sale: before });
        } else if (verdict === "already") already = true;
        else changed = true;
      }
      const outcome = await writeSales(ctx.client, id, read.variable, restore);
      if (outcome.written.length > 0) {
        written += 1;
        taken.set(id, outcome.written);
      }
      // One word per product, as the other undos count: refused when the store said no to one of its
      // sizes, left as it was when one changed since (the owner should look), else put back.
      if (outcome.refused.length > 0) out.failed.add(id);
      else if (changed) out.kept.add(id);
      else if (outcome.written.length > 0 || already) out.restored.add(id);
    });
    await patchSnapshotSales(taken);
    await readFresh(ctx.client, chunk);
    ctx.tally.done += chunk.length;
    await ctx.step();
  }
  if (written > 0) requestCheck();
}

/**
 * Where a section stands against a pin's record: as the pin left it (its
 * undo writes the pins from before), as it was before (the write never
 * landed: nothing to put back), or changed since (someone's newer word: the
 * undo is refused). Without the write's fingerprint (its answer was lost)
 * the pins say which.
 */
export function sectionVerdict(
  rail: { attrsHash: string; pin: readonly number[]; exclude: readonly number[] },
  section: OperationSectionRecord,
): "restore" | "already" | "changed" {
  if (section.attrsHash != null) return rail.attrsHash === section.attrsHash ? "restore" : "changed";
  const is = (state: OperationSectionRecord["before"]) => sameList(rail.pin, state.pin) && sameList(rail.exclude, state.exclude);
  if (is(section.after)) return "restore";
  return is(section.before) ? "already" : "changed";
}

/**
 * A section's pins and hidden products put back — only over the very state
 * the action left. A section deleted since has nothing to put back: the rest
 * of the undo (the categories the pin added) goes on.
 */
async function undoSection(section: OperationSectionRecord): Promise<void> {
  let rail: Awaited<ReturnType<typeof readRail>>["rail"];
  try {
    ({ rail } = await readRail(section.key));
  } catch (e) {
    if (e instanceof VetrinaError && e.code === "not_found") return;
    throw e;
  }
  const verdict = sectionVerdict(rail, section);
  if (verdict === "already") return;
  if (verdict === "changed") throw new VetrinaError("stale", words().error.sectionChanged(section.title), 409);
  await publishRail({
    key: section.key,
    expectedModifiedGmt: rail.modifiedGmt,
    expectedAttrsHash: rail.attrsHash,
    pin: section.before.pin,
    exclude: section.before.exclude,
    fallback: rail.fallback,
  });
}

/**
 * Undo an action: every value it changed goes back where the store still
 * shows what it wrote; a value changed since is left alone, and counted. A
 * hide's product that another hidden category or brand still holds stays
 * hidden, filed under that one (held).
 */
export async function runUndo(ctx: RunCtx, items: Item[], section: OperationSectionRecord | null): Promise<OperationUndoOutcome> {
  // A margin's undo puts its rule back and reprices (margin.ts): its record is the rule, not products' values.
  if (ctx.op.kind === "margin") return undoMargin(ctx);
  const out: UndoTally = { restored: new Set(), kept: new Set(), failed: new Set(), held: new Set() };
  const of = (field: Item["field"]) => items.filter((i) => i.field === field);
  ctx.tally.done = 0;
  ctx.tally.total = (["visibility", "tags", "categories", "sale"] as const).reduce((n, f) => n + productsOf(of(f)).length, 0);
  await ctx.step();
  // The section first: its pins are what a "Metti in homepage" was about; the categories it added follow.
  if (section) await undoSection(section);
  await undoVisibility(ctx, of("visibility"), out);
  await undoTerms(ctx, of("tags"), "tags", out);
  await undoTerms(ctx, of("categories"), "categories", out);
  await undoSales(ctx, of("sale"), out);
  return {
    restored: out.restored.size,
    kept: out.kept.size,
    failed: out.failed.size,
    ...(out.held.size > 0 ? { held: out.held.size, heldBy: out.heldBy ?? [] } : {}),
  };
}
