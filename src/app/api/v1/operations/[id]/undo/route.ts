import type { NextRequest } from "next/server";
import { operationId, serve } from "@/server/api/v1";
import { undoOperation } from "@/server/vetrina/operations/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/operations/{id}/undo — "Annulla": each value back where the
 * store still shows what the action wrote. Runs in the background (202):
 * follow it at /api/v1/operations/{id}. See docs/api.md.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return serve(req, () => undoOperation(operationId(id)), 202);
}
