import "server-only";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Locale } from "@/i18n/config";
import { actorId, actorOf, isPerson, type Actor } from "@/lib/actors";
import type { ActionInput, OperationInput, OperationPreview, OperationVia, OperationView } from "@/lib/vetrina/catalog-ops";
import { isMenuActionKind, type MenuActionInput } from "@/lib/vetrina/menu-ops";
import { isTermActionKind, type TermActionInput } from "@/lib/vetrina/term-ops";
import { isPageActionKind, type PageActionInput } from "@/lib/vetrina/page-ops";
import { PROPOSAL_MINUTES, type ProposalView } from "@/lib/vetrina/proposals";
import { db } from "@/server/db/client";
import { vetrinaProposals, type OperationLabelParams, type VetrinaProposalRow } from "@/server/db/schema";
import { VetrinaError } from "@/server/vetrina/source";
import { assessMenu } from "./menu";
import { assessTermAction } from "./terms";
import { assessPage } from "./page";
import { labelText } from "./plan";
import { assess } from "./preview";
import { digestOf, summaryOf } from "./proposal-plan";
import { parseAction } from "./registry";
import { loadOperation, startMenuOperation, startOperation, startPageOperation, startTermOperation } from "./service";
import { currentLanguage, inLanguage, words } from "./words";

/**
 * Proposals: the owner's yes, kept by the server. Someone outside the
 * screens — an assistant acting for the owner, a script — never writes in
 * one step: it proposes an action, the server answers what the action
 * would do (its preview, in sentences too) and keeps it; the owner says
 * yes; the confirmation runs the action — only if the shop still gives the
 * same preview, and only once.
 *
 * - propose: the action checked and previewed as the screens preview it,
 *   refused when it could not run; kept PROPOSAL_MINUTES.
 * - confirm: by a person only (src/lib/actors.ts isPerson) — never by the
 *   program that proposed. The preview made again, in the proposal's
 *   language. The same fingerprint: the action runs (filed in the log, how
 *   it came and who confirmed it included). Another: nothing runs — a new
 *   proposal takes its place, with the new preview, for the owner to look at
 *   again. Refused now (the page changed under it, a product is gone): the
 *   proposal is over, and says why.
 */

const KEEP_DAYS = 30;

/** What the action would do on the shop as it is now, and its label — refused as the action itself would be. */
async function previewOf(input: ActionInput): Promise<{ preview: OperationPreview; label: OperationLabelParams }> {
  if (isPageActionKind(input.kind)) {
    const assessment = await assessPage(input as PageActionInput);
    return { preview: assessment.preview, label: assessment.label };
  }
  if (isTermActionKind(input.kind)) {
    const assessment = await assessTermAction(input as TermActionInput);
    return { preview: assessment.preview, label: assessment.label };
  }
  if (isMenuActionKind(input.kind)) {
    // The preview carries the menu's fingerprint: a menu changed since makes a new proposal.
    const assessment = await assessMenu(input as MenuActionInput);
    return { preview: assessment.preview, label: assessment.label };
  }
  const assessment = await assess(input as OperationInput, { live: true });
  if (assessment.refusal) throw new VetrinaError("invalid", assessment.refusal, 400);
  if (assessment.total === 0) throw new VetrinaError("invalid", words().error.empty, 400);
  return { preview: assessment.preview, label: assessment.label };
}

/** A homepage or menu action's `expected` is the asker's own check, done when it is proposed: the proposal's preview is the check after. */
function withoutExpected(input: ActionInput): ActionInput {
  if (!isPageActionKind(input.kind) && !isMenuActionKind(input.kind)) return input;
  const { expected: _expected, ...asked } = input as (PageActionInput | MenuActionInput) & { expected?: unknown };
  return asked as ActionInput;
}

function proposalView(row: VetrinaProposalRow, now = Date.now()): ProposalView {
  return {
    id: row.id,
    kind: row.kind,
    label: labelText(row.labelParams),
    preview: row.preview,
    summary: summaryOf(row.labelParams, row.preview),
    status: row.status === "open" && row.expiresAt.getTime() <= now ? "expired" : row.status,
    via: row.via,
    actor: row.actor,
    confirmedBy: row.confirmedBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    operationId: row.operationId,
    replacedBy: row.replacedBy,
  };
}

async function insert(
  input: ActionInput,
  via: OperationVia,
  made: { preview: OperationPreview; label: OperationLabelParams },
  actor: string | null,
): Promise<VetrinaProposalRow> {
  const [row] = await db
    .insert(vetrinaProposals)
    .values({
      kind: input.kind,
      input,
      via,
      actor,
      locale: currentLanguage(),
      // Italian for the server's own logs; a view renders label_params in the reader's language.
      label: labelText(made.label, words("it")),
      labelParams: made.label,
      preview: made.preview,
      digest: digestOf(made.preview),
      expiresAt: new Date(Date.now() + PROPOSAL_MINUTES * 60_000),
    })
    .returning();
  return row;
}

async function found(id: string): Promise<VetrinaProposalRow> {
  const [row] = await db.select().from(vetrinaProposals).where(eq(vetrinaProposals.id, id)).limit(1);
  if (!row) throw new VetrinaError("not_found", words().proposal.notFound, 404);
  return row;
}

