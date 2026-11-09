import type { NextRequest } from "next/server";
import { pair, PairBody, sourceIdOf } from "@/server/api/order-sources";
import { serve } from "@/server/api/v1";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/order-sources/{id}/pairs — an item paired by hand:
 *   { "position": 7, "pair": 4810 }     the shop's product 4810
 *   { "position": 7, "pair": "none" }   not in the shop
 *   { "position": 7, "pair": "auto" }   the matcher's answer again
 * Answers the comparison as it reads now. Needs propose, as an upload does:
 * the pairs are the source's, which a proposal of its order uses.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return serve(req, "propose", async (r) => pair(sourceIdOf(id), PairBody.parse(await r.json().catch(() => ({})))));
}
