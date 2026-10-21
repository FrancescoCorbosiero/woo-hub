import type { NextRequest } from "next/server";
import { proposalId, serve } from "@/server/api/v1";
import { loadProposal } from "@/server/vetrina/operations/proposals";

export const dynamic = "force-dynamic";

/** GET /api/v1/proposals/{id} — a proposal: its preview, its status, the action it started. See docs/api.md. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return serve(req, () => loadProposal(proposalId(id)));
}
