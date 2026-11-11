import { and, desc, eq, inArray, isNotNull, lt, max, notInArray } from "drizzle-orm";
import type { AutomationConfig } from "@core/config";
import { DEFAULT_AUTOMATION } from "@/lib/automation";
import { env } from "@/lib/env";
import {
  effectiveSync,
  intervalTimes,
  nextSlot,
  previousSlot,
  retryAt,
  slotMissed,
  type AutoSync,
} from "@/lib/schedule";
// eslint-disable-next-line no-restricted-imports -- predates the boundary rule; hoisted into src/server in weeks 3-6 (docs/middleware-readiness.md §6)
import { runKicksdbRefresh } from "@/server/actions/feeds";
import { kicksdbConfigured } from "@/server/adapters/kicksdb";
import { automationNow, loadAutomation, onAutomationChange } from "@/server/automation/settings";
import { db } from "@/server/db/client";
import { schedulerRuns, type SchedulerRunRow, type SchedulerStepSummary } from "@/server/db/schema";
import { isWriter } from "@/server/writer";

/**
 * In-app scheduler: the app syncs itself, no external cron needed.
 * Started once per server boot from src/instrumentation.ts.
 *
 * What it does and when is the owner's Automatic sync settings (Feeds tab;
 * AppConfig.automation, src/lib/automation.ts), followed while it runs: a
 * change saved there re-arms the timers it concerns within a minute, at once
 * in the process that saved it (see reconfigure). No restart, no .env.
 *
 * Every day at the settings' daily times (default 04:30) in the shop's time
 * zone (default Europe/Rome) it runs, in order:
 *   1. the store pull — the Hub's copy of every product on WooCommerce;
 *   2. the GoldenSneakers complete sync;
 *   3. a KicksDB re-pricing pass, so whatever the sync registered is priced;
 *   4. with the store sync on and the rest of the store included
 *      (dailyStoreSync), the store sync of the whole store: every price and
 *      stock change the sources now call for, written to it a few at a time
 *      (storeMaxChanges a run) — the feed's products left to the feed cycle
 *      while there is one (see syncStore);
 *   5. the automatic categories, against a full read of the store;
 *   6. self-repair (autoRepair only), metadata backfill, recategorize.
 * A step that fails does not stop the others, and is retried an hour later
 * (twice at most). Every run is recorded in scheduler_runs, so a restarting
 * server knows whether the last slot ran: one missed while the server was
 * down, or whose run failed, runs a minute after boot — while a deploy after
 * a good run starts nothing. A fully successful run calls the settings'
 * heartbeat URL, for a monitor that alerts when the calls stop.
 *
 * The feed cycle, every feedsEveryMinutes on the clock (15 → :00, :15, :30,
 * :45; 15 by default) while the store sync is on and the GoldenSneakers API
 * is set, is the short version for a supplier whose stock moves during the
 * day: the GoldenSneakers sync, then the store sync of the feed's products
 * only (see effectiveSync). KicksDB-priced products wait for the daily run:
 * planning them asks KicksDB about every one, every time. A cycle never
 * overlaps another run: it skips its turn while one is going, and the daily
 * run waits for a cycle to finish rather than lose its slot. A fully
 * successful cycle calls the feed heartbeat URL.
 *
 * Alongside, the recent orders are pulled every ordersEveryMinutes (default
 * 15), so new orders reach the Orders tab without a click, and the photo
 * queue is worked whenever something is due (see woo/media.ts): the
 * Publisher creates products hidden, and they go on sale with their first
 * photo. It pauses while a store pull runs — a product put on sale as the pull
 * assembles its copy of the store would be left out of it.
 *
 * And every collectionsEveryMinutes (default 5) the automatic categories
 * check the store for changes and take in or let go of the products their
 * rules now say (src/server/collections). While no category is automatic the
 * check still keeps the store index fresh — the Vetrina's catalog lists from
 * it — and writes nothing.
 *
 * On by default in production, off in dev; SCHEDULER=on|off overrides — the
 * one switch left in the environment, since it is the process's, not the
 * shop's. Needs a long-running server (`next start`, Docker) — a serverless
 * platform that freezes the process between requests won't tick.
 * The /api/cron/* endpoints stay available for external schedulers.
 */

/** Products healed per tick — a big store recovers over days, not in one burst. */
const MAX_REPAIRS_PER_TICK = 200;

/** Rounds per refresh pass (100 SKUs each) — same backstop as the cron route. */
const MAX_ROUNDS = 50;
/** A missed slot runs this long after boot, once the server has settled. */
const CATCH_UP_DELAY_MS = 60 * 1000;
const RETRY_DELAY_MS = 60 * 60 * 1000;
const MAX_RETRIES = 2;
/** A store pull the Sync tab moved forward this recently is still being driven. */
const ACTIVE_PULL_MS = 2 * 60 * 1000;
/** How long the daily run waits for a feed cycle still going before it gives up. */
const WAIT_FOR_IDLE_MS = 60 * 60 * 1000;
/** Feed cycles kept in scheduler_runs. */
const FEED_HISTORY_DAYS = 7;
/** The photo queue: looked at this often when nothing is due… */
const MEDIA_IDLE_MS = 60 * 1000;
/** …worked this long at a time when something is… */
const MEDIA_BUDGET_MS = 4 * 60 * 1000;
/** …this many products at once: every photo is a download and a round of thumbnails on the shop's server. */
const MEDIA_CONCURRENCY = 2;

const DAILY_STEPS = ["pull", "gs", "publish", "kicksdb", "storeSync", "collections", "repair", "backfill", "recategorize"] as const;
const FEED_STEPS = ["gs", "publish", "feedSync"] as const;
type StepName = (typeof DAILY_STEPS)[number] | (typeof FEED_STEPS)[number];
/** A step of a scheduled run, as the status names the one going. */
export type SchedulerStep = StepName;
/** What a step did (db/schema.ts): `deferred`, changes the whole-store sync left for its next run. */
type StepOutcome = SchedulerStepSummary;
/** The runs nobody scheduled for a slot of the day: the feed cycles, and those started by hand. */
const NOT_DAILY: SchedulerRunRow["trigger"][] = ["interval", "manual"];

/** New feed products published per run: a new price list's hundreds go out over a few cycles. */
const PUBLISH_PER_RUN = 20;
/** A product the store refused is not offered to it again, unattended, for this long. */
const PUBLISH_RETRY_MS = 6 * 60 * 60 * 1000;

/** A step that failed with numbers to report: a feed cycle past its limit, writes the store refused. */
class StepFailure extends Error {
  constructor(
    message: string,
    readonly detail: Partial<StepOutcome>,
  ) {
    super(message);
  }
}

const LABEL: Record<StepName, string> = {
  pull: "store pull",
  gs: "GS sync",
  publish: "auto-publish",
  kicksdb: "KicksDB refresh",
  storeSync: "store sync",
  feedSync: "store sync",
  collections: "automatic categories",
  repair: "repair",
  backfill: "metadata backfill",
  recategorize: "recategorize",
};

