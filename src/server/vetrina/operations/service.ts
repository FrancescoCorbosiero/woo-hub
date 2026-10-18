import "server-only";
import {
  OPERATION_UNDO_DAYS,
  type HomepageSectionOption,
  type OperationInput,
  type OperationPreview,
  type OperationTarget,
  type OperationView,
  type TermActionsState,
  type TermKey,
  type TermMarginState,
} from "@/lib/vetrina/catalog-ops";
import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import type { VetrinaOperationRow } from "@/server/db/schema";
import { readCatalogTrees, readTermProducts } from "@/server/vetrina/catalog";
import { readRail } from "@/server/vetrina/service";
import { VetrinaError } from "@/server/vetrina/source";
import { termKeyOf } from "./context";
import { checkMarginUndo, loadTermMargin as readTermMargin } from "./margin";
import { labelText, standingSales, undoable } from "./plan";
import { assess } from "./preview";
import * as repo from "./repo";
import { isQueued, queueRun, queueSweep, queueUndo, recover } from "./runner";
import { homepageSections } from "./sections";
import { sectionVerdict } from "./writes";
import { heldByTermHides, heldTerms, logSince, shopToday, standingTermHide, termNewcomers, termSaleProducts } from "./standing";
import { words } from "./words";

/**
 * The catalog's actions, as the screens use them (through
 * server/actions/vetrina-operations.ts): preview, start, follow, list, undo,
 * a term's standing hide and sale, and the homepage's sections to pin into.
 */

// Where the input's checks look for it (and their tests stand it in).
export { shopToday };

const iso = (date: Date | null) => (date ? date.toISOString() : null);

