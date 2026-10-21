import "server-only";
import { z } from "zod";
import type { OperationInput, OperationPreview, OperationView } from "@/lib/vetrina/catalog-ops";
import { parseOperationInput } from "@/server/vetrina/operations/input";
import * as operations from "@/server/vetrina/operations/service";
import { getSource, putSource } from "@/server/vetrina/order-sources/service";
import { VetrinaError } from "@/server/vetrina/source";

/**
 * Order sources over the API (/api/v1/order-sources): an LLM's (or a
 * script's) ranking uploaded as it is, replaced by its name, and used on a
 * category, a brand or the whole catalog — previewed (dryRun) or started.
 */

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

/** "Usa l'ordine di «X»" over the API: the preview with dryRun, else the action started. */
export async function apply(
  sourceId: string,
  body: z.infer<typeof ApplyBody>,
): Promise<{ dryRun: true; preview: OperationPreview } | { dryRun: false; operation: OperationView }> {
  await getSource(sourceId);
  const parsed = parseOperationInput({ kind: "sourceOrder", sourceId, term: body.term ?? null } satisfies OperationInput);
  if (!parsed.ok) throw new VetrinaError("invalid", parsed.error, 400);
  if (body.dryRun) return { dryRun: true, preview: await operations.previewOperation(parsed.data) };
  return { dryRun: false, operation: await operations.startOperation(parsed.data, "api") };
}
