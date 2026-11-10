import "server-only";
import { actorOf, type Actor } from "@/lib/actors";
import {
  OPERATION_UNDO_DAYS,
  type HomepageSectionOption,
  type OperationInput,
  type OperationPreview,
  type OperationTarget,
  type OperationVia,
  type OperationView,
  type TermActionsState,
  type TermKey,
  type TermMarginState,
} from "@/lib/vetrina/catalog-ops";
import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import { isMenuActionKind, type MenuActionInput } from "@/lib/vetrina/menu-ops";
import { isTermActionKind, type TermActionInput } from "@/lib/vetrina/term-ops";
import { isPageActionKind, type PageActionInput, type PageActionKind } from "@/lib/vetrina/page-ops";
import type { VetrinaOperationRow } from "@/server/db/schema";
import { readCatalogTrees, readTermProducts } from "@/server/vetrina/catalog";
import { readRail } from "@/server/vetrina/service";
import { VetrinaError } from "@/server/vetrina/source";
import { isWriter, NOT_WRITER } from "@/server/writer";
import { termKeyOf } from "./context";
import { checkMarginUndo, loadTermMargin as readTermMargin } from "./margin";
import { labelText, standingSales, undoable } from "./plan";
import { assess } from "./preview";
import * as repo from "./repo";
import { isQueued, queueRun, queueSweep, queueUndo, recover } from "./runner";
import { startMenuAction, undoMenuAction, type MenuResult } from "./menu";
import { startTermAction, undoTermAction, type TermResult } from "./terms";
import { startPageAction, undoPageAction, type PageResult } from "./page";
import { homepageSections } from "./sections";
import { sectionVerdict } from "./writes";
import { heldByTermHides, heldTerms, logSince, shopToday, standingTermHide, termNewcomers, termSaleProducts } from "./standing";
import { words } from "./words";

/**
 * The catalog's actions, as the screens use them (through
 * server/actions/vetrina-operations.ts): preview, start, follow, list, undo,
 * a term's standing hide and sale, and the homepage's sections to pin into —
 * and the homepage's own actions (page.ts), in the same log, with the same
 * undo.
 */

// Where the input's checks look for it (and their tests stand it in).
export { shopToday };

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/**
 * The catalog's actions run only in the process that writes (HUB_ROLE,
 * src/server/writer.ts): refused here, before anything is filed — a row
 * filed where no runner takes it would wait for nothing.
 */
function mustWrite(): void {
  if (!isWriter()) throw new VetrinaError("not_configured", NOT_WRITER, 503);
}

