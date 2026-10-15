import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { storeOverrides } from "@/server/db/schema";
import { emptyOverrides, normalizeOverrides, type StoreOverrides } from "./model";

const SINGLETON = "current";

/**
 * Read the single overrides blob. Best-effort: a DB error (e.g. the table not yet
 * migrated) degrades to "no overrides" rather than breaking the preview.
 */
export async function getOverrides(): Promise<StoreOverrides> {
  try {
    const rows = await db
      .select()
      .from(storeOverrides)
      .where(eq(storeOverrides.id, SINGLETON))
      .limit(1);
    return rows.length ? normalizeOverrides(rows[0].data) : emptyOverrides();
  } catch (e) {
    console.warn("[overrides] read skipped (unavailable):", describeDbError(e));
    return emptyOverrides();
  }
}

/** Replace the single overrides blob. Throws on failure so actions can report it. */
export async function saveOverrides(data: StoreOverrides): Promise<void> {
  await writeOverrides(db, data);
}

type Executor = Pick<typeof db, "insert">;

async function writeOverrides(ex: Executor, data: StoreOverrides): Promise<void> {
  await ex
    .insert(storeOverrides)
    .values({ id: SINGLETON, data })
    .onConflictDoUpdate({
      target: storeOverrides.id,
      set: { data: sql`excluded.data`, updatedAt: sql`now()` },
    });
}

/**
 * Change the overrides as they are NOW, under a lock: every lock, pin and
 * sale rule lives in this one blob, and two writers each reading it, then
 * saving their copy (the owner's sheet on the phone, the operator's drawer,
 * "Mantieni" on the list), lost one side's locks — which the engine then
 * priced over. As updateActiveConfig does for the rule list. Throws on
 * failure (a read that fails is never taken for "no overrides").
 */
export async function updateOverrides(change: (current: StoreOverrides) => StoreOverrides): Promise<StoreOverrides> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('store-hub:overrides'))`);
    const rows = await tx.select().from(storeOverrides).where(eq(storeOverrides.id, SINGLETON)).limit(1);
    const next = change(rows.length ? normalizeOverrides(rows[0].data) : emptyOverrides());
    await writeOverrides(tx, next);
    return next;
  });
}

function describeDbError(e: unknown): string {
  const cause = (e as { cause?: { message?: string } })?.cause;
  if (cause?.message) return cause.message;
  return e instanceof Error ? e.message : String(e);
}
