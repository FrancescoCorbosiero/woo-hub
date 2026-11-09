import "server-only";
import type { OperationPreview, OperationVia } from "@/lib/vetrina/catalog-ops";
import { termsNest, type OperationTermRecord, type TermActionInput, type TermTaxonomy } from "@/lib/vetrina/term-ops";
import { decodeEntities } from "@/server/collections/index-rows";
import { requestCheck } from "@/server/collections/runner";
import { storeClient, storeReady } from "@/server/collections/store";
import type { OperationLabelParams, VetrinaOperationRow } from "@/server/db/schema";
import { VetrinaError } from "@/server/vetrina/source";
import type { WooClient } from "@/server/woo/client";
import { dropAliasesOf, recordAlias, termKey } from "@/server/woo/term-aliases";
import { messageOf } from "./live";
import { labelText } from "./plan";
import * as repo from "./repo";
import { logSince } from "./standing";
import { ancestorsIn, childrenIn, descendantsIn, marginAmong, namedUnder, readTerms, REST, termIn, type LiveTerm, type TermList } from "./term-facts";
import { words } from "./words";

/**
 * The store's taxonomies' actions done at once — a category, a brand or a
 * tag made, renamed, moved under another — filed in the Vetrina's log with
 * "Annulla" (lib/vetrina/term-ops.ts). Merging and deleting, which touch
 * every product holding the term, run in the background (term-moves.ts).
 *
 * Each is assessed on the store's terms as they are — refused when it could
 * not be done (a name taken under the same parent, as WordPress refuses it;
 * a term under itself) — said in sentences, written in one request, then
 * filed. A rename keeps the term's slug, so every link to it (the homepage's
 * sections, the menus, the storefront's address) still leads to it. A
 * renamed or moved category or brand leaves its old name as an alias, so
 * Publish files what comes under the old name into the term as it is now.
 *
 * "Annulla" puts it back while the term is as the action left it, and
 * takes the alias away; a term made is deleted again only while nothing
 * holds it.
 */

export interface TermResult {
  /** The term as the action left it (null once deleted). */
  term: LiveTerm | null;
}

export interface TermAssessment {
  label: OperationLabelParams;
  preview: OperationPreview;
  write: () => Promise<{ record: OperationTermRecord; result: TermResult; aliases: { parent: number; name: string; termId: number }[] }>;
}

const invalid = (message: string) => new VetrinaError("invalid", message, 400);
const stale = (message: string) => new VetrinaError("stale", message, 409);

function preview(kind: TermActionInput["kind"], lines: string[], warnings: string[]): OperationPreview {
  return { kind, changes: 1, untouched: [], sample: [], warnings, page: { lines } };
}

/** WordPress's refusal of a write, in the owner's words where we know it. */
function storeRefusal(e: unknown, taxonomy: TermTaxonomy, name: string, parent: string | null): VetrinaError {
  if (e instanceof VetrinaError) return e;
  const err = e as { status?: number; body?: string };
  const code = (() => {
    try {
      return (JSON.parse(err.body ?? "{}") as { code?: string }).code ?? "";
    } catch {
      return "";
    }
  })();
  if (code === "term_exists" || code === "duplicate_term_slug") return invalid(words().term.nameTaken(taxonomy, name, parent));
  if (err.status === 404) return new VetrinaError("not_found", words().term.gone(taxonomy), 404);
  return new VetrinaError("failed", messageOf(e));
}

const nameOf = (list: TermList, id: number) => (id ? (list.get(id)?.name ?? null) : null);

async function client(): Promise<WooClient> {
  if (!storeReady()) throw new VetrinaError("not_configured", words().term.notConfigured);
  return storeClient();
}

/* ---------------------------------------------------------------- *
 * The actions
 * ---------------------------------------------------------------- */

