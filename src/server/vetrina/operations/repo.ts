import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import type { ScopedPricingRule } from "@core/config";
import type { OperationInput, OperationKind } from "@/lib/vetrina/catalog-ops";
import { db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import {
  vetrinaOperationItems,
  vetrinaOperations,
  type OperationLabelParams,
  type OperationSectionRecord,
  type VetrinaOperationItemRow,
  type VetrinaOperationRow,
} from "@/server/db/schema";

/**
 * The catalog actions' tables: one row per action (vetrina_operations), one
 * per value it changed (vetrina_operation_items).
 *
 * The reads take `since`: in demo mode, only the actions of this process
 * count — they acted on a demo shop that a restart puts back as it was.
 */

export type ItemField = VetrinaOperationItemRow["field"];

export interface NewItem {
  productId: number;
  variationId?: number | null;
  field: ItemField;
  before: unknown;
  after: unknown;
}

/** The log keeps 30 days — an action filed under a whole term keeps its row while it stands (plan.ts, keptForTerm). */
const KEEP_DAYS = 30;
const INSERT_CHUNK = 500;

export async function insertOperation(row: {
  kind: OperationKind;
  input: OperationInput;
  label: string;
  labelParams: OperationLabelParams;
  termKey: string | null;
  total: number;
}): Promise<VetrinaOperationRow> {
  const [inserted] = await db.insert(vetrinaOperations).values(row).returning();
  return inserted;
}

/** The database's own clock: what a row's created_at is measured by. */
export async function databaseNow(): Promise<Date> {
  const [row] = rowsOf<{ now: Date | string }>(await db.execute(sql`select now() as now`));
  return new Date(row.now);
}

/** Created since then, or every row (`since` null). */
const from = (since: Date | null): SQL | undefined => (since ? gte(vetrinaOperations.createdAt, since) : undefined);

export async function getOperation(id: string, since: Date | null = null): Promise<VetrinaOperationRow | null> {
  const rows = await db
    .select()
    .from(vetrinaOperations)
    .where(and(eq(vetrinaOperations.id, id), from(since)))
    .limit(1);
  return rows[0] ?? null;
}

/** The newest actions first. */
export async function listOperationRows(limit: number, since: Date | null = null): Promise<VetrinaOperationRow[]> {
  return db.select().from(vetrinaOperations).where(from(since)).orderBy(desc(vetrinaOperations.createdAt)).limit(limit);
}

/**
 * The actions filed under a whole term, newest first: its hides and sales,
 * which its screen reads from the log. Its margins are left out — what
 * stands is the pricing rule, not a row — so a margin changed often never
 * pushes a standing hide or sale past the limit.
 */
export async function termOperationRows(termKey: string, since: Date | null = null, limit = 50): Promise<VetrinaOperationRow[]> {
  return db
    .select()
    .from(vetrinaOperations)
    .where(and(eq(vetrinaOperations.termKey, termKey), ne(vetrinaOperations.kind, "margin"), from(since)))
    .orderBy(desc(vetrinaOperations.createdAt))
    .limit(limit);
}

/**
 * The hides of a whole term that may still stand (plan.ts, stands()),
 * newest first: what an undone hide checks before showing a product again.
 */
export async function termHideRows(since: Date | null = null): Promise<VetrinaOperationRow[]> {
  const op = vetrinaOperations;
  return db
    .select()
    .from(op)
    .where(
      and(
        eq(op.kind, "hide"),
        isNotNull(op.termKey),
        isNull(op.undoneAt),
        or(ne(op.status, "failed"), sql`${op.changed} > 0`),
        from(since),
      ),
    )
    .orderBy(desc(op.createdAt));
}

export type OperationUpdate = Partial<
  Pick<
    VetrinaOperationRow,
    "status" | "done" | "total" | "changed" | "failed" | "error" | "finishedAt" | "undoneAt" | "undo"
  >
> & { section?: OperationSectionRecord | null };

export async function updateOperation(id: string, set: OperationUpdate): Promise<void> {
  if (Object.keys(set).length === 0) return;
  await db.update(vetrinaOperations).set(set).where(eq(vetrinaOperations.id, id));
}

/**
 * Move an action from one status to another, only if it is still in the
 * first: two undo requests at once, or one racing the run's end, cannot both
 * win. True when this call moved it.
 */
export async function moveStatus(
  id: string,
  from: VetrinaOperationRow["status"][],
  set: OperationUpdate & { status: VetrinaOperationRow["status"] },
): Promise<boolean> {
  const moved = await db
    .update(vetrinaOperations)
    .set(set)
    .where(and(eq(vetrinaOperations.id, id), inArray(vetrinaOperations.status, from)))
    .returning({ id: vetrinaOperations.id });
  return moved.length > 0;
}

export async function addItems(operationId: string, items: NewItem[]): Promise<void> {
  for (let i = 0; i < items.length; i += INSERT_CHUNK) {
    await db.insert(vetrinaOperationItems).values(
      items.slice(i, i + INSERT_CHUNK).map((item) => ({
        operationId,
        productId: item.productId,
        variationId: item.variationId ?? null,
        field: item.field,
        before: item.before,
        after: item.after,
      })),
    );
  }
}

/** Forget what the store refused: those values were never written. A null variation means the product's own value. */
export async function dropItems(
  operationId: string,
  field: ItemField,
  refused: { productId: number; variationId?: number | null }[],
): Promise<void> {
  if (refused.length === 0) return;
  const match = refused.map((r) =>
    and(
      eq(vetrinaOperationItems.productId, r.productId),
      r.variationId == null ? isNull(vetrinaOperationItems.variationId) : eq(vetrinaOperationItems.variationId, r.variationId),
    ),
  );
  await db
    .delete(vetrinaOperationItems)
    .where(and(eq(vetrinaOperationItems.operationId, operationId), eq(vetrinaOperationItems.field, field), or(...match)));
}

/** What the store shows after the write, when it is not exactly what was written (WooCommerce's default category). */
export async function setItemAfter(operationId: string, productId: number, field: ItemField, after: unknown): Promise<void> {
  await db
    .update(vetrinaOperationItems)
    .set({ after })
    .where(
      and(
        eq(vetrinaOperationItems.operationId, operationId),
        eq(vetrinaOperationItems.productId, productId),
        eq(vetrinaOperationItems.field, field),
      ),
    );
}

/** The products an action filed a value of `field` for. */
export async function filedProducts(operationId: string, field: ItemField): Promise<number[]> {
  const rows = await db
    .selectDistinct({ productId: vetrinaOperationItems.productId })
    .from(vetrinaOperationItems)
    .where(and(eq(vetrinaOperationItems.operationId, operationId), eq(vetrinaOperationItems.field, field)));
  return rows.map((r) => r.productId);
}

/** How many products an action filed anything for: written, or sent with no answer heard. */
export async function filedCount(operationId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${vetrinaOperationItems.productId})::int` })
    .from(vetrinaOperationItems)
    .where(eq(vetrinaOperationItems.operationId, operationId));
  return row?.count ?? 0;
}

/**
 * A margin's record (phase 4): the term's pricing rule before and after,
 * and where it sat in the list — what its "Annulla" puts back. Filed as one
 * item of the action, BEFORE the rule is saved, like every value an action
 * changes: a run cut off right after the save counts as having changed
 * something (filedCount, markInterrupted) and stays undoable.
 *
 * It is not a product's value: product 0, field 'margin' — so every reader
 * of the products' items, which picks its own field, never meets it, and a
 * margin's undo reads only this.
 */
export interface MarginRecord {
  before: ScopedPricingRule | null;
  after: ScopedPricingRule | null;
  /** The rule's place in the list: a removed rule goes back there. */
  index: number;
}

export async function fileMarginRecord(operationId: string, record: MarginRecord): Promise<void> {
  await db.insert(vetrinaOperationItems).values({
    operationId,
    productId: 0,
    variationId: null,
    field: "margin",
    before: { rule: record.before, index: record.index },
    after: { rule: record.after },
  });
}

/** The margin's record, the last one filed; null for none (or a record that does not read as one). */
export async function marginRecordOf(operationId: string): Promise<MarginRecord | null> {
  const [row] = await db
    .select({ before: vetrinaOperationItems.before, after: vetrinaOperationItems.after })
    .from(vetrinaOperationItems)
    .where(and(eq(vetrinaOperationItems.operationId, operationId), eq(vetrinaOperationItems.field, "margin")))
    .orderBy(desc(vetrinaOperationItems.id))
    .limit(1);
  if (!row) return null;
  const parse = (raw: unknown) => (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown> | null;
  const before = parse(row.before);
  const after = parse(row.after);
  const rule = (value: unknown) => (value && typeof value === "object" ? (value as ScopedPricingRule) : null);
  if (!before || !after || typeof before.index !== "number") return null;
  return { before: rule(before.rule), after: rule(after.rule), index: before.index };
}

export async function listItems(operationId: string): Promise<VetrinaOperationItemRow[]> {
  return db
    .select()
    .from(vetrinaOperationItems)
    .where(eq(vetrinaOperationItems.operationId, operationId))
    .orderBy(vetrinaOperationItems.id);
}

/**
 * Products an action filed anything for, in SQL: a run cut off between a
 * write and the count of what it wrote may have changed them all the same,
 * so they count as changed — and the action stays undoable. Undoing a value
 * that was never written finds it as it was, and leaves it.
 */
const filedSql = sql<number>`(select count(distinct i.product_id) from ${vetrinaOperationItems} i where i.operation_id = ${vetrinaOperations.id})`;

/**
 * After a restart: every action left running (or undoing) was cut off with
 * the process that ran it. They are marked so, never resumed — the owner
 * sees how far each got and can undo what it did.
 */
export async function markInterrupted(messages: { run: string; undo: string }): Promise<number> {
  const now = new Date();
  const runs = await db
    .update(vetrinaOperations)
    .set({
      status: "failed",
      error: messages.run,
      finishedAt: now,
      changed: sql`greatest(${vetrinaOperations.changed}, ${filedSql})`,
    })
    .where(eq(vetrinaOperations.status, "running"))
    .returning({ id: vetrinaOperations.id });
  const undos = await db
    .update(vetrinaOperations)
    .set({ status: "failed", error: messages.undo })
    .where(eq(vetrinaOperations.status, "undoing"))
    .returning({ id: vetrinaOperations.id });
  return runs.length + undos.length;
}

/**
 * Drop what is older than the log keeps — but never an action filed under a
 * whole term that still stands: plan.ts's keptForTerm(), said in SQL (a term
 * key, not a margin, not undone, and not a run that failed before changing
 * anything). Its hide's items are what "Mostra" puts back; its sales, and
 * their ends, are what the term's screen reads.
 */
export async function trimOperations(now = Date.now()): Promise<number> {
  const before = new Date(now - KEEP_DAYS * 86_400_000);
  const op = vetrinaOperations;
  const gone = await db
    .delete(op)
    .where(
      and(
        lt(op.createdAt, before),
        sql`not (${op.termKey} is not null and ${op.kind} <> 'margin' and ${op.undoneAt} is null and (${op.status} <> 'failed' or ${op.changed} > 0))`,
      ),
    )
    .returning({ id: op.id });
  return gone.length;
}