/** The status counters the daily run's steps report into. */
const COUNTER = {
  pull: "lastPulled",
  gs: "lastGsSkus",
  kicksdb: "lastRefreshed",
  storeSync: "lastWritten",
  repair: "lastRepaired",
} as const satisfies Partial<Record<StepName, keyof SchedulerStatus>>;

interface Job {
  /** "manual": started by hand ("Sincronizza ora"), now, whatever the settings say about the timers. */
  kind: "daily" | "feeds" | "manual";
  /** The scheduled time this run is for (a catch-up or a retry keeps its slot's; a manual run, when it started). */
  slot: Date;
  trigger: SchedulerRunRow["trigger"];
  steps: readonly StepName[];
  attempt: number;
}

/** Live scheduler state, surfaced on /feeds via getFeedsState(). */
export interface SchedulerStatus {
  enabled: boolean;
  running: boolean;
  times: string[]; // the daily sync's times of day…
  timeZone: string; // …in this zone
  nextRunAt: number | null; // epoch ms
  lastRunAt: number | null;
  lastPulled: number | null; // products in the last store pull (null = not run)
  lastGsSkus: number | null; // SKUs in the last GS sync (null = not run)
  lastRefreshed: number | null; // entries re-priced in the last pass
  lastRepaired: number | null; // products healed in the last pass (null = off)
  lastWritten: number | null; // variations the last store sync wrote (null = not run)
  lastDeferred: number | null; // …and the changes it left for the next run (null = none)
  lastError: string | null;
  autoSync: AutoSync; // what the runs write to the store unattended
  autoSyncMax: number; // a feed cycle past this many changes writes nothing
  autoSyncStoreMax: number; // the whole-store sync writes this many a run, the rest at the next
  feedsEveryMinutes: number; // 0 = no feed cycle
  feedsNextAt: number | null;
  feedsLastAt: number | null;
  feedsLastWritten: number | null; // variations the last cycle wrote
  feedsError: string | null;
  ordersEveryMinutes: number; // 0 = orders are pulled by hand only
  ordersLastAt: number | null;
  ordersError: string | null;
  mediaLastAt: number | null; // the photo queue last worked on something
  mediaError: string | null;
  collectionsEveryMinutes: number; // 0 = only in the daily sync
  collectionsLastAt: number | null; // the last check that ran
  collectionsLastMoved: number | null; // products it moved
  collectionsError: string | null;
  /** The run going now — which kind, its steps, the one it is on — for a screen that follows it; null when idle. */
  current: { kind: Job["kind"]; steps: SchedulerStep[]; step: SchedulerStep | null; startedAt: number } | null;
  /** The last run started by hand ("Sincronizza ora"): when it ended, what each step did, what failed. */
  lastManual: { at: number; summary: Record<string, StepOutcome>; error: string | null } | null;
}

// Instrumentation and the server-action bundle each get their own copy of
// this module; globalThis is the one store both see.
type SchedulerState = SchedulerStatus & { started: boolean };

/** The background loops beside the daily run and the feed cycle. */
type Loop = "orders" | "collections";

/**
 * The timers, kept to be re-armed when the settings change — never shown
 * (getSchedulerStatus): a timer is no status. One pending timer per kind of
 * run at most: re-arming clears the old one first, and a run going re-arms
 * itself when it ends, on the settings in force then.
 */
interface Timers {
  /** The daily run's next job and its timer; null while that job runs. */
  daily: { timer: ReturnType<typeof setTimeout>; job: Job } | null;
  feeds: ReturnType<typeof setTimeout> | null;
  feedsRunning: boolean;
  loops: Record<Loop, { timer: ReturnType<typeof setTimeout> | null; running: boolean }>;
  /** The settings listener is registered (once per process). */
  listening: boolean;
  /** The first timers are armed: from then on a change of settings re-arms them. */
  armed: boolean;
}

const g = globalThis as { __storeHubScheduler?: SchedulerState; __storeHubSchedulerTimers?: Timers };

function timers(): Timers {
  return (g.__storeHubSchedulerTimers ??= {
    daily: null,
    feeds: null,
    feedsRunning: false,
    loops: { orders: { timer: null, running: false }, collections: { timer: null, running: false } },
    listening: false,
    armed: false,
  });
}

function store(): SchedulerState {
  return (g.__storeHubScheduler ??= {
    started: false,
    enabled: false,
    running: false,
    times: [],
    timeZone: DEFAULT_AUTOMATION.timeZone,
    nextRunAt: null,
    lastRunAt: null,
    lastPulled: null,
    lastGsSkus: null,
    lastRefreshed: null,
    lastRepaired: null,
    lastWritten: null,
    lastDeferred: null,
    lastError: null,
    autoSync: "off",
    autoSyncMax: DEFAULT_AUTOMATION.maxChanges,
    autoSyncStoreMax: DEFAULT_AUTOMATION.storeMaxChanges,
    feedsEveryMinutes: 0,
    feedsNextAt: null,
    feedsLastAt: null,
    feedsLastWritten: null,
    feedsError: null,
    ordersEveryMinutes: 0,
    ordersLastAt: null,
    ordersError: null,
    mediaLastAt: null,
    mediaError: null,
    collectionsEveryMinutes: 0,
    collectionsLastAt: null,
    collectionsLastMoved: null,
    collectionsError: null,
    current: null,
    lastManual: null,
  });
}

export function getSchedulerStatus(): SchedulerStatus {
  const { started: _started, ...status } = store();
  return status;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** "2026-10-01 04:30" in the schedule's zone, for the log. */
const when = (date: Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: store().timeZone, dateStyle: "short", timeStyle: "short" }).format(date);

async function refreshCatalog(): Promise<{ refreshed: number; error: string | null }> {
  let runId: string | undefined;
  let refreshed = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await runKicksdbRefresh({ limit: 100, runId });
    if (!res.ok) {
      console.error(`[scheduler] KicksDB refresh failed after ${refreshed} re-priced: ${res.error}`);
      return { refreshed, error: res.error ?? "refresh failed" };
    }
    runId = res.runId ?? runId;
    refreshed += res.refreshed ?? 0;
    if ((res.requested ?? 0) === 0 || (res.remainingStale ?? 0) === 0) break;
  }
  console.log(`[scheduler] KicksDB refresh done: ${refreshed} re-priced`);
  return { refreshed, error: null };
}