function assessCreate(store: WooClient, list: TermList, input: Extract<TermActionInput, { kind: "termCreate" }>): TermAssessment {
  const w = words().term;
  const tx = input.taxonomy;
  const name = input.name.trim();
  const parent = termsNest(tx) ? (input.parent ?? 0) : 0;
  if (parent && !list.has(parent)) throw invalid(w.parentGone(tx));
  const parentName = nameOf(list, parent);
  if (namedUnder(list, name, parent)) throw invalid(w.nameTaken(tx, name, parentName));
  return {
    label: { kind: "termCreate", count: 1, taxonomy: tx, term: name, into: parentName },
    preview: preview("termCreate", [w.create(tx, name, parentName)], []),
    write: async () => {
      const made = await store.createStoreTerm(REST[tx], parent ? { name, parent } : { name }).catch((e: unknown) => {
        throw storeRefusal(e, tx, name, parentName);
      });
      const term = { id: made.id, name: decodeEntities(made.name), slug: made.slug, parent };
      return { record: { kind: "termCreate", taxonomy: tx, term: { id: term.id, name: term.name, parent } }, result: { term }, aliases: [] };
    },
  };
}

function assessRename(store: WooClient, list: TermList, input: Extract<TermActionInput, { kind: "termRename" }>): TermAssessment {
  const w = words().term;
  const tx = input.taxonomy;
  const term = termIn(list, input.termId, tx);
  const name = input.name.trim();
  if (name === term.name) throw invalid(w.sameName(name));
  const parentName = nameOf(list, term.parent);
  if (namedUnder(list, name, term.parent, term.id)) throw invalid(w.nameTaken(tx, name, parentName));
  // A name that only changes case is the same name to Publish: no alias needed.
  const aliased = tx !== "tag" && termKey(name) !== termKey(term.name);
  return {
    label: { kind: "termRename", count: 1, taxonomy: tx, from: term.name, term: name },
    preview: preview("termRename", [w.rename(tx, term.name, name), ...(aliased ? [w.alias(tx)] : [])], []),
    write: async () => {
      const saved = await store.updateStoreTerm(REST[tx], term.id, { name }).catch((e: unknown) => {
        throw storeRefusal(e, tx, name, parentName);
      });
      const after = decodeEntities(saved.name);
      return {
        record: { kind: "termRename", taxonomy: tx, term: { id: term.id, parent: term.parent }, before: term.name, after },
        result: { term: { ...term, name: after } },
        aliases: aliased ? [{ parent: term.parent, name: term.name, termId: term.id }] : [],
      };
    },
  };
}

async function assessMove(store: WooClient, list: TermList, input: Extract<TermActionInput, { kind: "termMove" }>): Promise<TermAssessment> {
  const w = words().term;
  const tx = input.taxonomy;
  const term = termIn(list, input.termId, tx);
  const parent = input.parent;
  if (parent === term.parent) throw invalid(w.sameParent(term.name));
  if (parent && !list.has(parent)) throw invalid(w.parentGone(tx));
  if (descendantsIn(list, term.id).has(parent)) throw invalid(w.intoItself(tx));
  const parentName = nameOf(list, parent);
  if (namedUnder(list, term.name, parent, term.id)) throw invalid(w.nameTaken(tx, term.name, parentName));
  // A margin set on a term covers the terms below it: moved, its products may fall under another.
  const warnings: string[] = [];
  if (!(await marginAmong(tx, [term.id]))) {
    const around = [...ancestorsIn(list, term.id), ...(parent ? [parent, ...ancestorsIn(list, parent)] : [])];
    if (await marginAmong(tx, around)) warnings.push(w.marginMoves);
  }
  return {
    label: { kind: "termMove", count: 1, taxonomy: tx, term: term.name, into: parentName },
    preview: preview("termMove", [w.move(tx, term.name, parentName, childrenIn(list, term.id).length)], warnings),
    write: async () => {
      await store.updateStoreTerm(REST[tx], term.id, { parent }).catch((e: unknown) => {
        throw storeRefusal(e, tx, term.name, parentName);
      });
      return {
        record: { kind: "termMove", taxonomy: tx, term: { id: term.id, name: term.name }, before: term.parent, after: parent },
        result: { term: { ...term, parent } },
        // Publish finds categories by name under their parent: the old place leads here. Brands it finds by name alone.
        aliases: tx === "category" ? [{ parent: term.parent, name: term.name, termId: term.id }] : [],
      };
    },
  };
}

