import type { NextRequest } from "next/server";
import { sourceIdOf, thresholdOf } from "@/server/api/order-sources";
import { serve } from "@/server/api/v1";
import { compareSource } from "@/server/vetrina/order-sources/compare";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/order-sources/{id}/compare?threshold=2 — the source against the
 * shop, item by item: the product each is (matched, paired by hand, several
 * possible, none), its price there against the shop's (beyond the threshold,
 * %), and for a missing one whether the Hub's catalog has it. See
 * docs/order-sources.md.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return serve(req, "read", async (r) => compareSource(sourceIdOf(id), { threshold: thresholdOf(r) }));
}
