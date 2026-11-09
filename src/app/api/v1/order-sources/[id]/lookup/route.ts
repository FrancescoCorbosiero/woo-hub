import type { NextRequest } from "next/server";
import { LookupBody, sourceIdOf } from "@/server/api/order-sources";
import { serve } from "@/server/api/v1";
import { lookupItems } from "@/server/vetrina/order-sources/import";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/order-sources/{id}/lookup { "positions": [3, 9] } — the
 * products KicksDB has for those items (at most 10 a request): by SKU, or by
 * name for an item with none; up to three each, closest first. Nothing is
 * saved: import the one you choose by its SKU.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return serve(req, "read", async (r) => lookupItems(sourceIdOf(id), LookupBody.parse(await r.json().catch(() => ({}))).positions));
}
