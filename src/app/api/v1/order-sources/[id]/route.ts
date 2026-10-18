import type { NextRequest } from "next/server";
import { serve } from "@/server/api/v1";
import { deleteSource, loadSource } from "@/server/vetrina/order-sources/service";
import { VetrinaError } from "@/server/vetrina/source";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sourceId(id: string): string {
  if (!UUID.test(id)) throw new VetrinaError("not_found", "No such order source.", 404);
  return id;
}

/** GET /api/v1/order-sources/{id} — one source, matched to the shop now (the products it names that the shop lacks). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return serve(req, () => loadSource(sourceId(id)));
}

/** DELETE /api/v1/order-sources/{id} — the orders it was used for stay as they are. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return serve(req, async () => {
    await deleteSource(sourceId(id));
    return null;
  });
}