/**
 * The store sync, unattended: the same preview the Sync tab runs, then its
 * apply — what an operator does by pressing "apply all" — over the products
 * the feed has ever listed (the feed cycle; dropped ones included, so their
 * sizes go to 0) or the whole store (the daily run), which leaves those to the
 * feed cycle while there is one: the two never write the same product.
 *
 * Narrower than the tab, on purpose: prices, stock and the sizes a product is
 * missing — no size cleanup (it deletes variations) and no identifiers. Every
 * write lands in the Sync tab's history like a manual apply. And bounded:
 *  - a feed cycle that would change more than the settings' maxChanges
 *    variations writes nothing. In a quarter of an hour a change that large is
 *    a broken feed or a new price list, and either is reviewed in the Sync tab
 *    first;
 *  - the whole-store run writes storeMaxChanges at most — whole
 *    products — and leaves the rest to the next run. It used to write nothing
 *    past its limit, like the cycle; but a whole store's KicksDB prices move
 *    by more than that from one day to the next, and what a run refused was
 *    still there for the next one, larger: past the limit once, it never wrote
 *    again.
 *
 * And more careful, because nobody is watching: a price changed on the store
 * is never written over. The plan keeps the ones the snapshot already shows
 * (see storeEditOf), and each product is read again right before its write,
 * which keeps the ones changed since — the snapshot is up to a day old between
 * two daily pulls (see live-check.ts). Both land on the Sync tab's list of
 * prices changed on WordPress, for a person to decide.
 *
 * Started by hand ("Sincronizza ora"), it writes whatever the store sync's
 * switch says — a person asked for it, now — under the same limits; and the
 * whole store's pass leaves the feed's products to the feed's, which runs
 * first in the same run.
 */
async function syncStore(scope: "store" | "feed", manual = false): Promise<StepOutcome | null> {
  const s = store();
  const writes = s.autoSync;
  if (!manual && (writes === "off" || (scope === "store" && writes !== "all"))) return null;
  const { wooConfigured } = await import("@/server/woo/client");
  if (!wooConfigured()) return null;

  // A pull is reading the store into a new copy: writing now would race it
  // (the pull keeps what is patched meanwhile, but its plan is made from the
  // copy being replaced). The next cycle writes it, a quarter of an hour on.
  const { getLatestPullRun, pullInFlight } = await import("@/server/woo/pull");
  if (pullInFlight(await getLatestPullRun())) {
    console.log("[scheduler] store sync waits: a store pull is running");
    return { ok: true, count: 0, note: "a store pull was running: the next cycle writes", pullRunning: true };
  }

  // The feed's products are the feed cycle's, under its own limit. While there
  // is a cycle, the whole-store run leaves them to it: a broken feed it refused
  // must not reach the store through the daily run's instalments instead.
  let skus: string[] | undefined;
  if (scope === "feed" || s.feedsEveryMinutes > 0 || (manual && feedConnected())) {
    const { GS_FEED, knownFeedSkus } = await import("@/server/feeds/repo");
    const { listStoreSkuSpellings } = await import("@/server/store-json/repo");
    const { skuKey } = await import("@/lib/skus");
    const known = await knownFeedSkus(GS_FEED);
    const fed = (sku: string) => known.has(skuKey(sku));
    const onStore = await listStoreSkuSpellings();
    skus = scope === "feed" ? onStore.filter(fed) : onStore.filter((sku) => !fed(sku));
    // Never handed on empty: no SKUs is the whole store, to the sync.
    if (skus.length === 0) {
      return {
        ok: true,
        count: 0,
        note: scope === "feed" ? "no feed products on the store" : "every product on the store follows the feed",
      };
    }
  }

  const { runPriceSync } = await import("@/server/sync/price-sync");
  const limit = scope === "store" ? s.autoSyncStoreMax : s.autoSyncMax;
  // The sizes a product lacks are added too. The whole-store run adds every
  // one, as the Sync tab does: KicksDB-priced sizes included, sold on demand
  // like the rest of those products' sizes. The feed cycle, every quarter of
  // an hour, only the feed's: their stock is real, where KicksDB lists every
  // size StockX has an ask for.
  const { outcome, capped, sizesHeld, deferred } = await runPriceSync({
    skus,
    liveCheck: true,
    maxChanges: limit,
    instalments: scope === "store",
    addSizes: scope === "store" ? "all" : "feed",
  });
  if (capped != null) {
    throw new StepFailure(
      `${capped} changes planned, more than the ${limit} a feed cycle may write (the safety limit of Automatic sync): ` +
        "nothing written. Review and apply them in the Sync tab.",
      { capped: { planned: capped, limit } },
    );
  }
  const held = sizesHeld != null ? `${sizesHeld} missing size(s) wait for the Sync tab (more than ${limit} changes at once)` : null;
  if (held) console.log(`[scheduler] store sync: ${held}`);
  const waiting = deferred != null ? `${deferred} more wait for the next run (${limit} a run)` : null;
  const counts = (o: NonNullable<typeof outcome> | null) => ({
    written: o?.updated ?? 0,
    added: o?.sizes.added ?? 0,
    kept: o?.keptStoreEdits ?? 0,
    failed: o?.failedTotal ?? 0,
    held: sizesHeld ?? 0,
  });
  if (!outcome) return { ok: true, count: 0, sync: counts(null), ...(held ? { note: held } : {}) };
  if (outcome.failedTotal > 0) {
    throw new StepFailure(
      `${outcome.updated} of ${outcome.variations} changes written, ${outcome.failedTotal} failed: ` +
        (outcome.failed[0]?.error ?? "no reason given") +
        (waiting ? ` (${waiting})` : ""),
      { sync: counts(outcome), ...(deferred != null ? { deferred } : {}) },
    );
  }
  const kept = outcome.keptStoreEdits;
  const added = outcome.sizes.added;
  const products = scope === "feed" ? "feed products" : skus ? "products outside the feed" : "whole store";
  console.log(
    `[scheduler] store sync: ${outcome.updated} change(s) written (${products})` +
      (added > 0 ? `, ${added} missing size(s) added` : "") +
      (kept > 0 ? `, ${kept} price(s) changed on the store since the last pull kept` : "") +
      (waiting ? `; ${waiting}` : ""),
  );
  const notes = [
    ...(added > 0 ? [`${added} missing size(s) added`] : []),
    ...(held ? [held] : []),
    ...(waiting ? [waiting] : []),
    ...(kept > 0 ? [`${kept} price(s) changed on the store kept`] : []),
  ];
  return {
    ok: true,
    count: outcome.updated + added,
    sync: counts(outcome),
    ...(deferred != null ? { deferred } : {}),
    ...(notes.length > 0 ? { note: notes.join(", ") } : {}),
  };
}

/** SKUs the store refused, and when: left alone for PUBLISH_RETRY_MS (per process). */
const g2 = globalThis as { __storeHubPublishRefused?: Map<string, number> };
const refusedAt = () => (g2.__storeHubPublishRefused ??= new Map());

