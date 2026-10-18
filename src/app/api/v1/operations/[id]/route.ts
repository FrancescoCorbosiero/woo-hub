import type { NextRequest } from "next/server";
import { operationId, serve } from "@/server/api/v1";
import { loadOperation } from "@/server/vetrina/operations/service";

export const dynamic = "force-dynamic";

/** GET /api/v1/operations/{id} — a catalog action: its status, progress, how its undo went. See docs/api.md. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return serve(req, () => loadOperation(operationId(id)));
}
