import "server-only";
import { z } from "zod";
import { may, type Actor } from "@/lib/actors";
import type { OperationInput, OperationPreview, OperationView } from "@/lib/vetrina/catalog-ops";
import type { ProposalView } from "@/lib/vetrina/proposals";
import { parseOperationInput } from "@/server/vetrina/operations/input";
import { propose } from "@/server/vetrina/operations/proposals";
import * as operations from "@/server/vetrina/operations/service";
import { MAX_OPERATION_PRODUCTS } from "@/lib/vetrina/catalog-ops";
import { PRICE_GAP_PERCENT, type SourceComparison, type SourceImport } from "@/lib/vetrina/order-sources";
import { compareSource, pairItem } from "@/server/vetrina/order-sources/compare";
import { importSkus, MAX_IMPORT, MAX_LOOKUP } from "@/server/vetrina/order-sources/import";
import { getSource, putSource } from "@/server/vetrina/order-sources/service";
import { words } from "@/server/vetrina/operations/words";
import { VetrinaError } from "@/server/vetrina/source";

/**
 * Order sources over the API (/api/v1/order-sources): an LLM's (or a
 * script's) ranking uploaded as it is, replaced by its name, and used on a
 * category, a brand or the whole catalog — previewed (dryRun), started (an
 * admin caller) or proposed for a person to confirm (any other).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A source's id from the address: anything else is no source of ours. */
export function sourceIdOf(id: string): string {
  if (!UUID.test(id)) throw new VetrinaError("not_found", "No such order source.", 404);
  return id;
}

/**
 * An upload's body, as text: the agreed format itself (JSON), or
 * { name, origin, content } with the ranking in `content` (any format the
 * Vetrina reads: JSON, CSV, one product per line) — or that text itself,
 * sent as text/plain or text/csv with ?name= in the address.
 */
export async function uploadFrom(req: Request): Promise<{ name: string | null; origin: string | null; text: string }> {
  const url = new URL(req.url);
  const raw = await req.text();
  const queryName = url.searchParams.get("name");
  const queryOrigin = url.searchParams.get("origin");
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("json")) return { name: queryName, origin: queryOrigin, text: raw };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    // An LLM's answer as it came (a sentence, a fence, a trailing comma): the source's own reader takes it.
    return { name: queryName, origin: queryOrigin, text: raw };
  }
  if (body && typeof body === "object" && !Array.isArray(body) && typeof (body as { content?: unknown }).content === "string") {
    const b = body as { name?: unknown; origin?: unknown; content: string };
    return {
      name: typeof b.name === "string" ? b.name : queryName,
      origin: typeof b.origin === "string" ? b.origin : queryOrigin,
      text: b.content,
    };
  }
  return { name: queryName, origin: queryOrigin, text: raw };
}

export async function upload(req: Request) {
  const { name, origin, text } = await uploadFrom(req);
  return putSource({ name, origin, text });
}

export const ApplyBody = z.object({
  /** The category or brand; none = the whole catalog. */
  term: z.object({ taxonomy: z.enum(["category", "brand"]).default("category"), id: z.number().int().positive() }).nullish(),
  dryRun: z.boolean().default(false),
});

/**
 * "Usa l'ordine di «X»" over the API: the preview with dryRun; else the
 * action started for an admin caller, proposed for any other (catalog-order.ts).
 */
export async function apply(
  sourceId: string,
  body: z.infer<typeof ApplyBody>,
  by: Actor,
): Promise<{ dryRun: true; preview: OperationPreview } | { dryRun: false; operation: OperationView } | { dryRun: false; proposal: ProposalView }> {
  await getSource(sourceId);
  return act({ kind: "sourceOrder", sourceId, term: body.term ?? null }, body.dryRun, by);
}

/** Starts an action for an admin caller, proposes it for any other; dryRun answers the preview. */
async function act(
  input: OperationInput,
  dryRun: boolean,
  by: Actor,
): Promise<{ dryRun: true; preview: OperationPreview } | { dryRun: false; operation: OperationView } | { dryRun: false; proposal: ProposalView }> {
  const parsed = parseOperationInput(input);
  if (!parsed.ok) throw new VetrinaError("invalid", parsed.error, 400);
  if (dryRun) return { dryRun: true, preview: await operations.previewOperation(parsed.data) };
  if (may(by, "admin")) return { dryRun: false, operation: await operations.startOperation(parsed.data, "api", by) };
  return { dryRun: false, proposal: await propose(parsed.data, "api", by) };
}