/**
 * Auto-publish: the supplier feed's products the store does not have yet,
 * published as the Publish tab publishes them — created hidden, on sale with
 * their first photo (the photo queue), each SKU looked up live before it is
 * created, so a stale copy of the store never makes a duplicate. KicksDB
 * picks are not published here: those are a person's choice.
 *
 * Bounded: PUBLISH_PER_RUN a run, the rest at the next; a product the store
 * refused waits PUBLISH_RETRY_MS rather than failing every cycle; nothing
 * while there is no copy of the store yet (the delta cannot be trusted), or
 * while a store pull is reading it.
 */
async function publishFeedProducts(): Promise<StepOutcome | null> {
  if (!feedConnected()) return null;
  const { wooConfigured } = await import("@/server/woo/client");
  if (!wooConfigured()) return null;
  const { getLatestPullRun, pullInFlight } = await import("@/server/woo/pull");
  if (pullInFlight(await getLatestPullRun())) return { ok: true, count: 0, pullRunning: true };

  const { GS_FEED } = await import("@/server/feeds/repo");
  const { listPublishTargets, publishProducts } = await import("@/server/woo/publish");
  const page = await listPublishTargets({ source: "goldensneakers" }, Number.MAX_SAFE_INTEGER);
  if (!page.hasSnapshot) return { ok: true, count: 0, note: "no copy of the store yet: nothing published" };

  const refused = refusedAt();
  const now = Date.now();
  for (const [sku, at] of refused) if (now - at > PUBLISH_RETRY_MS) refused.delete(sku);
  // The lens is ignored when only one source is in the pool: the feed's, said here.
  const fresh = page.candidates.filter((c) => c.source === GS_FEED && !c.onStore && !refused.has(c.sku));
  const batch = fresh.slice(0, PUBLISH_PER_RUN).map((c) => c.sku);
  const waiting = fresh.length - batch.length;
  if (batch.length === 0) return { ok: true, count: 0, published: { created: 0, failed: 0, waiting: 0 } };

  const outcome = await publishProducts(batch, { dryRun: false });
  const failed = outcome.products.filter((p) => p.error);
  for (const p of failed) refused.set(p.sku, now);
  const created = outcome.created + outcome.completed;
  console.log(
    `[scheduler] auto-publish: ${created} new feed product(s) published` +
      (failed.length > 0 ? `, ${failed.length} refused (${failed[0].sku}: ${failed[0].error})` : "") +
      (waiting > 0 ? `; ${waiting} more at the next run` : ""),
  );
  return {
    ok: true,
    count: created,
    published: { created, failed: failed.length, waiting },
    ...(failed.length > 0 ? { note: `${failed.length} refused: ${failed[0].sku}: ${failed[0].error}` } : {}),
  };
}

/**
 * The scheduled runs' steps. Each answers what it did, null when it does not
 * apply to this shop (its source is not configured, or the store sync is
 * off), or throws.
 */
const RUN_STEP: Record<StepName, (job: Job) => Promise<StepOutcome | null>> = {
  async pull() {
    const { wooConfigured } = await import("@/server/woo/client");
    if (!wooConfigured()) return null;
    const { getLatestPullRun, runFullPull } = await import("@/server/woo/pull");
    const latest = await getLatestPullRun();
    if (latest?.status === "running" && Date.now() - latest.updatedAt.getTime() < ACTIVE_PULL_MS) {
      // Two drivers on one pull would race for its cursor: let the Sync tab
      // finish, and pull again on the retry.
      throw new Error("a pull is running from the Sync tab right now");
    }
    const progress = await runFullPull();
    if (progress.status !== "done") {
      throw new Error(progress.error ?? `stopped after ${progress.productsFetched} products (${progress.status})`);
    }
    console.log(`[scheduler] store pull done: ${progress.productsFetched} products`);
    return { ok: true, count: progress.productsFetched };
  },

  async gs() {
    const { gsConfigured, syncGoldenSneakersFromApi } = await import("@/server/feeds/goldensneakers");
    if (!gsConfigured()) return null;
    const report = await syncGoldenSneakersFromApi();
    const note = `${report.added} added, ${report.updated} updated, ${report.deactivated} deactivated`;
    console.log(`[scheduler] GS sync done: ${report.skus} SKUs (${note})`);
    const feed = { added: report.added, updated: report.updated, deactivated: report.deactivated };
    return { ok: true, count: report.skus, note, feed };
  },

  // The re-pricing pass exists only where KicksDB does; a supplier-feed-only
  // instance gets its prices from the feed sync above and nothing else.
  async kicksdb() {
    if (!kicksdbConfigured()) return null;
    const { refreshed, error } = await refreshCatalog();
    if (error) throw new Error(`${error} (after ${refreshed} re-priced)`);
    return { ok: true, count: refreshed };
  },

  // The feed's new products, published as soon as the feed lists them — on the
  // store sync's switch, like every write nobody watches; by hand, on its own.
  async publish(job) {
    const settings = automationNow();
    if (!settings.autoPublish || (job.kind !== "manual" && !settings.storeSync)) return null;
    return publishFeedProducts();
  },

  storeSync: (job) => syncStore("store", job.kind === "manual"),
  feedSync: (job) => syncStore("feed", job.kind === "manual"),

  // The automatic categories against a FULL read of the store: what the
  // frequent check cannot see — a product binned, a change that left the
  // product's modified time alone — is caught here, once a day.
  async collections() {
    const { runFull } = await import("@/server/collections/runner");
    const outcome = await runFull();
    if (!outcome) return null;
    await sweepHiddenTerms();
    console.log(`[scheduler] automatic categories: ${outcome.read} products read, ${outcome.moved} moved`);
    return { ok: true, count: outcome.moved, note: `${outcome.read} products read` };
  },

  // Self-repair: products already online that lost a field to a source's
  // change of shape. Additive and idempotent, but it writes to the LIVE
  // store, so it runs only when the owner turned it on (autoRepair).
  async repair() {
    if (!automationNow().autoRepair) return null;
    const { scanRepairCandidates, repairProducts } = await import("@/server/woo/repair");
    const { incomplete } = await scanRepairCandidates();
    // Bounded: a big store heals over successive days rather than
    // hammering the REST API in one tick.
    const batch = incomplete.slice(0, MAX_REPAIRS_PER_TICK);
    if (batch.length === 0) return { ok: true, count: 0 };
    const outcome = await repairProducts(batch, { dryRun: false });
    console.log(
      `[scheduler] repair done: ${outcome.repaired} healed, ${outcome.alreadyWhole} already whole, ${outcome.failed} failed`,
    );
    return { ok: true, count: outcome.repaired };
  },

  // Drain a slice of the metadata-backfill queue (rows imported before the
  // catalog stored category/gender/gallery). Bounded so one tick never
  // hammers the products endpoint; the queue empties over successive days.
  async backfill() {
    const { backfillCatalogMetadata } = await import("@/server/catalog/enrich");
    const enrich = await backfillCatalogMetadata(250);
    if (enrich.scanned > 0) {
      console.log(
        `[scheduler] metadata backfill: ${enrich.enriched} enriched, ${enrich.missed} rotated (of ${enrich.scanned})`,
      );
    }
    return { ok: true, count: enrich.enriched };
  },

  // Classify whatever is still uncategorized from the stored titles (feed
  // and store-only rows have no API metadata at all — see classify.ts), and
  // fold case-variant duplicate categories into one bucket.
  async recategorize() {
    const { recategorizeCatalog } = await import("@/server/catalog/repo");
    const { getActiveConfig } = await import("@/server/config/repo");
    const market = (await getActiveConfig()).source.market;
    const recat = await recategorizeCatalog(market);
    if (recat.classified > 0 || recat.unified > 0 || recat.synced > 0) {
      console.log(
        `[scheduler] recategorize: ${recat.classified} classified from titles, ` +
          `${recat.unified} case-duplicates unified, ${recat.synced} synced into the stored product`,
      );
    }
    return { ok: true, count: recat.classified };
  },
};

