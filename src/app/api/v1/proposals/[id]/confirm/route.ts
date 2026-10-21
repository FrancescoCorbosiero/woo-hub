import type { NextRequest } from "next/server";
import { proposalId, serve } from "@/server/api/v1";
import { confirmProposal } from "@/server/vetrina/operations/proposals";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/proposals/{id}/confirm — the owner's yes: the action runs if
 * the shop still gives the proposal's preview (202, the action as the log
 * has it; follow it at /api/v1/operations/{id}). If the shop changed, 409
 * with the new proposal in `data.proposal`, to show and confirm instead.
 * Confirmed twice, it answers the same action. See docs/api.md.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return serve(req, async () => ({ operation: await confirmProposal(proposalId(id)) }), 202);
}