export function operationView(row: VetrinaOperationRow, now = Date.now()): OperationView {
  return {
    id: row.id,
    kind: row.kind,
    // In the reader's language; a row from before labels were kept as data says its own words.
    label: row.labelParams ? labelText(row.labelParams) : row.label,
    status: row.status,
    progress: { done: row.done, total: row.total },
    changed: row.changed,
    failed: row.failed,
    error: row.error,
    termKey: (row.termKey as TermKey | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    finishedAt: iso(row.finishedAt),
    undoable: undoable(row, now, OPERATION_UNDO_DAYS),
    undoneAt: iso(row.undoneAt),
    queued: (row.status === "running" || row.status === "undoing") && isQueued(row.id),
    undo: row.undo ?? null,
  };
}

/** What the action would do, named product by product — nothing is written. */
export async function previewOperation(input: OperationInput): Promise<OperationPreview> {
  return (await assess(input, { live: true })).preview;
}

/** File the action and queue it; it runs in the background. The answer is its row, to follow. */
export async function startOperation(input: OperationInput): Promise<OperationView> {
  await recover();
  // In demo mode the log of this demo shop starts no later than its first action.
  await logSince();
  const assessment = await assess(input, { live: false });
  // The refusal first: it says why ("Sono già in quest'ordine"), where "nothing chosen" would not.
  if (assessment.refusal) throw new VetrinaError("invalid", assessment.refusal, 400);
  if (assessment.total === 0) throw new VetrinaError("invalid", words().error.empty, 400);
  const row = await repo.insertOperation({
    kind: input.kind,
    input,
    // Italian for the server's own logs; the screens render the parameters in the owner's language.
    label: labelText(assessment.label, words("it")),
    labelParams: assessment.label,
    termKey: assessment.termKey,
    total: assessment.total,
  });
  queueRun(row.id);
  return operationView(row);
}

async function found(id: string): Promise<VetrinaOperationRow> {
  const row = await repo.getOperation(id, await logSince());
  if (!row) throw new VetrinaError("not_found", words().error.notFound, 404);
  return row;
}

export async function loadOperation(id: string): Promise<OperationView> {
  await recover();
  return operationView(await found(id));
}

/** The newest actions first. */
export async function listOperations(limit = 20): Promise<OperationView[]> {
  await recover();
  return (await repo.listOperationRows(limit, await logSince())).map((row) => operationView(row));
}

/**
 * "Annulla": queue the undo. Refused while the action is still under way,
 * once undone, past its time — and, for a place on the homepage, when the
 * section was changed since (its pins are someone's newer word).
 */
export async function undoOperation(id: string): Promise<OperationView> {
  await recover();
  const row = await found(id);
  const w = words();
  if (row.status === "running") throw new VetrinaError("invalid", w.error.stillRunning, 409);
  if (row.status === "undoing") throw new VetrinaError("invalid", w.error.undoing, 409);
  if (row.status === "undone" || row.undoneAt) throw new VetrinaError("invalid", w.error.alreadyUndone, 409);
  if (row.status === "failed" && row.changed === 0) throw new VetrinaError("invalid", w.error.nothingToUndo, 400);
  if (!undoable(row, Date.now(), OPERATION_UNDO_DAYS)) throw new VetrinaError("invalid", w.error.tooOld(OPERATION_UNDO_DAYS), 400);
  if (row.section) {
    // A section deleted since has nothing to put back: the undo still takes back the categories the pin added.
    const rail = await readRail(row.section.key).then(
      (r) => r.rail,
      (e: unknown) => {
        if (e instanceof VetrinaError && e.code === "not_found") return null;
        throw e;
      },
    );
    if (rail && sectionVerdict(rail, row.section) === "changed") {
      throw new VetrinaError("stale", w.error.sectionChanged(row.section.title), 409);
    }
  }
  // A margin's rule set again since (here or on the Margins tab) is the newer word.
  if (row.kind === "margin") await checkMarginUndo(row);
  const moved = await repo.moveStatus(id, ["done", "failed"], { status: "undoing", error: null });
  if (!moved) throw new VetrinaError("invalid", w.error.undoing, 409);
  queueUndo(id, { status: row.status, done: row.done, total: row.total });
  return operationView(await found(id));
}

/**
 * A category's or brand's screen: hidden by an action ("Mostra" undoes it),
 * the sale running on it — and its counts, read now, so the switch never
 * decides from counts older than the actions: of its hidden products, those
 * another hidden category or brand holds (that one's "Mostra" brings them
 * back, not this one's); of those on sale, the ones on a sale of their own.
 */
export async function loadTermActions(taxonomy: CatalogTaxonomy, id: number): Promise<TermActionsState> {
  await recover();
  const key = termKeyOf(taxonomy, id);
  const [rows, products] = await Promise.all([
    logSince().then((since) => repo.termOperationRows(key, since)),
    readTermProducts(taxonomy, id),
  ]);
  const hide = await standingTermHide(key);
  const [sale, under] = standingSales(rows, shopToday());
  // Under the term's own hide the switch undoes that hide: what others hold matters only without it.
  const held = hide ? new Map() : await heldByTermHides(products.hidden, (row) => row.termKey === key);
  const termSale = await termSaleProducts(rows);
  return {
    hiddenBy: hide ? operationView(hide) : null,
    sale:
      sale && sale.input.kind === "sale"
        ? {
            percent: sale.input.percent,
            endsOn: sale.input.endsOn,
            operation: operationView(sale),
            rounding: sale.input.rounding,
            replaces: under?.input.kind === "sale" ? under.input.percent : null,
            ...(under?.input.kind === "sale" ? { replacesEndsOn: under.input.endsOn } : {}),
          }
        : null,
    counts: {
      count: products.count,
      hidden: products.hidden.length,
      held: held.size > 0 ? heldTerms(held, await readCatalogTrees()) : [],
      ownSale: products.onSale.filter((productId) => !termSale.has(productId)).length,
      // Joined the hidden term since, still listed: the next sweep hides them, or the panel's button now.
      ...(hide ? { addedSince: (await termNewcomers(hide)).length } : {}),
    },
  };
}

/** "Nascondi i nuovi arrivati": a hidden term's newcomers hidden now, rather than at the next check. */
export async function hideTermNewcomers(): Promise<void> {
  await recover();
  await queueSweep();
}

/** A category's or brand's margin, for its screen's "Ricarico" row (phase 4). */
export async function loadTermMargin(taxonomy: CatalogTaxonomy, id: number): Promise<TermMarginState> {
  return readTermMargin({ taxonomy, termId: id });
}

/** The homepage's product sections, for "Metti in homepage" — with, for some products, how many of them each would take. */
export async function loadHomepageSections(target?: OperationTarget): Promise<HomepageSectionOption[]> {
  return homepageSections(target);
}
