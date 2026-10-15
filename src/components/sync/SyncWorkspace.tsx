"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PlanItem } from "@core/core-spine";
import {
  advanceStoreSync,
  cancelStoreSync,
  startStoreSync,
  type FetchStats,
  type PreviewResult,
  type StoreSyncProgress,
} from "@/server/actions/preview";
import {
  advanceStorePull,
  applySyncPrices,
  cancelStorePull,
  getSyncApplyJob,
  getSyncState,
  startStorePull,
  startSyncApply,
  type ApplyJobResult,
  type SyncPageState,
} from "@/server/actions/sync";
import { setProductSaleRule, setVariationManualPrice } from "@/server/actions/overrides";
import type { PullProgress } from "@/server/woo/pull";
import type { ApplyOutcome, ApplyHistoryEntry } from "@/server/woo/apply";
import type { ApplyJob } from "@/server/sync/apply-job";
import type { SnapshotInfo } from "@/server/store-json/repo";
import type { PricingSummary } from "@/server/config/summary";
import type { PreviewPlan } from "@/lib/plan";
import { emptySummary, isActionable, type PlanSummary } from "@/lib/plan";
import { PREVIEW_PAGE_LIMIT, PreviewPage } from "@/lib/preview-page";
import { useI18n } from "@/i18n/provider";
import { useShopTime } from "@/components/use-shop-time";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PricingBar } from "@/components/pricing/PricingBar";
import { ProductGroup } from "@/components/preview/ProductGroup";
import { NotFoundCard } from "@/components/preview/NotFoundCard";
import { RebuildPanel } from "./RebuildPanel";
import { StoreEditsPanel } from "./StoreEditsPanel";

const selKey = (planId: string, variantId: string) => `${planId}:${variantId}`;

const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

/** Stable signature of the current selection — a dry run is only valid for it. */
function selectionSignature(selections: { planId: string; variantIds: string[] }[]): string {
  return selections
    .map((s) => `${s.planId}:${[...s.variantIds].sort().join(",")}`)
    .sort()
    .join("|");
}

/**
 * Product pages one click will walk — 20 per page, so 100 000 products, the
 * same backstop the scheduled pull uses. A run is resumable (the cursor lives
 * on the row), so reaching this is "press it again", not "it broke".
 */
const MAX_PULL_STEPS = 5000;

/**
 * Sync steps one click will walk — 250 SKUs a step, so 1 250 000 SKUs. A
 * runaway backstop, like the pull's: a store never gets near it.
 */
const MAX_SYNC_STEPS = 5000;

/** How often the tab asks how the live apply is going. */
const APPLY_POLL_MS = 2000;
/**
 * Questions in a row the server may leave unanswered (a proxy hiccup, a
 * deploy) before the tab stops following — the apply goes on regardless.
 */