/* ---------------------------------------------------------------- *
 * The comparison: a source against the shop
 * ---------------------------------------------------------------- */

/** ?threshold= — the % beyond which a price differs (2 when absent). */
export function thresholdOf(req: Request): number {
  const raw = new URL(req.url).searchParams.get("threshold");
  if (raw == null || raw === "") return PRICE_GAP_PERCENT;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new VetrinaError("invalid", "threshold: a percentage from 0 to 100.", 400);
  return value;
}

export const PairBody = z.object({
  /** The item's place in the source, 1-based. */
  position: z.number().int().positive(),
  /** A product of the shop (its id); "none": not in the shop; "auto": the matcher's answer again. */
  pair: z.union([z.number().int().positive(), z.enum(["none", "auto"])]),
});

/** An item paired by hand: the comparison as it reads now. */
export function pair(sourceId: string, body: z.infer<typeof PairBody>): Promise<SourceComparison> {
  return pairItem(sourceId, body.position, body.pair === "none" ? null : body.pair === "auto" ? undefined : body.pair);
}

export const LookupBody = z.object({
  /** The items to look up on KicksDB, by their place in the source. */
  positions: z.array(z.number().int().positive()).min(1).max(MAX_LOOKUP),
});

export const ImportBody = z
  .object({
    /** The SKUs to import (an item's own, or one a lookup found). */
    skus: z.array(z.string().trim().min(1).max(64)).min(1).max(MAX_IMPORT).optional(),
    /** Instead of skus: the source's missing items that have a SKU, in its order — the first MAX_IMPORT after `after`. */
    missing: z.literal(true).optional(),
    /** With missing: the place to start after (the answer's `next`). */
    after: z.number().int().min(0).default(0),
    dryRun: z.boolean().default(false),
  })
  .refine((b) => (b.skus != null) !== (b.missing === true), { message: "Give either skus or missing: true." });

/**
 * The source's missing products imported: the SKUs given, or its missing
 * items' own (missing: true) a slice at a time — `next` is where the
 * following slice starts (null: none left).
 */
export async function importFrom(sourceId: string, body: z.infer<typeof ImportBody>): Promise<SourceImport & { next?: number | null }> {
  if (body.skus) {
    await getSource(sourceId);
    return importSkus(body.skus, { dryRun: body.dryRun });
  }
  const comparison = await compareSource(sourceId);
  const missing = comparison.items.filter((i) => i.status === "missing" && i.sku && i.position > body.after);
  const slice = missing.slice(0, MAX_IMPORT);
  if (slice.length === 0) throw new VetrinaError("invalid", words().source.importEmpty, 400);
  const result = await importSkus(
    slice.map((i) => i.sku!),
    { dryRun: body.dryRun },
  );
  return { ...result, next: missing.length > slice.length ? slice[slice.length - 1].position : null };
}

export const PricesBody = z.object({
  /** The matched items whose price to take, by place; none: every one whose price differs beyond the threshold. */
  positions: z.array(z.number().int().positive()).min(1).max(MAX_OPERATION_PRODUCTS).optional(),
  threshold: z.number().min(0).max(100).optional(),
  dryRun: z.boolean().default(false),
});

/**
 * "Allinea i prezzi" from a source: the chosen items' prices (or every one
 * that differs) as a priceMatch action — previewed, started for an admin
 * caller, proposed for any other.
 */
export async function prices(sourceId: string, body: z.infer<typeof PricesBody>, by: Actor) {
  const comparison = await compareSource(sourceId, { threshold: body.threshold });
  const wanted = body.positions ? new Set(body.positions) : null;
  const items = comparison.items
    .filter((i) => i.product && i.price != null && (wanted ? wanted.has(i.position) : i.differs))
    .map((i) => ({ productId: i.product!.id, price: i.price! }));
  if (items.length === 0) throw new VetrinaError("invalid", words().source.pricesNone(comparison.threshold), 400);
  return act({ kind: "priceMatch", items, source: comparison.source.name }, body.dryRun, by);
}
