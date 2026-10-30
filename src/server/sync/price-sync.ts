import "server-only";
import { advanceStoreSync, startStoreSync, type PreviewResult } from "@/server/actions/preview";
import { applySync, type ApplyChange, type ApplyOutcome } from "@/server/woo/apply";
import { skuKey } from "@/lib/skus";
import { deleteRunPlans } from "@/server/plans/repo";
import { deleteSyncRun } from "./runs";

/**
 * Plan and write the prices (and feed stock) of some products — or of the
 * whole store — with nobody reviewing the plan: the scheduler's store sync,
 * the Vetrina's "publish this product", the "use the Hub's price" of the list
 * of prices changed on WordPress.
 *
 * The same preview the Sync tab runs, then its apply with "apply all", and
 * narrower on purpose: prices and stock (and, when asked, the sizes a product
 * is missing) — never the size cleanup (it deletes variations), never
 * identifiers. The run is dropped afterwards, plans
 * and all: nobody reviews it, and left to the preview's retention its plans
 * would push the operator's own preview out of the runs it keeps.
 */

/**
 * Sizes whose price a person decided just now: the product sheet's locks set
 * or cleared (by product and EU size), the list's "use the Hub's price" (by
 * variation). The live check writes them even where the store moved since the
 * snapshot was read — that decision is the newer word.
 */
export interface DecidedPrices {
  variationIds?: number[];
  sizes?: { sku: string; euSize: string }[];
}

export interface PriceSyncOptions {
  /** Products to plan, any spelling. Omitted: the whole store. */
  skus?: string[];
  /**
   * Read each product live before writing it (see live-check.ts). Every run
   * asks for it: the unattended ones, and the one-product writes of the
   * Vetrina and the list of prices changed on WordPress.
   */
  liveCheck?: boolean;
  /** With liveCheck: sizes written even where the store moved (see DecidedPrices). */
  decided?: DecidedPrices;
  /**
   * Plan, then write nothing when more variations than this would change —
   * or, with `instalments`, write that many and leave the rest to the next run.
   */
  maxChanges?: number;
  /**
   * Over maxChanges, write that many — whole products, sizes included — and
   * leave the rest to the next run, instead of writing nothing. The
   * whole-store sync's choice: what it has to write grows between two runs,
   * and a run that refused it would make the next one larger still, so it
   * would never write again (see scheduler.ts). The feed cycle keeps the
   * refusal: a change that large in a quarter of an hour is a broken feed.
   */
  instalments?: boolean;
  /** Steps of 250 SKUs before giving up. Default: what the run needs, and some. */
  maxSteps?: number;
  /**
   * Also add the sizes a product is missing (see ApplyOptions.addSizes) —
   * "feed": the feed-owned products only, the feed cycle's choice.
   */
  addSizes?: "all" | "feed";
}

export interface PriceSyncResult {
  /** The finished run's report: totals, misses, warnings. */
  report: PreviewResult;
  /** What was written; null when nothing was to be, or when maxChanges stopped it. */
  outcome: ApplyOutcome | null;
  /** The changes planned, when there were more than maxChanges: nothing was written. */
  capped: number | null;
  /**
   * Missing sizes left for the Sync tab: adding them would have taken the run
   * past maxChanges. The prices and stock were written all the same — a big
   * catch-up of sizes (the first run after this feature, a feed that grew)
   * must never hold up the stock the store sells on.
   */
  sizesHeld: number | null;
  /** Changes left for the next run by an instalment (see `instalments`); null when none were. */
  deferred: number | null;
}

/** Throws when the run cannot be planned to the end: a half-read store is not a plan. */
export async function runPriceSync(opts: PriceSyncOptions = {}): Promise<PriceSyncResult> {
  const started = await startStoreSync(undefined, opts.skus);
  if (!started.ok || !started.progress) throw new Error(started.error ?? "the sync could not start");
  const runId = started.progress.runId;
  try {
    let progress = started.progress;
    // A step plans 250 SKUs and always moves the cursor or ends the run; the
    // bound only guards against a run that stops doing either.
    const maxSteps = opts.maxSteps ?? Math.ceil(progress.total / 100) + 10;
    for (let step = 0; !progress.done; step++) {
      if (progress.status !== "running") throw new Error(progress.error ?? `the sync was ${progress.status}`);
      if (step >= maxSteps) throw new Error("the sync did not finish");
      const next = await advanceStoreSync(runId);
      if (!next.ok || !next.progress) throw new Error(next.error ?? "a sync step failed");
      progress = next.progress;
    }
    const report = progress.result!;
    const updates = report.totals?.update ?? 0;
    // Missing sizes count as changes too (an overestimate: a sold-out size is
    // never added). Over the cap they wait for the Sync tab; the prices don't —
    // unless the run goes in instalments, which count them with their product.
    const creates = opts.addSizes ? (report.totals?.create ?? 0) : 0;
    if (updates + creates === 0) return { report, outcome: null, capped: null, sizesHeld: null, deferred: null };
    if (!opts.instalments && opts.maxChanges != null && updates > opts.maxChanges) {
      return { report, outcome: null, capped: updates, sizesHeld: null, deferred: null };
    }
    const holdSizes = !opts.instalments && opts.maxChanges != null && updates + creates > opts.maxChanges;
    const outcome = await applySync({
      runId,
      priceScope: "all",
      dryRun: false,
      sanitize: false,
      backfillGtins: false,
      liveCheck: opts.liveCheck,
      decided: decidedBy(opts.decided),
      addSizes: holdSizes ? undefined : opts.addSizes,
      maxChanges: opts.instalments ? opts.maxChanges : undefined,
    });
    return {
      report,
      outcome,
      capped: null,
      sizesHeld: holdSizes ? creates : null,
      deferred: outcome.deferred > 0 ? outcome.deferred : null,
    };
  } finally {
    await deleteRunPlans(runId)
      .then(() => deleteSyncRun(runId))
      .catch((e) => console.warn(`[sync] run ${runId} kept: ${e instanceof Error ? e.message : String(e)}`));
  }
}

/** The apply's test for a decided size; undefined when none was. */
export function decidedBy(decided?: DecidedPrices): ((change: ApplyChange) => boolean) | undefined {
  const ids = new Set(decided?.variationIds ?? []);
  const sizes = new Set((decided?.sizes ?? []).map((s) => `${skuKey(s.sku)}::${s.euSize}`));
  if (ids.size === 0 && sizes.size === 0) return undefined;
  return (c) => ids.has(c.storeVariationId) || (c.euSize != null && sizes.has(`${skuKey(c.sku)}::${c.euSize}`));
}
