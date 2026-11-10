import "server-only";
import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "./client";
import { rowsOf } from "./rows";

/*
 * Upserts that write only what changed.
 *
 * Postgres never updates in place: every UPDATE writes a whole new row
 * version, its index entries and its WAL, whatever the values — and the old
 * version is then vacuumed. A job that runs every few minutes and upserts
 * what it read, unchanged or not, rewrites the same rows all day long:
 * measured, the GoldenSneakers sync wrote ~90 MB to disk every quarter of an
 * hour for a 1 500-product feed that had not moved.
 *
 * Two pieces, used together: rowsToWrite keeps out of the upsert the rows it
 * would leave as they are, and changedBy is the upsert's own WHERE, for a row
 * that changed between the two.
 */

/**
 * An upsert's content: per column, what its DO UPDATE writes there, reading
 * the proposed row as `excluded` (and the stored one by the table's name, as
 * a CASE that keeps a known image does). Leave out the columns that only say
 * when the row was written (a seen_at, a synced_at): they differ every run by
 * design, and go in the SET alongside, written only with the rows that change.
 */
export type UpsertContent<T extends PgTable> = { [K in keyof T["_"]["columns"]]?: SQL };

/**
 * The WHERE of an upsert's DO UPDATE that leaves a row alone when the update
 * would not change it: the stored columns against what `content` would write
 * there, null-safe (IS DISTINCT FROM), all at once.
 */
export function changedBy<T extends PgTable>(table: T, content: UpsertContent<T>): SQL {
  const columns = getTableColumns(table) as Record<string, unknown>;
  const keys = Object.keys(content).filter((key) => content[key as keyof typeof content] !== undefined);
  if (keys.length === 0) throw new Error("changedBy: nothing to compare");
  const stored = keys.map((key) => {
    const column = columns[key];
    if (!column) throw new Error(`changedBy: no column "${key}"`);
    return sql`${column}`;
  });
  const next = keys.map((key) => content[key as keyof typeof content] as SQL);
  return sql`(${sql.join(stored, sql`, `)}) is distinct from (${sql.join(next, sql`, `)})`;
}

/**
 * The rows of `values` an upsert of them would write — keys not stored yet,
 * and rows whose content differs from the stored one (changedBy, and `guard`
 * when the upsert's WHERE has one) — found with a plain read.
 *
 * The upsert's WHERE alone is not enough: ON CONFLICT DO UPDATE locks the
 * stored row BEFORE it reads the WHERE, and a row lock is written into the
 * row — its page dirtied, logged, and the first time after a checkpoint copied
 * whole into the WAL. Measured, a feed sync that changed nothing still wrote
 * 30 MB that way. A read locks nothing: rows filtered out here never reach
 * the upsert, which keeps its WHERE for a row changed in between.
 *
 * The rows go over as one JSON array, read back as rows of the table's own
 * type (jsonb_populate_recordset) and aliased `excluded`, so the expressions
 * of the upsert's SET and WHERE apply here unchanged. Input order is kept.
 */
export async function rowsToWrite<T extends PgTable, V extends object>(
  table: T,
  target: readonly AnyPgColumn[],
  values: readonly V[],
  content: UpsertContent<T>,
  guard?: SQL,
): Promise<V[]> {
  if (values.length === 0) return [];
  if (target.length === 0) throw new Error("rowsToWrite: no conflict target");
  const columns = Object.entries(getTableColumns(table)) as [string, AnyPgColumn][];
  // Keyed by the columns' own names, as the table's row type has them.
  const rows = values.map((value) => {
    const row: Record<string, unknown> = {};
    for (const [key, column] of columns) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) row[column.name] = v;
    }
    return row;
  });
  const stored = sql.join(
    target.map((c) => sql`${c}`),
    sql`, `,
  );
  const proposed = sql.join(
    target.map((c) => sql`excluded.${sql.identifier(c.name)}`),
    sql`, `,
  );
  const res = await db.execute(sql`
    select excluded.ordinality::int as n
    from jsonb_populate_recordset(null::${table}, ${JSON.stringify(rows)}::jsonb) with ordinality as excluded
    left join ${table} on (${stored}) = (${proposed})
    where ${target[0]} is null or (${guard ?? sql`true`} and ${changedBy(table, content)})
  `);
  return rowsOf<{ n: number }>(res)
    .map((r) => Number(r.n))
    .sort((a, b) => a - b)
    .map((n) => values[n - 1]);
}
