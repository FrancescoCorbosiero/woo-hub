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
import type { CatalogTrees } from "@/server/vetrina/catalog";
import { publishRail, readRail } from "@/server/vetrina/service";
import { VetrinaError } from "@/server/vetrina/source";
import type { WooClient } from "@/server/woo/client";
import { chunks, mapLimit, resolveTarget, rowsInOrder, termName } from "./context";
import { patchSnapshotSales, readFresh, readSizes, settleBatch, writeSales, type SaleWrite } from "./live";
import {
  listAfter,
  pinList,
  planSale,
  planUnsale,
  sameIds,
  sameSale,
  undoList,
  undoVerdict,
  visibilityAfter,
  type LiveSize,
  type SaleState,
  type SizePlan,
} from "./plan";
import { findTag } from "./preview";
import * as repo from "./repo";
import { pinnable, railFill, sectionMembers } from "./sections";
import { heldByTermHides, logSince, standingTermHide } from "./standing";
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
): Promise<void> {
  const { op, client, tally } = ctx;
  if (op.kind === "hide" && op.termKey) {
    // Two hides of one term started at once: the later one gives way.
    const earlier = (await repo.termOperationRows(op.termKey, await logSince())).filter((r) => r.id !== op.id && r.createdAt <= op.createdAt);
    if (await standingTermHide(earlier)) {
      throw new VetrinaError("invalid", words().error.alreadyHidden(termName(trees, op.termKey as TermKey)), 400);
    }
  }
  // Decided as it runs: a term hidden since the preview holds its products too.
  const held = keepHeld ? await heldByTermHides(ids) : new Map<number, unknown>();
  for (const chunk of chunks(ids, CHUNK)) {
    const live = await readFresh(client, chunk);
    const todo: { id: number; before: string; after: string }[] = [];
    for (const id of chunk) {
      const p = live.get(id);
      if (!p || held.has(id)) continue;
      const before = p.catalog_visibility || "visible";
      const after = visibilityAfter(kind, before);
      if (after) todo.push({ id, before, after });
    }
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
}

/* ---------------------------------------------------------------- *
 * Tags and categories
 * ---------------------------------------------------------------- */

type TermField = "tags" | "categories";
type TermChange = { add: number } | { remove: number };

/**
 * Add or remove one tag or category on these products: their whole lists
 * read live and written back, inside the automatic categories' queue.
 * `written`: changed; `already`: had nothing to change; `refused` by the store.
 */
async function writeTerms(
  op: VetrinaOperationRow,
  client: WooClient,
  ids: number[],
  field: TermField,
  change: TermChange,
): Promise<{ written: number[]; already: number[]; refused: number[] }> {
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
    if (todo.length === 0) return { written: [], already, refused: [] };
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
    for (const t of todo) {
      const p = saved.get(t.id);
      if (!p) continue;
      // The store may show more than was written — WooCommerce puts a product
      // left without categories in its default one — and the undo compares
      // against what the store shows.
      const shown = (p[field] ?? []).map((x) => x.id);
      if (!sameIds(shown, t.after)) await repo.setItemAfter(op.id, t.id, field, shown);
    }
    return { written: [...saved.keys()], already, refused };
  });
}