export function operationView(row: VetrinaOperationRow, now = Date.now(), sectionKey?: string | null): OperationView {
  // A homepage or menu action with no way back on file (a fixed list pointed elsewhere) has no "Annulla".
  const wayBack = isPageActionKind(row.kind)
    ? row.page != null
    : isMenuActionKind(row.kind)
      ? row.menu != null
      : isTermActionKind(row.kind)
        ? row.term != null
        : true;
  return {
    id: row.id,
    kind: row.kind,
    // In the reader's language; a row from before labels were kept as data says its own words.
    label: row.labelParams ? labelText(row.labelParams) : row.label,
    status: row.status,
    via: row.via,
    actor: row.actor,
    progress: { done: row.done, total: row.total },
    changed: row.changed,
    failed: row.failed,
    error: row.error,
    termKey: (row.termKey as TermKey | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    finishedAt: iso(row.finishedAt),
    undoable: wayBack && undoable(row, now, OPERATION_UNDO_DAYS),
    undoneAt: iso(row.undoneAt),
    undoneBy: row.undoneBy,
    queued: (row.status === "running" || row.status === "undoing") && isQueued(row.id),
    undo: row.undo ?? null,
    ...(sectionKey !== undefined ? { sectionKey } : {}),
  };
}

/** What the action would do, named product by product — nothing is written. */
export async function previewOperation(input: OperationInput): Promise<OperationPreview> {
  return (await assess(input, { live: true })).preview;
}

/**
 * File the action and queue it; it runs in the background. The answer is its
 * row, to follow. `via`: how it came (the Vetrina's screens unless said);
 * `by`: who asked (src/lib/actors.ts), null when nobody is signed in.
 */
export async function startOperation(input: OperationInput, via: OperationVia = "app", by: Actor | null = null): Promise<OperationView> {
  mustWrite();
  await recover();
  // In demo mode the log of this demo shop starts no later than its first action.
  await logSince();
  const assessment = await assess(input, { live: false });
  // The refusal first: it says why ("Sono già in quest'ordine"), where "nothing chosen" would not.
  if (assessment.refusal) throw new VetrinaError("invalid", assessment.refusal, 400);
  if (assessment.total === 0) throw new VetrinaError("invalid", words().error.empty, 400);
  // "Elimina" goes for the products it was confirmed on: a list's "Seleziona tutti" is fixed to what it
  // matches now, not resolved again when the run's turn comes (a product hidden meanwhile, say, would go
  // without the owner having seen it).
  const filed: OperationInput =
    input.kind === "delete" && input.target.kind === "query" && assessment.ids
      ? { ...input, target: { kind: "ids", ids: assessment.ids } }
      : input;
  const row = await repo.insertOperation({
    kind: input.kind,
    input: filed,
    // Italian for the server's own logs; the screens render the parameters in the owner's language.
    label: labelText(assessment.label, words("it")),
    labelParams: assessment.label,
    termKey: assessment.termKey,
    total: assessment.total,
    via,
    actor: actorOf(by),
  });
  queueRun(row.id);
  return operationView(row);
}

/**
 * A homepage action, done at once (page.ts): the write's own answer, and the
 * log's view of it — null when the log could not file it.
 */
export async function startPageOperation<K extends PageActionKind>(
  input: Extract<PageActionInput, { kind: K }>,
  via: OperationVia = "app",
  by: Actor | null = null,
): Promise<{ operation: OperationView | null; result: PageResult<K> }> {
  const { row, sectionKey, result } = await startPageAction(input, via, actorOf(by));
  return { operation: row ? operationView(row, Date.now(), sectionKey) : null, result };
}

/**
 * A menu action, done at once (menu.ts): the menu as it is after, and the
 * log's view of it — null when the log could not file it.
 */
/**
 * A taxonomy action done at once (terms.ts): the term as it is after, and the
 * log's view of it — null when the log could not file it.
 */
export async function startTermOperation(
  input: TermActionInput,
  via: OperationVia = "app",
  by: Actor | null = null,
): Promise<{ operation: OperationView | null; result: TermResult }> {
  const { row, result } = await startTermAction(input, via, actorOf(by));
  return { operation: row ? operationView(row) : null, result };
}

export async function startMenuOperation(
  input: MenuActionInput,
  via: OperationVia = "app",
  by: Actor | null = null,
): Promise<{ operation: OperationView | null; result: MenuResult }> {
  const { row, result } = await startMenuAction(input, via, actorOf(by));
  return { operation: row ? operationView(row) : null, result };
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
 * section was changed since (its pins are someone's newer word). `by`: who
 * undoes it, filed on the row.
 */
export async function undoOperation(id: string, by: Actor | null = null): Promise<OperationView> {
  await recover();
  const row = await found(id);
  const w = words();
  if (row.status === "running") throw new VetrinaError("invalid", w.error.stillRunning, 409);
  if (row.status === "undoing") throw new VetrinaError("invalid", w.error.undoing, 409);
  if (row.status === "undone" || row.undoneAt) throw new VetrinaError("invalid", w.error.alreadyUndone, 409);
  if (row.status === "failed" && row.changed === 0) throw new VetrinaError("invalid", w.error.nothingToUndo, 400);
  if (!undoable(row, Date.now(), OPERATION_UNDO_DAYS)) throw new VetrinaError("invalid", w.error.tooOld(OPERATION_UNDO_DAYS), 400);
  // A homepage action is one write: its way back is written now, not queued.
  if (isPageActionKind(row.kind)) {
    const undone = await undoPageAction(row, actorOf(by));
    return operationView(undone.row, Date.now(), undone.sectionKey);
  }
  // A menu action's way back is written at once too.
  if (isMenuActionKind(row.kind)) return operationView((await undoMenuAction(row, actorOf(by))).row);
  // So is a taxonomy action's done at once (a merge's and a deletion's are queued, below).
  if (isTermActionKind(row.kind)) return operationView((await undoTermAction(row, actorOf(by))).row);
  // A catalog action's undo is queued like the action itself: in the writer only.
  mustWrite();
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
  const moved = await repo.moveStatus(id, ["done", "failed"], { status: "undoing", error: null, undoneBy: actorOf(by) });
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
  mustWrite();
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