/**
 * The run history (scheduler_runs). Never throws: a history that cannot be
 * written must not stop the sync itself.
 */
const history = {
  async open(job: Job): Promise<string | null> {
    try {
      const [row] = await db
        .insert(schedulerRuns)
        .values({ slotAt: job.slot, trigger: job.trigger })
        .returning({ id: schedulerRuns.id });
      return row.id;
    } catch (e) {
      console.error(`[scheduler] could not record the run: ${messageOf(e)}`);
      return null;
    }
  },

  async close(id: string | null, summary: Record<string, StepOutcome>, error: string | null): Promise<void> {
    if (!id) return;
    try {
      await db
        .update(schedulerRuns)
        .set({ status: error ? "failed" : "ok", summary, error, finishedAt: new Date() })
        .where(eq(schedulerRuns.id, id));
    } catch (e) {
      console.error(`[scheduler] could not record the run's outcome: ${messageOf(e)}`);
    }
  },

  /** Feed cycles and runs by hand older than a week: dozens a day, read only for the last one. */
  async prune(): Promise<void> {
    try {
      await db
        .delete(schedulerRuns)
        .where(
          and(
            inArray(schedulerRuns.trigger, NOT_DAILY),
            lt(schedulerRuns.startedAt, new Date(Date.now() - FEED_HISTORY_DAYS * 24 * 60 * 60 * 1000)),
          ),
        );
    } catch (e) {
      console.warn(`[scheduler] old feed cycles kept: ${messageOf(e)}`);
    }
  },
};

/**
 * At boot: close the runs a stopped server left open, show the last daily run,
 * the last feed cycle and the last run by hand again, and return the latest
 * slot a daily run completed successfully — a run by hand is no daily run,
 * whatever it did.
 */
async function loadHistory(s: SchedulerState): Promise<Date | null> {
  await db
    .update(schedulerRuns)
    .set({ status: "interrupted", finishedAt: new Date() })
    .where(eq(schedulerRuns.status, "running"));

  const [last] = await db
    .select()
    .from(schedulerRuns)
    .where(and(isNotNull(schedulerRuns.finishedAt), notInArray(schedulerRuns.trigger, NOT_DAILY)))
    .orderBy(desc(schedulerRuns.startedAt))
    .limit(1);
  if (last) {
    s.lastRunAt = (last.finishedAt ?? last.startedAt).getTime();
    s.lastError = last.error;
    for (const [step, counter] of Object.entries(COUNTER)) {
      const outcome = last.summary?.[step];
      if (outcome?.ok) s[counter] = outcome.count ?? null;
    }
    const sync = last.summary?.storeSync;
    if (sync?.ok) s.lastDeferred = sync.deferred ?? null;
  }

  const [cycle] = await db
    .select()
    .from(schedulerRuns)
    .where(and(isNotNull(schedulerRuns.finishedAt), eq(schedulerRuns.trigger, "interval")))
    .orderBy(desc(schedulerRuns.startedAt))
    .limit(1);
  if (cycle) {
    s.feedsLastAt = (cycle.finishedAt ?? cycle.startedAt).getTime();
    s.feedsError = cycle.error;
    const written = cycle.summary?.feedSync;
    if (written?.ok) s.feedsLastWritten = written.count ?? null;
  }

  s.lastManual = await lastManualRun();

  const [served] = await db
    .select({ slot: max(schedulerRuns.slotAt) })
    .from(schedulerRuns)
    .where(and(eq(schedulerRuns.status, "ok"), notInArray(schedulerRuns.trigger, NOT_DAILY)));
  return served?.slot ? new Date(served.slot) : null;
}

/** The last run of any kind that ended — when, which, and its failure if it failed; null: none yet. */
export async function lastFinishedRun(): Promise<{ at: number; trigger: SchedulerRunRow["trigger"]; error: string | null } | null> {
  const [row] = await db
    .select({ startedAt: schedulerRuns.startedAt, finishedAt: schedulerRuns.finishedAt, trigger: schedulerRuns.trigger, error: schedulerRuns.error })
    .from(schedulerRuns)
    .where(isNotNull(schedulerRuns.finishedAt))
    .orderBy(desc(schedulerRuns.startedAt))
    .limit(1);
  return row ? { at: (row.finishedAt ?? row.startedAt).getTime(), trigger: row.trigger, error: row.error } : null;
}

/** The last run started by hand that ended, as the status shows it; null: none in the last week. */
export async function lastManualRun(): Promise<SchedulerStatus["lastManual"]> {
  const [row] = await db
    .select()
    .from(schedulerRuns)
    .where(and(isNotNull(schedulerRuns.finishedAt), eq(schedulerRuns.trigger, "manual")))
    .orderBy(desc(schedulerRuns.startedAt))
    .limit(1);
  if (!row) return null;
  return { at: (row.finishedAt ?? row.startedAt).getTime(), summary: row.summary ?? {}, error: row.error };
}

/** The run logs every cycle adds to, cut back once a day (see retention.ts). Never throws. */
async function pruneLogs(): Promise<void> {
  try {
    const { pruneRunLogs } = await import("@/server/retention");
    const pruned = await pruneRunLogs();
    const total = pruned.syncRuns + pruned.ingestionRuns + pruned.applyRuns + pruned.vetrinaOperations + pruned.vetrinaProposals;
    if (total > 0) {
      console.log(
        `[scheduler] old run logs removed: ${pruned.syncRuns} sync runs, ${pruned.ingestionRuns} ingestion runs, ${pruned.applyRuns} apply records, ${pruned.vetrinaOperations} Vetrina actions, ${pruned.vetrinaProposals} proposals`,
      );
    }
  } catch (e) {
    console.warn(`[scheduler] old run logs kept: ${messageOf(e)}`);
  }
}

/** Tell the monitor behind a heartbeat URL that a run went through. */
async function heartbeat(url: string | null): Promise<void> {
  if (!url) return;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) console.warn(`[scheduler] heartbeat answered ${res.status}`);
  } catch (e) {
    console.warn(`[scheduler] heartbeat failed: ${messageOf(e)}`);
  }
}

