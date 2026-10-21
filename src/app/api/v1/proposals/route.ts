import type { NextRequest } from "next/server";
import { serve } from "@/server/api/v1";
import { propose } from "@/server/vetrina/operations/proposals";
import { VetrinaError } from "@/server/vetrina/source";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/proposals — `{ "action": { "kind": "sale", … } }`: the action
 * checked and previewed on the shop as it is, nothing written. The answer
 * (201) is the proposal: its preview, in sentences too, and its id to
 * confirm within 15 minutes. See docs/api.md.
 */
export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => undefined);
  return serve(
    req,
    async () => {
      if (typeof body !== "object" || body == null || !("action" in body)) {
        throw new VetrinaError("invalid", 'The body is { "action": { "kind": … } } (GET /api/v1/actions lists them).', 400);
      }
      return propose((body as { action: unknown }).action, "api");
    },
    201,
  );
}
