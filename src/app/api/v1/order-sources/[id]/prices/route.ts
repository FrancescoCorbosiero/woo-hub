import type { NextRequest } from "next/server";
import { prices, PricesBody, sourceIdOf } from "@/server/api/order-sources";
import { serve, shortcutStatus } from "@/server/api/v1";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/order-sources/{id}/prices — "Allinea i prezzi": the shop's
 * products brought to the source's prices (priceMatch):
 *   { "dryRun": true }                         every one that differs beyond 2%: the preview
 *   { "positions": [3, 9], "threshold": 5 }    those items
 * Without dryRun an admin caller starts it (202), any other with propose
 * gets a proposal (201). The Hub's products get locks the price sync keeps
 * (docs/order-sources.md).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body: unknown = await req.json().catch(() => ({}));
  const dryRun = typeof body === "object" && body != null && (body as { dryRun?: unknown }).dryRun === true;
  return serve(
    req,
    dryRun ? "read" : ["propose", "admin"],
    async (_req, caller) => prices(sourceIdOf(id), PricesBody.parse(body ?? {}), caller),
    shortcutStatus,
  );
}