async function runTerms(ctx: RunCtx, ids: number[], field: TermField, change: TermChange): Promise<void> {
  let written = 0;
  for (const chunk of chunks(ids, CHUNK)) {
    const outcome = await writeTerms(ctx.op, ctx.client, chunk, field, change);
    written += outcome.written.length;
    ctx.tally.changed += outcome.written.length;
    ctx.tally.failed += outcome.refused.length;
    ctx.tally.done += chunk.length;
    await ctx.step();
  }
  // The automatic categories' rules read tags and categories: they follow now.
  if (written > 0) requestCheck();
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
        todo.map((w) => ({ productId: id, variationId: w.variationId, field: "sale", before: w.before, after: w.after })),
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
      if (outcome.written.length > 0) {
        tally.changed += 1;
        written += 1;
        taken.set(id, outcome.written);
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
    for (const chunk of chunks(outsiders, CHUNK)) {
      const outcome = await writeTerms(op, client, chunk, "categories", { add: term.id });
      for (const id of [...outcome.written, ...outcome.already]) added.add(id);
      categoryWritten ||= outcome.written.length > 0;
      tally.changed += outcome.written.length;
      tally.failed += outcome.refused.length;
    }
    await ctx.step();
  }
  if (categoryWritten) requestCheck();

  const plan = pinList(
    targets.filter((id) => members.has(id) || added.has(id)),
    rail.pin,
    max,
  );
  const exclude = rail.exclude.filter((id) => !plan.placed.includes(id));
  tally.changed = plan.placed.length;
  tally.done = ids.length;
  // Nothing to place, or nothing moves (all of them pinned there already, in
  // this order): no new homepage revision — and no pins trimmed on the way.
  if (plan.placed.length === 0 || (sameList(plan.pin, rail.pin) && sameList(exclude, rail.exclude))) {
    await ctx.step();
    return;
  }
  const result = await publishRail({
    key: rail.key,
    expectedModifiedGmt: rail.modifiedGmt,
    expectedAttrsHash: rail.attrsHash,
    pin: plan.pin,
    exclude,
    fallback: rail.fallback,
  });
  const section: OperationSectionRecord = {
    key: rail.key,
    title: rail.title.trim() || rail.key,
    before: { pin: rail.pin, exclude: rail.exclude },
    after: { pin: plan.pin, exclude },
    attrsHash: result.attrsHash,
  };
  await repo.updateOperation(op.id, { section });
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
  const { ids, trees } = await resolveTarget(input.target);
  ctx.tally.total = ids.length;
  await ctx.step();
  switch (input.kind) {
    case "hide":
      return runVisibility(ctx, "hide", ids, trees);
    case "show":
      return runVisibility(ctx, "show", ids, trees, input.keepHeld === true);
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
 * back as it was before either.
 */
async function heldElsewhere(op: VetrinaOperationRow, ids: number[]): Promise<Map<number, VetrinaOperationRow>> {
  if (op.kind !== "hide") return new Map();
  return heldByTermHides(ids, (row) => row.id === op.id);
}

async function undoVisibility(ctx: RunCtx, items: Item[], out: UndoTally): Promise<void> {
  const grouped = byProduct(items);
  const held = await heldElsewhere(ctx.op, [...grouped.keys()]);
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
      if (holder) {
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
}

async function undoTerms(ctx: RunCtx, items: Item[], field: TermField, out: UndoTally): Promise<void> {
  const grouped = byProduct(items);
  let written = 0;
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
    });
    ctx.tally.done += chunk.length;
    await ctx.step();
  }
  if (written > 0) requestCheck();
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
      for (const item of grouped.get(id)!) {
        const size = read.sizes.find((s) => s.variationId === item.variationId);
        if (!size) {
          out.kept.add(id);
          continue;
        }
        const verdict = undoVerdict(size.sale, item.before as SaleState, item.after as SaleState, sameSale);
        if (verdict === "restore") restore.push({ variationId: item.variationId, sale: item.before as SaleState });
        else if (verdict === "already") out.restored.add(id);
        else out.kept.add(id);
      }
      const outcome = await writeSales(ctx.client, id, read.variable, restore);
      if (outcome.written.length > 0) {
        out.restored.add(id);
        written += 1;
        taken.set(id, outcome.written);
      }
      if (outcome.refused.length > 0) out.failed.add(id);
    });
    await patchSnapshotSales(taken);
    await readFresh(ctx.client, chunk);
    ctx.tally.done += chunk.length;
    await ctx.step();
  }
  if (written > 0) requestCheck();
}

/** A section's pins and hidden products put back — only over the very state the action left. */
async function undoSection(section: OperationSectionRecord): Promise<void> {
  const { rail } = await readRail(section.key);
  if (rail.attrsHash !== section.attrsHash) {
    throw new VetrinaError("stale", words().error.sectionChanged(section.title), 409);
  }
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
    ...(out.held.size > 0 ? { held: out.held.size } : {}),
  };
}