/**
 * Run a job's steps in order; answers the steps that failed, or null when a
 * feed cycle found another run going and skipped its turn.
 */
async function run(job: Job): Promise<StepName[] | null> {
  const s = store();
  if (s.running) {
    if (job.kind === "feeds") {
      console.log("[scheduler] feed cycle skipped: another run is still going");
      return null;
    }
    // By hand: the person is told one is going (syncNow), and follows that one.
    if (job.kind === "manual") return null;
    // The daily run waits for a feed cycle rather than lose its slot.
    const deadline = Date.now() + WAIT_FOR_IDLE_MS;
    while (s.running && Date.now() < deadline) await sleep(5_000);
    if (s.running) {
      s.lastError = "another run has been going for an hour: this run did not start";
      console.error(`[scheduler] ${s.lastError}`);
      return [...job.steps];
    }
  }
  // Set before the first await: whoever asks next sees this run going.
  s.running = true;
  s.current = { kind: job.kind, steps: [...job.steps], step: job.steps[0] ?? null, startedAt: Date.now() };
  const id = await history.open(job);
  const summary: Record<string, StepOutcome> = {};
  const failed: StepName[] = [];
  try {
    for (const step of job.steps) {
      if (s.current) s.current = { ...s.current, step };
      try {
        const outcome = await RUN_STEP[step](job);
        if (outcome) summary[step] = outcome;
      } catch (e) {
        summary[step] = { ok: false, note: messageOf(e), ...(e instanceof StepFailure ? e.detail : {}) };
        failed.push(step);
        console.error(`[scheduler] ${LABEL[step]} failed: ${messageOf(e)}`);
      }
    }
  } finally {
    s.running = false;
    s.current = null;
    const error = failed.length > 0 ? failed.map((step) => `${LABEL[step]}: ${summary[step].note}`).join(" · ") : null;
    if (job.kind === "manual") {
      s.lastManual = { at: Date.now(), summary, error };
    } else if (job.kind === "feeds") {
      s.feedsLastAt = Date.now();
      s.feedsError = error;
      const written = summary.feedSync;
      s.feedsLastWritten = written?.ok ? (written.count ?? null) : null;
    } else {
      s.lastRunAt = Date.now();
      s.lastError = error;
      for (const step of job.steps) {
        if (step in COUNTER) {
          const outcome = summary[step];
          s[COUNTER[step as keyof typeof COUNTER]] = outcome?.ok ? (outcome.count ?? null) : null;
        }
      }
      if (job.steps.includes("storeSync")) {
        const sync = summary.storeSync;
        s.lastDeferred = sync?.ok ? (sync.deferred ?? null) : null;
      }
    }
    await history.close(id, summary, error);
  }
  // Every step has now succeeded (a retry runs only the failed ones). A run by
  // hand is no sign the schedule works: the monitors hear only the scheduled ones.
  if (failed.length === 0 && job.kind !== "manual") {
    const settings = automationNow();
    await heartbeat(job.kind === "feeds" ? settings.feedsHeartbeatUrl : settings.heartbeatUrl);
  }
  if (job.kind === "daily") {
    await history.prune();
    await pruneLogs();
  }
  return failed;
}

/** Arm the daily run's next job — the only one: a job armed before it is dropped. */
function arm(at: number, job: Job): void {
  const t = timers();
  if (t.daily) clearTimeout(t.daily.timer);
  store().nextRunAt = at;
  const timer: NodeJS.Timeout = setTimeout(() => {
    timers().daily = null;
    void fire(job);
  }, Math.max(0, at - Date.now()));
  timer.unref();
  t.daily = { timer, job };
}

/** Run a daily job, then arm what comes next: a retry of its failed steps, or the next slot. */
async function fire(job: Job): Promise<void> {
  const s = store();
  let failed: readonly StepName[];
  try {
    failed = (await run(job)) ?? [];
  } catch (e) {
    console.error(`[scheduler] run crashed: ${messageOf(e)}`);
    failed = job.steps;
  }
  const next = nextSlot(new Date(Math.max(Date.now(), job.slot.getTime())), s.times, s.timeZone);
  const retry = retryAt({
    failed: failed.length,
    attempt: job.attempt,
    now: new Date(),
    next,
    delayMs: RETRY_DELAY_MS,
    maxRetries: MAX_RETRIES,
  });
  if (retry) {
    console.log(`[scheduler] retrying ${failed.map((step) => LABEL[step]).join(", ")} at ${when(retry)}`);
    arm(retry.getTime(), { kind: "daily", slot: job.slot, trigger: "retry", steps: failed, attempt: job.attempt + 1 });
  } else {
    arm(next.getTime(), { kind: "daily", slot: next, trigger: "schedule", steps: DAILY_STEPS, attempt: 0 });
  }
}

/** Decide the first run: the last slot if it never completed, else the next one. */
async function boot(s: SchedulerState): Promise<void> {
  let served: Date | null = null;
  try {
    served = await loadHistory(s);
  } catch (e) {
    console.error(`[scheduler] run history unavailable (${messageOf(e)}) — treating the last slot as missed`);
  }
  const now = new Date();
  if (slotMissed(served, now, s.times, s.timeZone)) {
    const slot = previousSlot(now, s.times, s.timeZone);
    console.log(`[scheduler] the ${when(slot)} sync never completed — running it in a minute`);
    arm(Date.now() + CATCH_UP_DELAY_MS, { kind: "daily", slot, trigger: "catch-up", steps: DAILY_STEPS, attempt: 0 });
  } else {
    const slot = nextSlot(now, s.times, s.timeZone);
    arm(slot.getTime(), { kind: "daily", slot, trigger: "schedule", steps: DAILY_STEPS, attempt: 0 });
  }
}

/**
 * The daily times or the time zone changed: the next scheduled run moves to
 * the new next slot. A retry or a catch-up keeps its time — it is for a slot
 * that already came — and a run going works its next slot out of the new
 * times when it ends.
 */
function rearmDaily(): void {
  const t = timers();
  if (!t.daily || t.daily.job.trigger !== "schedule") return;
  const s = store();
  const slot = nextSlot(new Date(), s.times, s.timeZone);
  arm(slot.getTime(), { kind: "daily", slot, trigger: "schedule", steps: DAILY_STEPS, attempt: 0 });
}

/**
 * The feed cycle's timer: the next mark on the clock after `after` — the
 * only one pending. No catch-up and no retries — the next cycle is never far off.
 */
function armFeeds(after: Date): void {
  const s = store();
  const t = timers();
  if (t.feeds) clearTimeout(t.feeds);
  const slot = nextSlot(after, intervalTimes(s.feedsEveryMinutes), s.timeZone);
  s.feedsNextAt = slot.getTime();
  const timer: NodeJS.Timeout = setTimeout(() => void fireFeeds(slot), Math.max(0, slot.getTime() - Date.now()));
  timer.unref();
  t.feeds = timer;
}

