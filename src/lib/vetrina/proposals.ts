import type { ActionKind, OperationPreview, OperationVia } from "./catalog-ops";

/**
 * A proposal: an action previewed and kept, waiting for the owner's yes —
 * what an assistant (or a script) gets before anything is written. The
 * server keeps the preview it showed: "confirm" runs the action only if the
 * shop still gives the same preview, and only once
 * (src/server/vetrina/operations/proposals.ts).
 */

/** How long a proposal waits for its confirmation. */
export const PROPOSAL_MINUTES = 15;

/**
 * - open: waiting for its confirmation (until `expiresAt`; past it, "expired");
 * - confirming: its action being started (a moment);
 * - confirmed: its action started (`operationId`);
 * - changed: the shop changed since: confirming it made a new proposal, with the new preview;
 * - refused: the action can no longer be done as asked (the page changed, the product is gone).
 */
export type ProposalStatus = "open" | "confirming" | "confirmed" | "changed" | "refused" | "expired";

export interface ProposalView {
  id: string;
  kind: ActionKind;
  /** The action in the owner's words, as the log will say it. */
  label: string;
  /** What it would do, as the screens show it. */
  preview: OperationPreview;
  /** The same in sentences, for a reader without the screens (an assistant shows these). */
  summary: string[];
  status: ProposalStatus;
  /** How it came. */
  via: OperationVia;
  createdAt: string;
  expiresAt: string;
  /** Once confirmed: the action it started, in the log (null when the log could not file it). */
  operationId: string | null;
  /** Once changed: the proposal made in its place, with the new preview. */
  replacedBy: string | null;
}
