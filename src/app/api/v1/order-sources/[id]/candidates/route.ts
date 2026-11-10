import type { NextRequest } from "next/server";
import { sourceIdOf } from "@/server/api/order-sources";
import { serve } from "@/server/api/v1";
import { itemCandidates } from "@/server/vetrina/order-sources/compare";
import { VetrinaError } from "@/server/vetrina/source";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/order-sources/{id}/candidates?position=7 — one item's
 * candidates: the shop's products whose names come closest, up to three. The
 * comparison names them for its first 300 uncertain and missing items only;
 * this asks for any other.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return serve(req, "read", async (r) => {
    const position = Number(new URL(r.url).searchParams.get("position"));
    if (!Number.isInteger(position) || position < 1) throw new VetrinaError("invalid", "position: an item's place in the source, from 1.", 400);
    return itemCandidates(sourceIdOf(id), position);
  });
}
