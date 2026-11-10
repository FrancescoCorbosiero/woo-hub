import type { NextRequest } from "next/server";
import { OrderBody, order, readOrder, TermQuery } from "@/server/api/catalog-order";
import { serve, shortcutStatus } from "@/server/api/v1";
import { VetrinaError } from "@/server/vetrina/source";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/catalog/order?taxonomy=category&id=12&offset=0&limit=100 —
 * a category's (or brand's) products in the shop's order, the one its page
 * on the shop follows.
 */
export function GET(req: NextRequest) {
  return serve(req, "read", async () => readOrder(TermQuery.parse(Object.fromEntries(req.nextUrl.searchParams))));
}

/**
 * POST /api/v1/catalog/order — place products in that order:
 *   { "taxonomy": "category", "id": 12, "skus": ["DD1391-100"], "position": "top", "dryRun": true }
 * dryRun answers the preview (read). Without it, an admin caller starts the
 * action (202), which runs in the background — follow it, or undo it, at
 * /api/v1/operations/{id}; any other caller with propose gets a proposal
 * instead (201), for a person to confirm. See docs/api.md.
 */
export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => undefined);
  const dryRun = typeof body === "object" && body != null && (body as { dryRun?: unknown }).dryRun === true;
  return serve(
    req,
    dryRun ? "read" : ["propose", "admin"],
    async (_req, caller) => {
      if (body === undefined) throw new VetrinaError("invalid", "The body is not valid JSON.", 400);
      return order(OrderBody.parse(body), caller);
    },
    shortcutStatus,
  );
}
