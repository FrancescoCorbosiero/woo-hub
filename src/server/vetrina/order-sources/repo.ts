import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import type { OrderSourceItem } from "@/lib/vetrina/order-sources";
import { db } from "@/server/db/client";
import { vetrinaOrderSources, type VetrinaOrderSourceRow } from "@/server/db/schema";

/** The order sources' table (vetrina_order_sources). */

export async function listSourceRows(): Promise<VetrinaOrderSourceRow[]> {
  return db.select().from(vetrinaOrderSources).orderBy(asc(sql`lower(${vetrinaOrderSources.name})`));
}

/** Every source's id and name only: the lists' "Usa l'ordine di «…»". */
export async function listSourceNames(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: vetrinaOrderSources.id, name: vetrinaOrderSources.name })
    .from(vetrinaOrderSources)
    .orderBy(asc(sql`lower(${vetrinaOrderSources.name})`));
}

export async function countSources(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(vetrinaOrderSources);
  return row?.n ?? 0;
}

export async function getSourceRow(id: string): Promise<VetrinaOrderSourceRow | null> {
  const [row] = await db.select().from(vetrinaOrderSources).where(eq(vetrinaOrderSources.id, id)).limit(1);
  return row ?? null;
}

/** The source of this name, any case. */
export async function findSourceByName(name: string): Promise<VetrinaOrderSourceRow | null> {
  const [row] = await db
    .select()
    .from(vetrinaOrderSources)
    .where(sql`lower(${vetrinaOrderSources.name}) = lower(${name})`)
    .limit(1);
  return row ?? null;
}

export async function insertSource(row: { name: string; origin: string | null; items: OrderSourceItem[] }): Promise<VetrinaOrderSourceRow> {
  const [inserted] = await db.insert(vetrinaOrderSources).values(row).returning();
  return inserted;
}

export async function updateSource(
  id: string,
  row: { name: string; origin: string | null; items?: OrderSourceItem[] },
): Promise<VetrinaOrderSourceRow | null> {
  const [updated] = await db
    .update(vetrinaOrderSources)
    .set({ ...row, updatedAt: new Date() })
    .where(eq(vetrinaOrderSources.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteSourceRow(id: string): Promise<boolean> {
  const deleted = await db.delete(vetrinaOrderSources).where(eq(vetrinaOrderSources.id, id)).returning({ id: vetrinaOrderSources.id });
  return deleted.length > 0;
}