const update = (id: string, set: Partial<typeof vetrinaProposals.$inferInsert>) =>
  db.update(vetrinaProposals).set(set).where(eq(vetrinaProposals.id, id));

/**
 * Propose an action: checked, previewed on the shop as it is, kept for the
 * owner's yes. Nothing is written. `by`: who proposes (src/lib/actors.ts),
 * filed with it.
 */
export async function propose(input: unknown, via: OperationVia, by: Actor | null = null): Promise<ProposalView> {
  const parsed = parseAction(input);
  if (!parsed.ok) throw new VetrinaError("invalid", parsed.error, 400);
  const made = await previewOf(parsed.data);
  return proposalView(await insert(withoutExpected(parsed.data), via, made, actorOf(by)));
}

export async function loadProposal(id: string): Promise<ProposalView> {
  return proposalView(await found(id));
}

/**
 * The owner's yes: the action runs, if the shop still gives the preview the
 * proposal showed. Confirmed twice, it answers the action it started the
 * first time. The answer is the action as the log has it (null when the log
 * could not file a homepage action, written all the same).
 *
 * `by` must be a person (isPerson): someone signed in on the screens, or a
 * token holding the confirm scope, which only a person keeps. A program's
 * token — the one that proposed, say — is refused before anything is read:
 * it is not the owner's yes. The action is filed as the person's, and so is
 * the decision on the proposal.
 */
export async function confirmProposal(id: string, by: Actor): Promise<OperationView | null> {
  const w = words().proposal;
  if (!isPerson(by)) throw new VetrinaError("forbidden", w.personOnly, 403);
  const confirmedBy = actorId(by);
  const row = await found(id);
  const view = proposalView(row);
  switch (view.status) {
    case "confirmed":
      return row.operationId ? loadOperation(row.operationId) : null;
    case "confirming":
      throw new VetrinaError("invalid", w.confirming, 409);
    case "changed": {
      const replacement = row.replacedBy ? proposalView(await found(row.replacedBy)) : null;
      throw new VetrinaError("stale", w.replaced, 409, replacement ? { proposal: replacement } : undefined);
    }
    case "refused":
      throw new VetrinaError("invalid", w.refused(row.error ?? ""), 409);
    case "expired":
      throw new VetrinaError("invalid", w.expired(PROPOSAL_MINUTES), 410);
    case "open":
      break;
  }

  // Taken by this confirmation only: two at once cannot both run it.
  const claimed = await db
    .update(vetrinaProposals)
    .set({ status: "confirming" })
    .where(and(eq(vetrinaProposals.id, id), eq(vetrinaProposals.status, "open"), gt(vetrinaProposals.expiresAt, new Date())))
    .returning({ id: vetrinaProposals.id });
  if (claimed.length === 0) return confirmProposal(id, by);

  let made: { preview: OperationPreview; label: OperationLabelParams };
  try {
    made = await inLanguage(row.locale as Locale, () => previewOf(row.input));
  } catch (e) {
    return refuse(id, e, confirmedBy);
  }
  if (digestOf(made.preview) !== row.digest) {
    // The shop changed since the owner saw it: nothing runs; the new preview is for the owner to look at
    // again — proposed, like the first, by whoever proposed that.
    const replacement = await inLanguage(row.locale as Locale, () => insert(row.input, row.via, made, row.actor));
    await update(id, { status: "changed", replacedBy: replacement.id, decidedAt: new Date(), confirmedBy });
    throw new VetrinaError("stale", w.changed, 409, { proposal: proposalView(replacement) });
  }

  let operation: OperationView | null;
  try {
    operation = isPageActionKind(row.input.kind)
      ? (await startPageOperation(row.input as PageActionInput, row.via, by)).operation
      : isMenuActionKind(row.input.kind)
        ? (await startMenuOperation(row.input as MenuActionInput, row.via, by)).operation
        : isTermActionKind(row.input.kind)
          ? (await startTermOperation(row.input as TermActionInput, row.via, by)).operation
        : await startOperation(row.input as OperationInput, row.via, by);
  } catch (e) {
    return refuse(id, e, confirmedBy);
  }
  await update(id, { status: "confirmed", operationId: operation?.id ?? null, decidedAt: new Date(), confirmedBy });
  return operation;
}

/**
 * The action refused when confirmed: one of ours (the page changed under
 * it, a product gone) ends the proposal, saying why — and who confirmed it;
 * anything else (the site not answering) leaves it open, to be confirmed
 * again.
 */
async function refuse(id: string, e: unknown, confirmedBy: string): Promise<never> {
  if (e instanceof VetrinaError && (e.code === "invalid" || e.code === "stale" || e.code === "not_found")) {
    await update(id, { status: "refused", error: e.message, decidedAt: new Date(), confirmedBy });
  } else {
    await update(id, { status: "open" });
  }
  throw e;
}

/** Proposals past the log's 30 days: gone (retention.ts, once a day). */
export async function trimProposals(now = Date.now()): Promise<number> {
  const removed = await db
    .delete(vetrinaProposals)
    .where(lt(vetrinaProposals.createdAt, new Date(now - KEEP_DAYS * 86_400_000)))
    .returning({ id: vetrinaProposals.id });
  return removed.length;
}