/** A term action read against the store's terms as they are now: refused as its write would be, or previewed and ready to write. */
export async function assessTermAction(input: TermActionInput): Promise<TermAssessment> {
  const store = await client();
  const list = await readTerms(store, input.taxonomy);
  switch (input.kind) {
    case "termCreate":
      return assessCreate(store, list, input);
    case "termRename":
      return assessRename(store, list, input);
    case "termMove":
      return assessMove(store, list, input);
  }
}

/** Do it: assessed, written, filed with its way back — its aliases filed under it, for "Annulla". */
export async function startTermAction(
  input: TermActionInput,
  via: OperationVia = "app",
  actor: string | null = null,
): Promise<{ row: VetrinaOperationRow | null; result: TermResult }> {
  const assessment = await assessTermAction(input);
  const written = await assessment.write();
  let row: VetrinaOperationRow | null = null;
  try {
    // In demo mode the log of this demo shop starts no later than its first action.
    await logSince();
    row = await repo.insertTermOperation({
      input,
      label: labelText(assessment.label, words("it")),
      labelParams: assessment.label,
      via,
      actor,
      term: written.record,
    });
  } catch (e) {
    console.warn(`[vetrina-ops] term action written but not filed: ${messageOf(e)}`);
  }
  for (const alias of written.aliases) {
    await recordAlias({ taxonomy: input.taxonomy, ...alias, operationId: row?.id ?? null }).catch((e: unknown) =>
      console.warn(`[vetrina-ops] alias of «${alias.name}» not kept: ${messageOf(e)}`),
    );
  }
  // An automatic category's rule may read a category's sub-terms: a move is checked against it.
  if (input.kind === "termMove") requestCheck();
  return { row, result: written.result };
}

/* ---------------------------------------------------------------- *
 * "Annulla"
 * ---------------------------------------------------------------- */

/** Its way back, while the term is as the action left it. */
export async function undoTermAction(row: VetrinaOperationRow, undoneBy: string | null = null): Promise<{ row: VetrinaOperationRow }> {
  const record = row.term;
  if (!record || record.kind === "termMerge" || record.kind === "termDelete") throw invalid(words().error.nothingToUndo);
  const w = words().term;
  const tx = record.taxonomy;
  const store = await client();
  const list = await readTerms(store, tx);
  let restored = 1;
  switch (record.kind) {
    case "termCreate": {
      const term = list.get(record.term.id);
      // Deleted since: what its undo would do is done.
      if (!term) {
        restored = 0;
        break;
      }
      if (term.name !== record.term.name) throw stale(w.changedSince(term.name));
      if (childrenIn(list, term.id).length > 0) throw stale(w.hasChildren(term.name));
      if ((await store.productIdsInTerm(REST[tx], term.id)).length > 0) throw stale(w.hasProducts(term.name));
      await store.deleteStoreTerm(REST[tx], term.id);
      break;
    }
    case "termRename": {
      const term = list.get(record.term.id);
      if (!term || term.name !== record.after) throw stale(w.changedSince(record.after));
      if (namedUnder(list, record.before, term.parent, term.id)) throw stale(w.takenNow(tx, record.before));
      await store.updateStoreTerm(REST[tx], term.id, { name: record.before });
      await dropAliasesOf(row.id);
      break;
    }
    case "termMove": {
      const term = list.get(record.term.id);
      if (!term || term.parent !== record.after) throw stale(w.changedSince(record.term.name));
      if (record.before && !list.has(record.before)) throw stale(w.parentGoneNow(term.name));
      if (descendantsIn(list, term.id).has(record.before)) throw stale(w.changedSince(term.name));
      if (namedUnder(list, term.name, record.before, term.id)) throw stale(w.takenNow(tx, term.name));
      await store.updateStoreTerm(REST[tx], term.id, { parent: record.before });
      await dropAliasesOf(row.id);
      requestCheck();
      break;
    }
  }
  await repo.moveStatus(row.id, ["done"], { status: "undone", undoneAt: new Date(), undoneBy, undo: { restored, kept: 0, failed: 0 }, error: null });
  return { row: (await repo.getOperation(row.id)) ?? row };
}
