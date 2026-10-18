import type { NextRequest } from "next/server";
import { apply, ApplyBody } from "@/server/api/order-sources";
import { operationId, serve } from "@/server/api/v1";
import { VetrinaError } from "@/server/vetrina/source";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/order-sources/{id}/apply — "Usa l'ordine di «X»":
 *   { "term": { "taxonomy": "category", "id": 12 }, "dryRun": true }
 * on a category or brand, or {} on the whole catalog. dryRun answers the
 * preview; without it the action starts (202): follow or undo it at
 * /api/v1/operations/{id}. See docs/order-sources.md.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body: unknown = await req.json().catch(() => ({}));
  const dryRun = typeof body === "object" && body != null && (body as { dryRun?: unknown }).dryRun === true;
  return serve(
    req,
    async () => {
      let sourceId: string;
      try {
        sourceId = operationId(id);
      } catch {
        throw new VetrinaError("not_found", "No such order source.", 404);
      }
      return apply(sourceId, ApplyBody.parse(body ?? {}));
    },
    dryRun ? 200 : 202,
  );
}