const APPLY_POLL_MISSES = 15;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function SyncWorkspace({
  defaultMarket,
  snapshotInfo,
  initialState,
  seedSkus,
  pricing,
  initialFollowSaleRule,
}: {
  defaultMarket: string;
  snapshotInfo: SnapshotInfo | null;
  initialState: SyncPageState;
  seedSkus: string[];
  pricing: PricingSummary;
  initialFollowSaleRule: boolean;
}) {
  const { t } = useI18n();
  const when = useShopTime(initialState.timeZone);
  const router = useRouter();

  // ----- pull -----
  const [pulling, setPulling] = React.useState(false);
  const [pullProgress, setPullProgress] = React.useState<PullProgress | null>(
    initialState.runningPull,
  );
  const [pullError, setPullError] = React.useState<string | null>(null);
  const cancelRef = React.useRef(false);

  // ----- preview -----
  const [transitionPending, startTransition] = React.useTransition();
  // The store sync is walked in steps (one server action each) — see runSync.
  const [syncing, setSyncing] = React.useState(false);
  const [syncProgress, setSyncProgress] = React.useState<StoreSyncProgress | null>(null);
  const syncCancelRef = React.useRef(false);
  const pending = transitionPending || syncing;
  const [error, setError] = React.useState<string | null>(null);
  // A source was degraded but the run still produced real plans (e.g. KicksDB
  // down or absent while the feed-owned products came through).
  const [warning, setWarning] = React.useState<string | null>(null);
  // `plans` is the PAGE of the run the server sent, not the run. A whole-store
  // preview is one plan per product and the store has no ceiling — holding all
  // of them here is what took the server past its heap building the response.
  const [plans, setPlans] = React.useState<PreviewPlan[]>([]);
  const [runId, setRunId] = React.useState<string | null>(null);
  const [runTotals, setRunTotals] = React.useState<PlanSummary>(emptySummary());
  const [runProducts, setRunProducts] = React.useState(0);
  const [stats, setStats] = React.useState<FetchStats | null>(null);
  /**
   * The price selection, expressed against the RUN:
   *  - "all": every actionable row of the run except `excluded` — the posture a
   *    preview starts in, and the only one that reaches rows past the page;
   *  - "listed": only what is in `selected`, for a hand-picked apply.
   */
  const [priceScope, setPriceScope] = React.useState<"all" | "listed">("all");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = React.useState(false);
  const [scope, setScope] = React.useState<string[] | undefined>(
    seedSkus.length > 0 ? seedSkus : undefined,
  );

  // ----- apply -----
  const [history, setHistory] = React.useState<ApplyHistoryEntry[]>(initialState.history);
  const [dry, setDry] = React.useState<{ outcome: ApplyOutcome; signature: string } | null>(null);
  const [applied, setApplied] = React.useState<ApplyOutcome | null>(null);
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const [applying, setApplying] = React.useState<"dry" | "live" | null>(
    initialState.runningApply ? "live" : null,
  );
  // The live apply runs on the server, in the background (startSyncApply): the
  // job as last read while the tab follows it, and how following it ended.
  const [liveJob, setLiveJob] = React.useState<ApplyJob | null>(initialState.runningApply);
  const [liveError, setLiveError] = React.useState<string | null>(null);
  const mountedRef = React.useRef(true);
  // Align sizes (delete orphan/duplicate variations, realign pa_taglia) before
  // pricing — the standardization pass. Default on.
  const [sanitize, setSanitize] = React.useState(true);
  // Fill empty GTINs from the source across the whole preview. Default on: an
  // external catalog matches offers on the identifier, and a correctly-priced
  // row is a noop that can never be ticked for a price change.
  const [backfillGtins, setBackfillGtins] = React.useState(true);
  // Guided one-click sync: pull (if stale) → preview → dry run, then stop at
  // the single Apply confirmation. State machine driven by the effect below.
  const [guided, setGuided] = React.useState(false);

  const hasSnapshot = !!snapshotInfo;

  /** Drive a pull to completion by looping the advance action. */
  async function runPull(existingRunId?: string) {
    setPullError(null);
    setPulling(true);
    cancelRef.current = false;
    try {
      let runId = existingRunId;
      if (!runId) {
        const started = await startStorePull();
        if (!started.ok || !started.progress) {
          setPullError(started.error ?? t.sync.pull.failed);
          return;
        }
        runId = started.progress.runId;
        setPullProgress(started.progress);
        if (started.progress.done) return;
      }
      // Bounded like the scheduled pull (runFullPull's maxSteps): one step is
      // one product page, so this is 20 000 products. An unbounded loop here
      // means the browser keeps firing server actions for as long as the store
      // declines to say "done" — which is not a state the browser can fix.
      for (let step = 0; step < MAX_PULL_STEPS; step++) {
        if (cancelRef.current) {
          await cancelStorePull({ runId });
          setPullProgress(null);
          return;
        }
        const res = await advanceStorePull({ runId, pages: 1 });
        if (!res.ok || !res.progress) {
          setPullError(res.error ?? t.sync.pull.failed);
          return;
        }
        setPullProgress(res.progress);
        if (res.progress.status === "failed") {
          setPullError(res.progress.error ?? t.sync.pull.failed);
          return;
        }
        if (res.progress.done) {
          // Snapshot replaced — reload server props (count/source/age) and re-preview.
          router.refresh();
          loadPreview(scope);
          return;
        }
      }
      // The ceiling, not an error: everything fetched so far is staged and the
      // next run continues from it. Saying "failed" here would send the
      // operator hunting a fault that is not there.
      setPullError(t.sync.pull.ceiling);
    } finally {
      setPulling(false);
    }
  }

  /**
   * Apply a preview result to state. A run starts fully selected — every
   * actionable row, including the ones past the page — which is what
   * pre-selecting every plan used to mean back when every plan was sent.
   */
  function applyResult(res: PreviewResult) {
    setWarning(res.warning ?? null);
    if (!res.ok) {
      setError(res.error ?? "Unknown error");
      setPlans([]);
      setRunId(null);
      setRunTotals(emptySummary());
      setRunProducts(0);
      setStats(null);
      setSelected(new Set());
      setExcluded(new Set());
      return;
    }
    const next = new Set<string>();
    for (const p of res.plans) {
      for (const item of p.plan.items) {
        if (isActionable(item.action)) next.add(selKey(p.planId, item.stockxVariantId));
      }
    }
    setError(null);
    setStats(res.stats ?? null);
    setPlans(res.plans);
    setRunId(res.runId ?? null);
    setRunTotals(res.totals ?? emptySummary());
    setRunProducts(res.products ?? res.plans.length);
    setPriceScope("all");
    setSelected(next);
    setExcluded(new Set());
    setAllOpen(res.plans.length <= 3);
    setDry(null);
  }

  /**
   * Walk the store one step at a time: start a sync run, advance it until the
   * server says done, keeping the run's best page here as the steps come in.
   * The report — and the run id the apply needs — arrive only with the LAST
   * step, so a sync that stops half-way can never be applied as if it were a
   * reading of the whole store.
   */
  async function runSync(skus?: string[]) {
    setError(null);
    setSyncing(true);
    syncCancelRef.current = false;
    // The previous run is superseded the moment a new one starts. The last
    // apply's result stays: the re-preview right after it must not wipe it.
    setRunId(null);
    setDry(null);
    const fail = (message: string) => applyResult({ ok: false, error: message, plans: [] });
    try {
      const started = await startStoreSync(defaultMarket, skus);
      if (!started.ok || !started.progress) return fail(started.error ?? t.sync.preview.failed);
      const runId = started.progress.runId;
      setSyncProgress(started.progress);
      const page = new PreviewPage<PreviewPlan>(PREVIEW_PAGE_LIMIT);
      for (let step = 0; step < MAX_SYNC_STEPS; step++) {
        if (syncCancelRef.current) {
          await cancelStoreSync(runId);
          fail(""); // clear the half-walked run…
          setError(null); // …without calling a deliberate stop an error
          return;
        }
        const res = await advanceStoreSync(runId);
        if (!res.ok || !res.progress) return fail(res.error ?? t.sync.preview.failed);
        page.add(res.progress.plans);
        setSyncProgress(res.progress);
        if (res.progress.status === "failed" || res.progress.status === "cancelled") {
          return fail(res.progress.error ?? t.sync.preview.failed);
        }
        if (res.progress.done && res.progress.result) {
          return applyResult({ ...res.progress.result, plans: page.take() });
        }
      }
      fail(t.sync.preview.ceiling);
    } catch (e) {
      fail(e instanceof Error ? e.message : t.sync.preview.failed);
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }

  function loadPreview(skus?: string[]) {
    void runSync(skus);
  }

  /**
   * One click, whole flow: refresh the store state when it's old, compute the
   * per-owner diff (each product from ITS source's local cache), run the dry
   * run — then wait for the one Apply confirmation. Nothing is written before
   * that confirmation.
   */
  const SNAPSHOT_FRESH_MS = 60 * 60 * 1000; // re-pull when older than an hour
  function runGuidedSync() {
    if (pulling || pending || applying) return;
    setGuided(true);
    setScope(undefined);
    const age = snapshotInfo ? Date.now() - new Date(snapshotInfo.uploadedAt).getTime() : Infinity;
    if (!hasSnapshot || age > SNAPSHOT_FRESH_MS) {
      void runPull(pullProgress?.status === "running" ? pullProgress.runId : undefined);
      // runPull chains loadPreview() on completion; the effect takes over after.
    } else {
      loadPreview();
    }
  }

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A live apply already writing when the page loaded — started before a
  // reload, or from another tab: follow it to the end.
  const resumedOnce = React.useRef(false);
  React.useEffect(() => {
    if (resumedOnce.current || !initialState.runningApply) return;
    resumedOnce.current = true;
    void watchApply(initialState.runningApply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A drawer "Sync to Woo" link seeds ?skus= — auto-preview that subset once.
  const seededOnce = React.useRef(false);
  React.useEffect(() => {
    if (seededOnce.current) return;
    seededOnce.current = true;
    if (seedSkus.length > 0 && hasSnapshot) loadPreview(seedSkus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function rerun() {
    loadPreview(scope);
  }

  function onSetSaleRule(sku: string, follow: boolean) {
    startTransition(async () => {
      const res = await setProductSaleRule({ sku, followSaleRule: follow });
      if (!res.ok) setError(res.error ?? t.drawer.saveFailed);
      else rerun();
    });
  }

  function onSetManualPrice(sku: string, euSize: string, price: number | null) {
    startTransition(async () => {
      const res = await setVariationManualPrice({ parentSku: sku, euSize, price });
      if (!res.ok) setError(res.error ?? t.drawer.saveFailed);
      else rerun();
    });
  }

  /**
   * Tick / untick one row.
   *
   * Two books are kept because the run is bigger than the page: `selected` is
   * what the visible rows show, `excluded` is what the server is told to leave
   * out of the run. Unticking a row it never sent is impossible, which is
   * exactly right — it was never shown either.
   */
  function toggle(planId: string, variantId: string, checked: boolean) {
    const k = selKey(planId, variantId);
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(k);
      else next.delete(k);
      return next;
    });
    setExcluded((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function toggleAll(p: PreviewPlan, checked: boolean) {
    const keys = p.plan.items
      .filter((i) => isActionable(i.action))
      .map((i) => selKey(p.planId, i.stockxVariantId));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (checked) next.add(k);
        else next.delete(k);
      }
      return next;
    });
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (checked) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  /** "All updates": back to the whole run, nothing held out. */
  function selectAllUpdates() {
    const next = new Set<string>();
    for (const p of plans) {
      for (const item of p.plan.items) {
        if (item.action === "update") next.add(selKey(p.planId, item.stockxVariantId));
      }
    }
    setPriceScope("all");
    setSelected(next);
    setExcluded(new Set());
  }

  /** "None": write no prices at all (cleanup and identifiers can still run). */
  function selectNone() {
    setPriceScope("listed");
    setSelected(new Set());
    setExcluded(new Set());
  }

  /** Counts over the WHOLE run — the page is only what is on screen. */
  const totals = runTotals;
  const shown = plans.length;
  const hidden = Math.max(0, runProducts - shown);

  /**
   * Rows on this page the operator has held out of the run: price updates, and
   * sizes the store product is missing ("create" rows — the apply adds them).
   */
  const excludedUpdates = React.useMemo(() => {
    let n = 0;
    for (const p of plans) {
      for (const i of p.plan.items) {
        if (isActionable(i.action) && excluded.has(selKey(p.planId, i.stockxVariantId))) n += 1;
      }
    }
    return n;
  }, [plans, excluded]);

  /** Rows the operator picked by hand — only meaningful in "listed" scope. */
  const listedSelections = React.useMemo(
    () =>
      plans
        .map((p) => ({
          planId: p.planId,
          variantIds: p.plan.items
            .filter((i) => isActionable(i.action) && selected.has(selKey(p.planId, i.stockxVariantId)))
            .map((i) => i.stockxVariantId),
        }))
        .filter((sel) => sel.variantIds.length > 0),
    [plans, selected],
  );

  /** Rows held out — only meaningful in "all" scope. */
  const excludedSelections = React.useMemo(
    () =>
      plans
        .map((p) => ({
          planId: p.planId,
          variantIds: p.plan.items
            .filter((i) => excluded.has(selKey(p.planId, i.stockxVariantId)))
            .map((i) => i.stockxVariantId),
        }))
        .filter((sel) => sel.variantIds.length > 0),
    [plans, excluded],
  );

  const applyCount =
    priceScope === "all"
      ? Math.max(0, totals.update + totals.create - excludedUpdates)
      : listedSelections.reduce((n, sel) => n + sel.variantIds.length, 0);

  // A dry run is only valid for the exact same work: run + scope + what was
  // held out of it. The run id stands in for the plan list it used to name —
  // a new preview is a new run, so a stale dry run can never look current.
  const signature = `${sanitize ? "s" : "-"}${backfillGtins ? "g" : "-"}|${runId ?? ""}|${priceScope}|${selectionSignature(priceScope === "all" ? excludedSelections : listedSelections)}`;
  const dryValid = dry != null && dry.signature === signature;
  const canRun = runId != null && runProducts > 0 && (applyCount > 0 || sanitize);
  const dryHasWork =
    dryValid && dry != null && (dry.outcome.variations > 0 || (dry.outcome.cleanup?.deletions ?? 0) > 0 || (dry.outcome.cleanup?.taglieRealigned ?? 0) > 0 || (dry.outcome.cleanup?.stockSynthesized ?? 0) > 0 || (dry.outcome.cleanup?.parentsRealigned ?? 0) > 0 || (dry.outcome.sizes?.planned ?? 0) > 0);

  // Guided step 3: once the preview is in and idle, fire the dry run exactly once.
  React.useEffect(() => {
    if (!guided) return;
    if (pulling || pending || applying != null) return;
    if (error || applyError || pullError) {
      setGuided(false); // something broke — surface it, stop driving
      return;
    }
    if (plans.length === 0) return; // still waiting for the preview
    if (dryValid) {
      setGuided(false); // dry run done — the Apply button is the only step left
      return;
    }
    if (canRun) runDry();
    else setGuided(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guided, pulling, pending, applying, plans, dryValid, error, applyError, pullError]);

  async function refreshHistory() {
    try {
      const state = await getSyncState();
      setHistory(state.history);
    } catch {
      // The list catches up on the next refresh.
    }
  }

  function runDry() {
    if (!canRun) return;
    setApplyError(null);
    setApplied(null);
    setLiveError(null);
    setApplying("dry");
    void (async () => {
      try {
        const res = await applySyncPrices({
          runId: runId!,
          priceScope,
          selections: priceScope === "listed" ? listedSelections : [],
          excluded: priceScope === "all" ? excludedSelections : [],
          dryRun: true,
          sanitize,
          backfillGtins,
        });
        if (!res.ok || !res.outcome) setApplyError(res.error ?? t.sync.apply.failed);
        else setDry({ outcome: res.outcome, signature });
        await refreshHistory();
      } catch {
        // No answer at all (a proxy timeout): without this the button just
        // came back, as if nothing had been asked.
        setApplyError(t.sync.apply.noAnswer);
      } finally {
        setApplying(null);
      }
    })();
  }

  /**
   * The live apply: started on the server, where it runs in the background
   * however long it takes, then followed from here (see watchApply). One
   * request for the whole apply was cut by Cloudflare after 100 seconds, and
   * the tab took the cut for the end of it.
   */
  function runApply() {
    if (!dryValid || !canRun) return;
    setApplyError(null);
    setLiveError(null);
    setApplied(null);
    setApplying("live");
    void (async () => {
      let job: ApplyJob | null = null;
      try {
        const res = await startSyncApply({
          runId: runId!,
          priceScope,
          selections: priceScope === "listed" ? listedSelections : [],
          excluded: priceScope === "all" ? excludedSelections : [],
          sanitize,
          backfillGtins,
        });
        if (!res.ok || !res.job) setApplyError(res.error ?? t.sync.apply.failed);
        else job = res.job;
      } catch {
        setApplyError(t.sync.apply.noAnswer);
      }
      if (job) await watchApply(job, true);
      else setApplying(null);
    })();
  }

  /**
   * Follow a live apply to its end, then show what it did — and, when it
   * applied the preview on screen, preview again: the snapshot was patched
   * server-side, so applied rows go noop and deleted orphans disappear.
   */
  async function watchApply(job: ApplyJob, previewAfter = false) {
    setApplying("live");
    setLiveJob(job);
    try {
      const outcome = await followApply(job.id);
      if (outcome) {
        setApplied(outcome);
        setDry(null);
        if (previewAfter && mountedRef.current) rerun();
      }
    } finally {
      setApplying(null);
      setLiveJob(null);
      await refreshHistory();
    }
  }

  /**
   * Ask the server how the apply is going until it ends: its outcome, or null
   * when it failed or the tab lost track of it (liveError says which).
   */
  async function followApply(jobId: string): Promise<ApplyOutcome | null> {
    let misses = 0;
    while (mountedRef.current) {
      await sleep(APPLY_POLL_MS);
      let res: ApplyJobResult;
      try {
        res = await getSyncApplyJob({ id: jobId });
      } catch {
        res = { ok: false };
      }
      if (!res.ok) {
        if (++misses < APPLY_POLL_MISSES) continue;
        setLiveError(t.sync.apply.lostContact);
        return null;
      }
      misses = 0;
      const job = res.job;
      if (!job) {
        setLiveError(t.sync.apply.lost);
        return null;
      }
      setLiveJob(job);
      if (job.status === "done") return job.outcome;
      if (job.status === "failed") {
        setLiveError(job.error ?? t.sync.apply.failed);
        return null;
      }
    }
    return null;
  }

  const snapshotAge = snapshotInfo
    ? Math.floor((Date.now() - new Date(snapshotInfo.uploadedAt).getTime()) / 86_400_000)
    : null;

  /** The live apply: how far it is while it writes, then how it ended. */
  const liveStatus =
    applying === "live" ? (
      <div className="space-y-1.5" role="status">
        <div className="flex items-center gap-2 text-sm font-medium tnum">
          <span className="spin h-4 w-4 rounded-full border-2 border-accent/30 border-t-accent" />
          {liveJob?.total != null ? t.sync.apply.writing(liveJob.done, liveJob.total) : t.sync.apply.preparing}
        </div>
        {liveJob?.total ? (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.min(100, Math.round((liveJob.done / liveJob.total) * 100))}%` }}
            />
          </div>
        ) : null}
        <p className="text-xs text-muted">{t.sync.apply.writingHint}</p>
      </div>
    ) : applied || liveError ? (
      <div className="space-y-0.5 text-sm font-medium">
        {applied && (
          <>
            <p className={applied.status === "applied" ? "text-up" : "text-skip"}>
              {applied.status === "applied"
                ? t.sync.apply.applied(applied.updated)
                : t.sync.apply.partial(applied.updated, applied.failedTotal)}
            </p>
            {applied.sizes.added > 0 && (
              <p className="text-xs font-medium text-up">{t.sync.apply.sizesAdded(applied.sizes.added)}</p>
            )}
            {applied.keptStoreEdits > 0 && (
              <p className="text-xs font-medium text-skip">{t.sync.apply.keptChanged(applied.keptStoreEdits)}</p>
            )}
            {applied.keptOnSale > 0 && (
              <p className="text-xs font-normal text-muted">{t.sync.apply.keptOnSale(applied.keptOnSale)}</p>
            )}
            {applied.cleanup && applied.cleanup.products > 0 && (
              <p className="text-xs font-normal text-muted tnum">
                {t.sync.apply.cleanupApplied(
                  applied.cleanup.deletions,
                  applied.cleanup.taglieRealigned,
                  applied.cleanup.parentsRealigned,
                )}
              </p>
            )}
          </>
        )}
        {liveError && <p className="text-skip">{liveError}</p>}
      </div>
    ) : null;

  return (
    <div className="space-y-5">
      {initialState.siteMismatch && (
        <p role="alert" className="rounded-lg border border-skip/25 bg-skip/10 px-4 py-3 text-sm font-medium text-skip">
          {t.sync.scope.siteMismatch(initialState.siteMismatch.snapshot, initialState.siteMismatch.connected)}
        </p>
      )}

      {/* Prices changed on WordPress: kept by every sync until a person decides */}
      <StoreEditsPanel
        initial={initialState.storeEdits}
        siteUrl={snapshotInfo?.siteUrl ?? ""}
        timeZone={initialState.timeZone}
        refreshKey={runId}
        disabled={!initialState.wooConfigured || pulling || pending || applying != null}
        onResolved={() => {
          void refreshHistory();
          if (plans.length > 0) rerun();
        }}
      />

      {/* One-click sync: per-owner lookup, one summary, one confirmation */}
      <div className="relative flex flex-wrap items-center gap-4 overflow-hidden rounded-xl border border-accent/40 bg-accent/5 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">{t.sync.oneClick.title}</div>
          <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-muted">
            {t.sync.oneClick.hint}
          </p>
        </div>
        <Button
          type="button"
          variant="accent"
          className="h-11 px-6 text-sm font-bold"
          onClick={runGuidedSync}
          disabled={!initialState.wooConfigured || pulling || pending || applying != null}
        >
          {guided || pulling || pending ? (
            <>
              <span className="spin h-4 w-4 rounded-full border-2 border-accent-fg/30 border-t-accent-fg" />
              {pulling
                ? t.sync.pull.pulling
                : pending
                  ? syncProgress
                    ? t.sync.preview.progress(syncProgress.cursor, syncProgress.total)
                    : t.sync.preview.loading
                  : t.sync.apply.dryRunning}
            </>
          ) : (
            t.sync.oneClick.button
          )}
        </Button>
        {dryValid && !guided && (
          <p className="w-full text-xs font-medium text-up">{t.sync.oneClick.ready}</p>
        )}
      </div>

      {/* Pricing rule + store-wide discount switch — changes recompute the plan */}
      <PricingBar
        initial={pricing}
        initialFollowSaleRule={initialFollowSaleRule}
        busy={pending || pulling}
        onChanged={() => {
          if (plans.length > 0) rerun();
        }}
      />

      {/* Store state / pull bar */}
      <div className="relative flex flex-wrap items-center gap-3 overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-xs">
        <span className="absolute inset-y-0 left-0 w-1 bg-accent" />
        <div className="min-w-0 text-sm">
          <div className="font-semibold">{t.sync.pull.title}</div>
          {snapshotInfo ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <span className="tnum">
                {t.sync.pull.info(
                  snapshotInfo.productCount,
                  when.dateTime(snapshotInfo.uploadedAt),
                )}
              </span>
              <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-medium">
                {snapshotInfo.source === "rest" ? t.sync.pull.sourceRest : t.sync.pull.sourceUpload}
              </span>
              {snapshotAge != null && snapshotAge >= 7 && (
                <span className="font-medium text-warn">{t.storeBar.stale(snapshotAge)}</span>
              )}
            </div>
          ) : (
            <div className="mt-0.5 text-xs text-muted">{t.sync.pull.none}</div>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {pulling || pullProgress?.status === "running" ? (
            <>
              <span className="flex items-center gap-2 text-xs text-muted tnum">
                <span className="spin h-4 w-4 rounded-full border-2 border-accent/30 border-t-accent" />
                {pullProgress
                  ? t.sync.pull.progress(pullProgress.productsFetched, pullProgress.totalProducts)
                  : t.sync.pull.pulling}
              </span>
              {pulling ? (
                <Button type="button" variant="outline" size="sm" onClick={() => (cancelRef.current = true)}>
                  {t.sync.pull.cancel}
                </Button>
              ) : (
                <Button type="button" variant="accent" size="sm" onClick={() => runPull(pullProgress!.runId)}>
                  {t.sync.pull.resume}
                </Button>
              )}
            </>
          ) : (
            <Button
              type="button"
              variant="accent"
              onClick={() => runPull()}
              disabled={!initialState.wooConfigured}
            >
              {t.sync.pull.button}
            </Button>
          )}
          {hasSnapshot && (
            <Button type="button" variant="outline" onClick={() => { setScope(undefined); loadPreview(); }} disabled={pending || pulling}>
              {pending
                ? syncProgress
                  ? t.sync.preview.progress(syncProgress.cursor, syncProgress.total)
                  : t.sync.preview.loading
                : plans.length > 0
                  ? t.sync.preview.refresh
                  : t.sync.preview.button}
            </Button>
          )}
          {syncing && (
            <Button type="button" variant="ghost" size="sm" onClick={() => { syncCancelRef.current = true; }}>
              {t.sync.preview.cancel}
            </Button>
          )}
        </div>

        {/* progress track */}
        {(pulling || pullProgress?.status === "running") && pullProgress?.totalProducts ? (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{
                width: `${Math.min(100, Math.round((pullProgress.productsFetched / pullProgress.totalProducts) * 100))}%`,
              }}
            />
          </div>
        ) : null}
      </div>

      {!initialState.wooConfigured && (
        <p className="rounded-lg border border-warn/25 bg-warn/10 px-4 py-3 text-sm text-warn">
          {t.sync.notConfigured}
        </p>
      )}

      {pullError && (
        <p className="rounded-lg border border-skip/25 bg-skip/10 px-4 py-3 text-sm text-skip">
          {pullError}
        </p>
      )}

      {/* No preview on screen (a reload while the apply writes): its own card */}
      {runProducts === 0 && liveStatus && (
        <div className="rounded-xl border border-line bg-surface p-4 shadow-xs animate-fade-up">{liveStatus}</div>
      )}

      {scope && scope.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="rounded-full bg-accent/12 px-2.5 py-1 font-semibold text-accent-text tnum">
            {t.sync.preview.seeded(scope.length)}
          </span>
          <button
            type="button"
            className="font-medium underline-offset-2 hover:text-ink hover:underline"
            onClick={() => {
              setScope(undefined);
              loadPreview();
            }}
          >
            {t.sync.preview.clearSeed}
          </button>
        </div>
      )}

      {!hasSnapshot && (
        <p className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-muted">
          {t.sync.preview.needSnapshot}
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-skip/25 bg-skip/10 px-4 py-3 text-sm text-skip animate-fade-up">
          {error}
        </p>
      )}

      {warning && (
        <p className="rounded-lg border border-warn/25 bg-warn/10 px-4 py-3 text-sm text-warn animate-fade-up">
          {warning}
        </p>
      )}

      {/* The sync's scope is the store, not the catalog: without this line an
          almost-empty store looks like a broken sync. */}
      {initialState.unpublished > 0 && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-4 py-3 text-xs text-muted">
          {t.sync.scope.unpublished(initialState.unpublished)}
          <Link
            href="/publish"
            className="font-semibold text-accent-text underline-offset-2 hover:underline"
          >
            {t.sync.scope.publishLink} →
          </Link>
        </p>
      )}

      {(stats?.delisted ?? 0) > 0 && (
        <p className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-xs text-muted">
          {t.sync.scope.delisted(stats!.delisted!)}
        </p>
      )}

      {(stats?.unanswered ?? 0) > 0 && (
        <p className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-xs text-muted">
          {t.sync.scope.unanswered(stats!.unanswered!)}
        </p>
      )}

      {stats?.notFound && stats.notFound.length > 0 && (
        <NotFoundCard
          foundSkus={plans.map((p) => p.sku)}
          notFound={stats.notFound}
          foundTotal={runProducts}
          missingTotal={stats.notFoundTotal ?? stats.notFound.length}
        />
      )}

      {runProducts > 0 && (
        <div className="space-y-3">
          {/* Summary + quick select */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-xs">
            <span className="font-semibold tnum">{t.results.products(runProducts)}</span>
            <span className="text-line-strong">·</span>
            <Badge variant="update">{t.results.update(totals.update)}</Badge>
            <Badge variant="create">{t.results.create(totals.create)}</Badge>
            <Badge variant="skip">{t.results.skip(totals.skip)}</Badge>
            <Badge variant="noop">{t.results.noop(totals.noop)}</Badge>
            <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-accent/12 px-2.5 py-0.5 text-xs font-semibold text-accent-text tnum">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {t.results.selected(applyCount)}
            </span>
            <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setAllOpen((o) => !o)}>
              {allOpen ? t.results.collapseAll : t.results.expandAll}
            </Button>
          </div>

          {hidden > 0 && (
            <p className="rounded-lg border border-line bg-surface-2 px-4 py-2 text-xs text-muted tnum">
              {t.results.shownOf(shown, runProducts)}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1.5 px-1 text-sm">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-faint">
              {t.results.quickSelect}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={selectAllUpdates}>
              {t.results.updates(totals.update)}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={selectNone}>
              {t.results.none}
            </Button>
          </div>

          <div className="space-y-3 stagger">
            {plans.map((p) => (
              <ProductGroup
                key={`${p.planId}-${allOpen}`}
                plan={p.plan}
                title={p.title}
                brand={p.brand}
                euSizes={p.euSizes}
                highlighted={false}
                defaultOpen={allOpen}
                selected={
                  new Set(
                    p.plan.items
                      .filter((i) => selected.has(selKey(p.planId, i.stockxVariantId)))
                      .map((i) => i.stockxVariantId),
                  )
                }
                onToggle={(variantId, checked) => toggle(p.planId, variantId, checked)}
                onToggleAll={(checked) => toggleAll(p, checked)}
                followSaleRule={p.followSaleRule}
                manualPrices={p.manualPrices}
                busy={pending}
                onSetSaleRule={(follow) => onSetSaleRule(p.sku, follow)}
                onSetManualPrice={(_variantId, euSize, price) => onSetManualPrice(p.sku, euSize, price)}
              />
            ))}
          </div>

          {/* Apply bar — cleanup + prices; dry-run first, live apply unlocked by a matching dry run */}
          <div className="sticky bottom-[calc(var(--dock-clearance,0px)+0.75rem)] z-20 rounded-xl border border-line bg-surface/95 p-4 shadow-lg backdrop-blur-md">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm">
                <span className="font-semibold tnum">{t.sync.apply.ready(applyCount)}</span>
              </div>
              <label
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted"
                title={t.sync.apply.cleanupHint}
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-current"
                  checked={sanitize}
                  disabled={applying != null}
                  onChange={(e) => setSanitize(e.target.checked)}
                />
                {t.sync.apply.cleanup}
              </label>
              <label
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted"
                title={t.sync.apply.gtinsHint}
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-current"
                  checked={backfillGtins}
                  disabled={applying != null}
                  onChange={(e) => setBackfillGtins(e.target.checked)}
                />
                {t.sync.apply.gtins}
              </label>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={runDry}
                  disabled={!canRun || applying != null}
                >
                  {applying === "dry" ? t.sync.apply.dryRunning : t.sync.apply.dryRun}
                </Button>
                <Button
                  type="button"
                  variant="accent"
                  onClick={runApply}
                  disabled={!dryHasWork || applying != null}
                  title={dryValid ? undefined : t.sync.apply.needDryRun}
                >
                  {applying === "live"
                    ? t.sync.apply.applying
                    : applyCount > 0
                      ? t.sync.apply.apply(applyCount)
                      : t.sync.apply.applyCleanupOnly}
                </Button>
              </div>
            </div>

            {liveStatus && <div className="mt-2">{liveStatus}</div>}
            {applyError && <p className="mt-2 text-sm text-skip">{applyError}</p>}

            {dryValid && dry && (
              <div className="mt-3 space-y-2 border-t border-line pt-3 text-xs animate-fade-up">
                {/* Cleanup: what standardization would do, before any pricing */}
                {dry.outcome.cleanup && (
                  <div className="space-y-1">
                    <div className="font-semibold">
                      {t.sync.apply.cleanupTitle(dry.outcome.cleanup.products)}
                    </div>
                    {dry.outcome.cleanup.products === 0 ? (
                      <div className="text-faint">{t.sync.apply.cleanupNone}</div>
                    ) : (
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted tnum">
                        <span className="font-medium text-skip">
                          {t.sync.apply.deletions(dry.outcome.cleanup.deletions)}
                        </span>
                        {dry.outcome.cleanup.feedTrimmed > 0 && (
                          <span className="font-medium text-warn">
                            {t.sync.apply.feedTrimmed(dry.outcome.cleanup.feedTrimmed)}
                          </span>
                        )}
                        <span>{t.sanitize.ghostsRemoved(dry.outcome.cleanup.ghostsRemoved)}</span>
                        <span>{t.sanitize.duplicatesRemoved(dry.outcome.cleanup.duplicatesRemoved)}</span>
                        <span>{t.sanitize.stockSynthesized(dry.outcome.cleanup.stockSynthesized)}</span>
                        <span>{t.sanitize.taglieRealigned(dry.outcome.cleanup.taglieRealigned)}</span>
                        <span>{t.sanitize.parentsRealigned(dry.outcome.cleanup.parentsRealigned)}</span>
                      </div>
                    )}
                    {dry.outcome.cleanupDetailsTotal > 0 && (
                      <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                        {dry.outcome.cleanupDetails.slice(0, 8).map((d) => (
                          <li key={d.storeProductId} className="flex items-center gap-2 tnum">
                            <span className="font-mono text-faint">{d.sku}</span>
                            <span className="ml-auto text-muted">
                              {t.sync.apply.cleanupLine(d.deletions, d.rewrites)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {dry.outcome.cleanupDetailsTotal > 8 && (
                      <div className="text-faint">
                        {t.sync.apply.dryMore(dry.outcome.cleanupDetailsTotal - 8)}
                      </div>
                    )}
                    {dry.outcome.droppedByCleanup > 0 && (
                      <div className="text-faint">
                        {t.sync.apply.droppedByCleanup(dry.outcome.droppedByCleanup)}
                      </div>
                    )}
                  </div>
                )}

                {dry.outcome.sizes.planned > 0 && (
                  <div className="space-y-1">
                    <div className="font-semibold text-up">{t.sync.apply.sizesTitle(dry.outcome.sizes.planned)}</div>
                    <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                      {dry.outcome.sizes.sample.slice(0, 12).map((n) => (
                        <li key={`${n.storeProductId}:${n.sizeLabel}`} className="flex items-center gap-2 tnum">
                          <span className="font-mono text-faint">{n.sku}</span>
                          <span>{n.sizeLabel}</span>
                          <span className="ml-auto text-muted">
                            {n.price != null ? eur.format(n.price) : "—"}
                            {n.stock != null && <span className="text-warn"> · {t.sync.apply.stockWrite(n.stock)}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {dry.outcome.sizes.planned > 12 && (
                      <div className="text-faint">{t.sync.apply.dryMore(dry.outcome.sizes.planned - 12)}</div>
                    )}
                  </div>
                )}

                {dry.outcome.gtinsWritten > 0 && (
                  <div className="font-medium text-up">
                    {t.sync.apply.gtinsWritten(dry.outcome.gtinsWritten)}
                  </div>
                )}

                {/* Prices */}
                <div className="font-semibold">{t.sync.apply.dryTitle(dry.outcome.variations)}</div>
                <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                  {dry.outcome.changes.slice(0, 12).map((c) => (
                    <li key={`${c.storeProductId}:${c.storeVariationId}`} className="flex items-center gap-2 tnum">
                      <span className="font-mono text-faint">{c.sku}</span>
                      <span>{c.sizeLabel}</span>
                      <span className="ml-auto text-muted">
                        {c.newPrice != null ? (
                          <>
                            {c.currentPrice != null ? eur.format(c.currentPrice) : "—"} →{" "}
                            <span className="font-semibold text-ink">{eur.format(c.newPrice)}</span>
                          </>
                        ) : null}
                        {c.newStock != null && (
                          <span className={c.newStock === 0 ? "font-semibold text-skip" : "text-warn"}>
                            {c.newPrice != null ? " · " : ""}
                            {t.sync.apply.stockWrite(c.newStock)}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {dry.outcome.changesTotal > 12 && (
                  <div className="text-faint">{t.sync.apply.dryMore(dry.outcome.changesTotal - 12)}</div>
                )}
              </div>
            )}

          </div>
        </div>
      )}

      {/* Destructive standardization: obliterate + re-create variation sets */}
      {hasSnapshot && (
        <RebuildPanel
          previewSkus={plans.map((p) => p.sku)}
          disabled={!initialState.wooConfigured || pulling || applying != null}
          onDone={() => {
            void refreshHistory();
            if (plans.length > 0) rerun();
          }}
        />
      )}

      {/* History */}
      <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
        <div className="text-sm font-semibold">{t.sync.history.title}</div>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t.sync.history.empty}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line/60 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="text-xs text-faint tnum">
                  {when.dateTime(h.startedAt)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    h.dryRun ? "bg-surface-2 text-muted" : "bg-accent/12 text-accent-text"
                  }`}
                >
                  {h.dryRun ? t.sync.history.dry : t.sync.history.live}
                </span>
                {h.kind !== "sync" && (
                  <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-muted">
                    {t.sync.history.kind[h.kind]}
                  </span>
                )}
                <span className="text-xs font-medium text-muted">
                  {t.sync.history.status[h.status]}
                </span>
                <span className="ml-auto text-xs text-muted tnum">
                  {h.kind === "sync"
                    ? t.sync.history.line(h.updatedCount, h.requestedVariations ?? 0)
                    : t.sync.history.created(h.created, h.failedProducts)}
                  {h.sizesAdded > 0 && <span className="text-up"> · {t.sync.history.sizes(h.sizesAdded)}</span>}
                  {h.cleanupDeletions != null && h.cleanupDeletions > 0 && (
                    <span className="text-skip"> · {t.sync.apply.deletions(h.cleanupDeletions)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