async function fireFeeds(slot: Date): Promise<void> {
  const t = timers();
  t.feeds = null;
  t.feedsRunning = true;
  try {
    await run({ kind: "feeds", slot, trigger: "interval", steps: FEED_STEPS, attempt: 0 });
  } catch (e) {
    console.error(`[scheduler] feed cycle crashed: ${messageOf(e)}`);
  } finally {
    t.feedsRunning = false;
  }
  // On the settings in force now: the interval may have changed while it ran, or the cycle stopped.
  const s = store();
  if (s.feedsEveryMinutes > 0) armFeeds(new Date(Math.max(Date.now(), slot.getTime())));
  else s.feedsNextAt = null;
}

/** The cycle's interval changed, or it started or stopped. A cycle going arms the next one itself when it ends. */
function rearmFeeds(): void {
  const s = store();
  const t = timers();
  if (t.feedsRunning) return;
  if (t.feeds) clearTimeout(t.feeds);
  t.feeds = null;
  s.feedsNextAt = null;
  if (s.feedsEveryMinutes > 0) armFeeds(new Date());
}

/** Pull the recent orders, so new ones reach the Orders tab without a click. */
async function pullOrders(): Promise<void> {
  const s = store();
  try {
    const { wooConfigured } = await import("@/server/woo/client");
    if (wooConfigured()) {
      const { pullRecentOrders } = await import("@/server/orders/pull");
      await pullRecentOrders();
      if (s.ordersError) console.log("[scheduler] orders pull is working again");
      s.ordersLastAt = Date.now();
      s.ordersError = null;
    }
  } catch (e) {
    const cause = (e as { cause?: { message?: string } })?.cause;
    s.ordersError = cause?.message ?? messageOf(e);
    console.error(`[scheduler] orders pull failed: ${s.ordersError}`);
  }
}

/**
 * The index has caught up with the store: a product that joined a category
 * or brand the owner hid in the Vetrina is hidden with it (its products are
 * hidden everywhere). Queued behind the Vetrina's actions; never fatal.
 */
async function sweepHiddenTerms(): Promise<void> {
  try {
    const { queueSweep } = await import("@/server/vetrina/operations/runner");
    void queueSweep();
  } catch (e) {
    console.warn(`[scheduler] hidden categories not swept: ${messageOf(e)}`);
  }
}

/**
 * The automatic categories' check. Said once when it starts failing and once
 * when it recovers, not every round.
 */
async function checkCollections(): Promise<void> {
  const s = store();
  try {
    const { runCheck } = await import("@/server/collections/runner");
    const outcome = await runCheck();
    if (outcome) {
      if (s.collectionsError) console.log("[scheduler] automatic categories are working again");
      s.collectionsLastAt = Date.now();
      s.collectionsLastMoved = outcome.moved;
      await sweepHiddenTerms();
    }
    s.collectionsError = null;
  } catch (e) {
    if (s.collectionsError !== messageOf(e)) console.error(`[scheduler] automatic categories: ${messageOf(e)}`);
    s.collectionsError = messageOf(e);
  }
}

/** The loops: what a turn does, and how often — the settings in force at the end of each turn. */
const LOOPS: Record<Loop, { work: () => Promise<void>; everyMinutes: (s: SchedulerStatus) => number }> = {
  orders: { work: pullOrders, everyMinutes: (s) => s.ordersEveryMinutes },
  collections: { work: checkCollections, everyMinutes: (s) => s.collectionsEveryMinutes },
};

/** A loop's next turn, `delayMs` from now: the only one pending. */
function armLoop(loop: Loop, delayMs: number): void {
  const slot = timers().loops[loop];
  if (slot.timer) clearTimeout(slot.timer);
  const timer: NodeJS.Timeout = setTimeout(() => void turn(loop), delayMs);
  timer.unref();
  slot.timer = timer;
}

/** One turn of a loop, then the next one, as many minutes on as the settings say then — none at 0. */
async function turn(loop: Loop): Promise<void> {
  const slot = timers().loops[loop];
  slot.timer = null;
  slot.running = true;
  try {
    await LOOPS[loop].work();
  } catch (e) {
    console.error(`[scheduler] ${loop}: ${messageOf(e)}`);
  } finally {
    slot.running = false;
  }
  const minutes = LOOPS[loop].everyMinutes(store());
  if (minutes > 0) armLoop(loop, minutes * 60 * 1000);
}

/**
 * A loop's interval changed: its next turn is that far from now — a minute
 * from now when it was off, none when it is turned off. A turn going arms the
 * next one itself when it ends.
 */
function rearmLoop(loop: Loop): void {
  const slot = timers().loops[loop];
  if (slot.running) return;
  const wasOn = slot.timer != null;
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = null;
  const minutes = LOOPS[loop].everyMinutes(store());
  if (minutes > 0) armLoop(loop, wasOn ? minutes * 60 * 1000 : CATCH_UP_DELAY_MS);
}

/**
 * Work the photo queue while something is due, then look again in a minute.
 * Paused while a store pull runs (see the header).
 */
async function workMedia(): Promise<void> {
  const s = store();
  let wait = MEDIA_IDLE_MS;
  try {
    const { wooConfigured } = await import("@/server/woo/client");
    if (wooConfigured()) {
      const { getLatestPullRun, pullInFlight } = await import("@/server/woo/pull");
      const { drainMedia } = await import("@/server/woo/media");
      const drain = await drainMedia({
        budgetMs: MEDIA_BUDGET_MS,
        concurrency: MEDIA_CONCURRENCY,
        paused: async () => pullInFlight(await getLatestPullRun()),
      });
      if (drain.unreachable) {
        const error = `the store did not answer (${drain.unreachable}): the photos wait, without spending their tries`;
        if (s.mediaError !== error) console.error(`[scheduler] photo queue: ${error}`);
        s.mediaError = error;
      } else {
        if (drain.steps > 0) s.mediaLastAt = Date.now();
        if (s.mediaError) console.log("[scheduler] photo queue is working again");
        s.mediaError = null;
      }
      if (drain.more) wait = 1_000;
    }
  } catch (e) {
    // Looked at every minute: said once, not every minute.
    if (s.mediaError !== messageOf(e)) console.error(`[scheduler] photo queue: ${messageOf(e)}`);
    s.mediaError = messageOf(e);
  } finally {
    setTimeout(() => void workMedia(), wait).unref();
  }
}

/** A supplier feed to cycle on — gsConfigured()'s test: its module loads only once a run needs it. */
const feedConnected = () => !!(env.GS_FEED_URL && env.GS_FEED_TOKEN);

