import "server-only";
import {
  MAX_SOURCE_ITEMS,
  MAX_SOURCE_NAME,
  MAX_SOURCES,
  type OrderSourceCheck,
  type OrderSourceItem,
  type OrderSourceSummary,
} from "@/lib/vetrina/order-sources";
import { decodeEntities } from "@/server/collections/index-rows";
import { readIndexFacts, type IndexFacts } from "@/server/collections/repo";
import type { VetrinaOrderSourceRow } from "@/server/db/schema";
import { compareFacts } from "@/server/vetrina/catalog";
import { VetrinaError } from "@/server/vetrina/source";
import { words } from "@/server/vetrina/operations/words";
import { parseOrderSource, type ParsedSource } from "./format";
import { matchSource, matchSummary, type SourceMatch } from "./match";
import * as repo from "./repo";

/**
 * Order sources: kept, listed, checked and matched to the shop. A source is
 * matched each time it is shown or used — against the store index, in the
 * shop's order — so a product published after the upload finds its place,
 * and one gone from the shop simply drops out.
 */

/** The shop's products as a source is matched against them, in the shop's order. */
export async function shopForMatching(): Promise<IndexFacts[]> {
  return (await readIndexFacts()).sort(compareFacts("shop"));
}

export function matchAgainst(items: readonly OrderSourceItem[], facts: readonly IndexFacts[]): SourceMatch {
  return matchSource(
    items,
    facts.map((f) => ({ id: f.id, sku: f.sku, name: decodeEntities(f.name) })),
  );
}

function summary(row: VetrinaOrderSourceRow, facts: readonly IndexFacts[]): OrderSourceSummary {
  return {
    id: row.id,
    name: row.name,
    origin: row.origin,
    updatedAt: row.updatedAt.toISOString(),
    ...matchSummary(row.items, matchAgainst(row.items, facts)),
  };
}

/** A source's text, read; refused in the owner's words when it cannot be. */
function parsed(text: string): ParsedSource {
  const res = parseOrderSource(text);
  if (res.ok) return res.source;
  const p = words().source.parse;
  throw new VetrinaError("invalid", res.error === "tooMany" ? p.tooMany(MAX_SOURCE_ITEMS) : p[res.error], 400);
}

/** A source's name: trimmed, one space between words, at most MAX_SOURCE_NAME characters. */
function cleanName(name: string | null | undefined): string {
  const clean = (name ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SOURCE_NAME);
  if (!clean) throw new VetrinaError("invalid", words().source.nameMissing, 400);
  return clean;
}

const cleanOrigin = (origin: string | null | undefined) => (origin ?? "").trim().slice(0, 500) || null;

const isUniqueViolation = (e: unknown) =>
  typeof e === "object" && e != null && ((e as { code?: string }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505");

export async function listSources(): Promise<OrderSourceSummary[]> {
  const [rows, facts] = await Promise.all([repo.listSourceRows(), shopForMatching()]);
  return rows.map((row) => summary(row, facts));
}

/** Every source's id and name, without matching it: what a list's sort sheet offers. */
export async function listSourceNames(): Promise<{ id: string; name: string }[]> {
  return repo.listSourceNames();
}

export async function getSource(id: string): Promise<VetrinaOrderSourceRow> {
  const row = await repo.getSourceRow(id);
  if (!row) throw new VetrinaError("not_found", words().source.gone, 404);
  return row;
}

export async function loadSource(id: string): Promise<OrderSourceSummary> {
  const [row, facts] = await Promise.all([getSource(id), shopForMatching()]);
  return summary(row, facts);
}

/** What a text holds and how it matches the shop — nothing is saved. */
export async function checkSourceText(text: string): Promise<OrderSourceCheck> {
  const source = parsed(text);
  const facts = await shopForMatching();
  return {
    name: source.name,
    origin: source.origin,
    duplicates: source.duplicates,
    ...matchSummary(source.items, matchAgainst(source.items, facts)),
  };
}

/**
 * Save a source from the Vetrina: a new one (a text needed), or one changed
 * — its name, its origin, and its items when a new text comes.
 */
export async function saveSource(input: { id?: string; name: string; origin?: string | null; text?: string | null }): Promise<OrderSourceSummary> {
  const name = cleanName(input.name);
  const origin = cleanOrigin(input.origin);
  const items = input.text != null && input.text.trim() !== "" ? parsed(input.text).items : null;
  const same = await repo.findSourceByName(name);
  if (same && same.id !== input.id) throw new VetrinaError("invalid", words().source.nameTaken(same.name), 400);
  try {
    let row: VetrinaOrderSourceRow | null;
    if (input.id) {
      row = await repo.updateSource(input.id, { name, origin, ...(items ? { items } : {}) });
      if (!row) throw new VetrinaError("not_found", words().source.gone, 404);
    } else {
      if (!items) throw new VetrinaError("invalid", words().source.parse.empty, 400);
      if ((await repo.countSources()) >= MAX_SOURCES) throw new VetrinaError("invalid", words().source.tooManySources(MAX_SOURCES), 400);
      row = await repo.insertSource({ name, origin, items });
    }
    return summary(row, await shopForMatching());
  } catch (e) {
    if (isUniqueViolation(e)) throw new VetrinaError("invalid", words().source.nameTaken(name), 400);
    throw e;
  }
}

/**
 * The API's upload: the source of that name replaced, or made. The name
 * comes from the request or from the text (its "name"); the origin likewise.
 */
export async function putSource(input: { name?: string | null; origin?: string | null; text: string }): Promise<{ created: boolean; source: OrderSourceSummary }> {
  const source = parsed(input.text);
  const name = cleanName(input.name ?? source.name);
  const existing = await repo.findSourceByName(name);
  const origin = cleanOrigin(input.origin ?? source.origin ?? existing?.origin);
  if (existing) {
    const row = await repo.updateSource(existing.id, { name: existing.name, origin, items: source.items });
    if (!row) throw new VetrinaError("not_found", words().source.gone, 404);
    return { created: false, source: summary(row, await shopForMatching()) };
  }
  return { created: true, source: await saveSource({ name, origin, text: input.text }) };
}

export async function deleteSource(id: string): Promise<void> {
  if (!(await repo.deleteSourceRow(id))) throw new VetrinaError("not_found", words().source.gone, 404);
}
