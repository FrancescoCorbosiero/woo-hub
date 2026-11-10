import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { TermTaxonomy } from "@/lib/vetrina/term-ops";
import { decodeEntities } from "@/server/collections/index-rows";
import { db } from "@/server/db/client";
import { termAliases, type TermAliasRow } from "@/server/db/schema";

/**
 * A store term's former names (schema.ts, termAliases): what a renamed,
 * moved or merged category or brand leaves behind, so Publish — which finds
 * terms by name under their parent (identity.ts) — files a product named
 * the old way into the term as it is now, not into a new term with the old
 * name.
 */

/**
 * How Publish compares term names: entities decoded (WooCommerce answers
 * "Saldi &amp; Outlet"), trimmed, lower case, spaces squeezed — "Air Jordan"
 * and "air  jordan" are one term.
 */
export const termKey = (name: string) => decodeEntities(name).trim().toLowerCase().replace(/\s+/g, " ");

/** Every alias of a taxonomy. */
export async function listAliases(taxonomy: TermTaxonomy): Promise<TermAliasRow[]> {
  return db.select().from(termAliases).where(eq(termAliases.taxonomy, taxonomy));
}

/**
 * The old name (under its old parent) now leads to `termId`: written by the
 * action `operationId`, whose "Annulla" takes it away. An alias already
 * there for that name is led to the term, and becomes this action's.
 */
export async function recordAlias(alias: {
  taxonomy: TermTaxonomy;
  parent: number;
  name: string;
  termId: number;
  operationId: string | null;
}): Promise<number> {
  const values = {
    taxonomy: alias.taxonomy,
    parent: alias.taxonomy === "category" ? alias.parent : 0,
    nameKey: termKey(alias.name),
    name: decodeEntities(alias.name).trim(),
    termId: alias.termId,
    operationId: alias.operationId,
  };
  const [row] = await db
    .insert(termAliases)
    .values(values)
    .onConflictDoUpdate({
      target: [termAliases.taxonomy, termAliases.parent, termAliases.nameKey],
      set: { termId: values.termId, name: values.name, operationId: values.operationId },
    })
    .returning({ id: termAliases.id });
  return row.id;
}

/** The aliases an action wrote, taken away ("Annulla"). */
export async function dropAliasesOf(operationId: string): Promise<void> {
  await db.delete(termAliases).where(eq(termAliases.operationId, operationId));
}

/** The aliases leading to a term. */
export async function aliasesLeadingTo(taxonomy: TermTaxonomy, termId: number): Promise<TermAliasRow[]> {
  return db
    .select()
    .from(termAliases)
    .where(and(eq(termAliases.taxonomy, taxonomy), eq(termAliases.termId, termId)));
}

/** These aliases lead to another term (a merge leads its source's to its target, and "Annulla" back). */
export async function repointAliases(ids: readonly number[], termId: number): Promise<void> {
  if (ids.length === 0) return;
  await db.update(termAliases).set({ termId }).where(inArray(termAliases.id, [...ids]));
}

/** A deleted term's aliases: nothing to lead to any more. */
export async function dropAliasesLeadingTo(taxonomy: TermTaxonomy, termId: number): Promise<void> {
  await db.delete(termAliases).where(and(eq(termAliases.taxonomy, taxonomy), eq(termAliases.termId, termId)));
}
