import "server-only";
import { storeClient } from "@/server/collections/store";
import type { VetrinaOperationRow } from "@/server/db/schema";
import { forgetHomepagePresence } from "@/server/vetrina/catalog";
import { VetrinaError } from "@/server/vetrina/source";
import { messageOf } from "./live";
import * as repo from "./repo";
import { words } from "./words";
import { runOperation, runUndo, type RunCtx, type Tally } from "./writes";

/**
 * The catalog's actions run here, in the server process, in the background:
 * one at a time, in the order asked — two actions writing the same products
 * at once would each file a "before" the other is about to change. An
 * action outlives the request that started it (closing the app does not
 * stop it) and writes its progress to its row as it goes, which is what the
 * screens poll.
 *
 * State lives on globalThis, like the automatic categories' runs: the
 * instrumentation bundle and the server actions each get their own copy of
 * this module. A restart loses the queue: what it left running is marked
 * interrupted (recover()), never resumed.
 *
 * A job runs in the language of the request that queued it (words.ts): the
 * error it records reads in the starter's words.
 */

interface RunnerState {
  chain: Promise<void>;
  /** Waiting, in order. */
  queued: string[];
  running: string | null;
  /** The restart check, once per process. */
  recovered: Promise<void> | null;
}

const g = globalThis as { __vetrinaOperations?: RunnerState };

function state(): RunnerState {
  return (g.__vetrinaOperations ??= { chain: Promise.resolve(), queued: [], running: null, recovered: null });
}

/** Waiting behind another action (not merely about to start). */
export function isQueued(id: string): boolean {
  const s = state();
  const at = s.queued.indexOf(id);
  return at > 0 || (at === 0 && s.running != null);
}

/**
 * Once per process, before any action is filed or read: whatever a previous
 * process left running or undoing was cut off with it — marked so, with how
 * far it got. Undoing what it did stays possible.
 */
export function recover(): Promise<void> {
  const s = state();
  s.recovered ??= repo
    .markInterrupted({ run: words().error.interrupted, undo: words().error.undoInterrupted })
    .then((n) => {
      if (n > 0) console.warn(`[vetrina-ops] ${n} action(s) interrupted by a restart`);
    })
    .catch((e: unknown) => {
      // Tried again on the next call: a database not up yet is not a verdict.
      s.recovered = null;
      throw e;
    });
  return s.recovered;
}

function enqueue(id: string, job: () => Promise<void>): void {
  const s = state();
  s.queued.push(id);
  s.chain = s.chain.then(async () => {
    s.queued.splice(s.queued.indexOf(id), 1);
    s.running = id;
    try {
      await job();
    } catch (e) {
      console.error(`[vetrina-ops] ${id}: ${messageOf(e)}`);
    } finally {
      s.running = null;
      // What the homepage's sections show may have moved (a product hidden,
      // put in a category, pinned): the catalog's marks follow at once.
      forgetHomepagePresence();
    }
  });
}

/** Resolves once every action queued so far has finished. */
export function idle(): Promise<void> {
  return state().chain;
}

/** Why it stopped, for the owner: a refusal in its own words, anything else after "Interrotta da un errore". */
const reason = (e: unknown) => (e instanceof VetrinaError ? e.message : words().error.stopped(messageOf(e)));

function context(op: VetrinaOperationRow, tally: Tally, write: (t: Tally) => Promise<void>): Promise<RunCtx> {
  return storeClient().then((client) => ({ op, client, tally, step: () => write(tally) }));
}

/** Queue a filed action to run. */
export function queueRun(id: string): void {
  enqueue(id, async () => {
    const op = await repo.getOperation(id);
    if (!op || op.status !== "running") return;
    const tally: Tally = { done: 0, total: op.total, changed: 0, failed: 0 };
    try {
      const ctx = await context(op, tally, (t) => repo.updateOperation(id, { ...t }));
      await runOperation(ctx);
      await repo.updateOperation(id, { ...tally, status: "done", finishedAt: new Date() });
    } catch (e) {
      // A write sent before the failure, its answer never heard, may have
      // landed: what was filed counts as changed, so it can still be undone.
      const filed = await repo.filedCount(id).catch(() => 0);
      await repo.updateOperation(id, {
        ...tally,
        changed: Math.max(tally.changed, filed),
        status: "failed",
        error: reason(e),
        finishedAt: new Date(),
      });
      console.warn(`[vetrina-ops] «${op.label}» failed: ${messageOf(e)}`);
    }
  });
}

/**
 * Queue an action's undo (already moved to "undoing"). Its progress reuses
 * the row's done/total; a failed undo puts the row back as it was, with why.
 */
export function queueUndo(id: string, previous: Pick<VetrinaOperationRow, "status" | "done" | "total">): void {
  enqueue(id, async () => {
    const op = await repo.getOperation(id);
    if (!op || op.status !== "undoing") return;
    const tally: Tally = { done: 0, total: 0, changed: op.changed, failed: op.failed };
    try {
      const ctx = await context(op, tally, (t) => repo.updateOperation(id, { done: t.done, total: t.total }));
      const outcome = await runUndo(ctx, await repo.listItems(id), op.section ?? null);
      await repo.updateOperation(id, {
        status: "undone",
        undoneAt: new Date(),
        undo: outcome,
        done: tally.total,
        total: tally.total,
        error: null,
      });
    } catch (e) {
      await repo.updateOperation(id, {
        status: previous.status,
        done: previous.done,
        total: previous.total,
        error: words().error.undoFailed(messageOf(e)),
      });
      console.warn(`[vetrina-ops] undo of «${op.label}» failed: ${messageOf(e)}`);
    }
  });
}