/** The settings into the status: what the runs read, and /feeds shows. */
function applySettings(s: SchedulerState, settings: AutomationConfig): void {
  const sync = effectiveSync(settings, feedConnected());
  s.times = settings.dailyTimes;
  s.timeZone = settings.timeZone;
  s.feedsEveryMinutes = sync.feedsEveryMinutes;
  s.autoSync = sync.autoSync;
  s.autoSyncMax = settings.maxChanges;
  s.autoSyncStoreMax = settings.storeMaxChanges;
  s.ordersEveryMinutes = settings.ordersEveryMinutes;
  s.collectionsEveryMinutes = settings.collectionsEveryMinutes;
}

/** What the scheduler does, for the log. */
function describeSchedule(s: SchedulerStatus): string {
  const sync =
    s.autoSync === "all"
      ? `, store sync (${s.autoSyncStoreMax} changes a run, the rest at the next` +
        (s.feedsEveryMinutes > 0 ? "; the feed's products left to the feed cycle)" : ")")
      : "";
  const feedSync =
    s.autoSync === "off" ? "" : ` + store sync of the feed's products (a cycle past ${s.autoSyncMax} changes writes nothing)`;
  return (
    `daily sync at ${s.times.join(", ")} (${s.timeZone}): store pull, GS sync, KicksDB re-pricing${sync}; ` +
    (s.feedsEveryMinutes > 0 ? `feeds every ${s.feedsEveryMinutes} min${feedSync}; ` : "") +
    (s.ordersEveryMinutes > 0 ? `orders every ${s.ordersEveryMinutes} min` : "orders by hand only") +
    (s.collectionsEveryMinutes > 0 ? `; automatic categories every ${s.collectionsEveryMinutes} min` : "") +
    "; photo queue in the background"
  );
}

/**
 * New settings, saved on the Feeds tab: into the status, then the timers
 * they concern re-armed — the daily run on new times, the feed cycle on a new
 * interval (or started, or stopped), the loops likewise. The store sync's
 * reach and limits, self-repair and the heartbeats are read when used:
 * nothing to re-arm. In a process that does not run the scheduler, or before
 * its first timers are armed, only the status changes.
 */
function reconfigure(next: AutomationConfig): void {
  const s = store();
  const before = {
    times: s.times.join(","),
    timeZone: s.timeZone,
    feeds: s.feedsEveryMinutes,
    orders: s.ordersEveryMinutes,
    collections: s.collectionsEveryMinutes,
  };
  applySettings(s, next);
  if (!s.started || !timers().armed) return;
  const zone = before.timeZone !== s.timeZone;
  if (zone || before.times !== s.times.join(",")) rearmDaily();
  if (zone || before.feeds !== s.feedsEveryMinutes) rearmFeeds();
  if (before.orders !== s.ordersEveryMinutes) rearmLoop("orders");
  if (before.collections !== s.collectionsEveryMinutes) rearmLoop("collections");
  console.log(`[scheduler] settings changed — ${describeSchedule(s)}`);
}

export function startScheduler(): void {
  // The schedule, shown on /feeds even while the scheduler is off: the
  // settings as last read (their defaults before), kept current as they change.
  const s = store();
  applySettings(s, automationNow());
  const t = timers();
  if (!t.listening) {
    t.listening = true;
    onAutomationChange((next) => reconfigure(next));
  }

  const enabled =
    env.SCHEDULER === "on" || (env.SCHEDULER === undefined && process.env.NODE_ENV === "production");
  if (!enabled) return;
  // One writer per shop (src/server/writer.ts): this process serves, another one syncs.
  if (!isWriter()) {
    console.log("[scheduler] not started: HUB_ROLE=web — the writer process (HUB_ROLE=writer) runs the syncs");
    return;
  }

  // Dev hot-reload can re-run instrumentation; never double the timers.
  if (s.started) return;
  s.started = true;
  s.enabled = true;
  void begin(s);
}

/** The settings as stored, then the first timers on them. */
async function begin(s: SchedulerState): Promise<void> {
  try {
    applySettings(s, (await loadAutomation()).settings);
  } catch (e) {
    console.error(`[scheduler] settings unavailable (${messageOf(e)}): the defaults until they can be read`);
  }
  console.log(`[scheduler] on — ${describeSchedule(s)}`);
  timers().armed = true;
  void boot(s);
  if (s.feedsEveryMinutes > 0) armFeeds(new Date());
  if (s.ordersEveryMinutes > 0) armLoop("orders", CATCH_UP_DELAY_MS);
  setTimeout(() => void workMedia(), CATCH_UP_DELAY_MS).unref();
  if (s.collectionsEveryMinutes > 0) armLoop("collections", CATCH_UP_DELAY_MS);
}

/** What "Sincronizza ora" answers at once; the run itself goes on in the background (getSchedulerStatus().current). */
export type SyncNowAnswer =
  | { started: true; steps: SchedulerStep[] }
  | { started: false; reason: "running" | "not-writer" | "nothing" };

/**
 * The steps of a run by hand: the supplier feed and its products' prices and
 * stock, when a feed is connected; and with the KicksDB prices included in the
 * settings (dailyStoreSync), the re-pricing and the rest of the store too.
 * No store pull — the slowest step, and not needed: each product is read live
 * before its write — and no housekeeping: those are the daily run's.
 */
function manualSteps(settings: AutomationConfig): StepName[] {
  const steps: StepName[] = [];
  if (feedConnected()) steps.push("gs", ...(settings.autoPublish ? (["publish"] as const) : []), "feedSync");
  if (settings.dailyStoreSync && kicksdbConfigured()) steps.push("kicksdb", "storeSync");
  return steps;
}

/**
 * "Sincronizza ora": what the automatic sync does, now, started by a person —
 * so it writes even with the automatic store sync switched off, under the same
 * safety limits, and every write lands in the Sync tab's history as always.
 * Answers at once; the run goes on in the background, and its step and its
 * outcome are in the status (current, lastManual). Refused while another run
 * is going (the person follows that one), in a process that is not the
 * writer, and when this shop has nothing to sync.
 */
export function syncNow(): SyncNowAnswer {
  if (!isWriter()) return { started: false, reason: "not-writer" };
  const s = store();
  if (s.running) return { started: false, reason: "running" };
  const settings = automationNow();
  // The limits and the cycle as the settings say now (the listener keeps them so; a process
  // where the scheduler never started has only this).
  applySettings(s, settings);
  const steps = manualSteps(settings);
  if (steps.length === 0) return { started: false, reason: "nothing" };
  // run() marks itself running before its first await: a second press meets "running".
  void run({ kind: "manual", slot: new Date(), trigger: "manual", steps, attempt: 0 }).catch((e) =>
    console.error(`[scheduler] sync by hand crashed: ${messageOf(e)}`),
  );
  console.log(`[scheduler] sync started by hand: ${steps.map((step) => LABEL[step]).join(", ")}`);
  return { started: true, steps };
}
