"use server";

import { z } from "zod";
import { checkAutomation, type AutomationDraft, type AutomationField } from "@/lib/automation";
import { loadAutomation, saveAutomation, type AutomationState } from "@/server/automation/settings";
import { getActiveConfig } from "@/server/config/repo";
import { signedInActor } from "./signed-in";
import { getSource, kicksdbConfigured } from "@/server/adapters/kicksdb";
import { countCatalog, countStale } from "@/server/catalog/repo";
import { refreshStaleCatalog } from "@/server/catalog/refresh";
import {
  accumulateIngestionRun,
  createIngestionRun,
  listIngestionRunsBySource,
  type IngestionHistoryEntry,
} from "@/server/ingestion/repo";

/**
 * The Feeds registry backend. Today there is one built-in feed — the KicksDB
 * staleness refresh — but every feed follows the same contract: yield products
 * for a market, ingest through the catalog pipeline, log to ingestion_runs
 * under a "feed:<name>" source. External feeds plug in beside it.
 */

// Not exported: "use server" modules may only export async functions.
const KICKSDB_FEED_SOURCE = "feed:kicksdb";

export interface GsFeedState {
  configured: boolean; // GS_FEED_URL + GS_FEED_TOKEN present
  activeSkus: number;
  activeRows: number;
  lastRuns: IngestionHistoryEntry[];
}

/** The Automatic sync settings, as the Feeds tab edits them. */
export interface AutomationView extends AutomationState {
  /** A supplier feed's API is set (GS_FEED_URL, GS_FEED_TOKEN): there is a feed cycle to run. */
  feedConnected: boolean;
  /** KicksDB is set (KICKS_SECRET): there are KicksDB prices for the daily sync to write. */
  kicksdbConnected: boolean;
}

export interface FeedsState {
  market: string;
  catalogTotal: number;
  staleCount: number;
  ttlSeconds: number;
  /** False on a supplier-feed-only instance: the KicksDB card is inert. */
  kicksdbConfigured: boolean;
  lastRuns: IngestionHistoryEntry[];
  gs: GsFeedState;
  scheduler: import("@/server/scheduler").SchedulerStatus;
  automation: AutomationView;
}

export async function getFeedsState(): Promise<FeedsState> {
  const { gsConfigured, GS_INGESTION_SOURCE } = await import("@/server/feeds/goldensneakers");
  const { feedStats, GS_FEED } = await import("@/server/feeds/repo");
  const { getSchedulerStatus } = await import("@/server/scheduler");

  const config = await getActiveConfig();
  const market = config.source.market;
  const ttl = config.source.cacheTtlSeconds;
  const [catalogTotal, staleCount, lastRuns, gsStats, gsRuns, automation] = await Promise.all([
    countCatalog(market),
    countStale(market, ttl),
    listIngestionRunsBySource(KICKSDB_FEED_SOURCE),
    feedStats(GS_FEED),
    listIngestionRunsBySource(GS_INGESTION_SOURCE),
    // Read now, not the copy of a minute ago: the screen shows what is saved.
    loadAutomation(),
  ]);
  return {
    market,
    catalogTotal,
    staleCount,
    ttlSeconds: ttl,
    kicksdbConfigured: kicksdbConfigured(),
    lastRuns,
    gs: {
      configured: gsConfigured(),
      activeSkus: gsStats.activeSkus,
      activeRows: gsStats.activeRows,
      lastRuns: gsRuns,
    },
    scheduler: getSchedulerStatus(),
    automation: { ...automation, feedConnected: gsConfigured(), kicksdbConnected: kicksdbConfigured() },
  };
}

export type SaveAutomationResult =
  | { ok: true; automation: AutomationView; scheduler: import("@/server/scheduler").SchedulerStatus }
  | { ok: false; invalid: AutomationField[]; error?: string };

/**
 * Save the Automatic sync settings, whole. The scheduler follows them at once
 * when it runs in this process, within a minute when it runs in another (the
 * writer, under a split deploy): no restart, no .env.
 */
export async function saveAutomationSettings(input: AutomationDraft): Promise<SaveAutomationResult> {
  const checked = checkAutomation(input);
  if (!checked.ok) return { ok: false, invalid: checked.invalid };
  try {
    const { gsConfigured } = await import("@/server/feeds/goldensneakers");
    const { getSchedulerStatus } = await import("@/server/scheduler");
    const state = await saveAutomation(checked.settings);
    const by = await signedInActor();
    console.log(`[settings] Automatic sync settings saved${by ? ` by ${by.name}` : ""}`);
    return {
      ok: true,
      automation: { ...state, feedConnected: gsConfigured(), kicksdbConnected: kicksdbConfigured() },
      scheduler: getSchedulerStatus(),
    };
  } catch (e) {
    return { ok: false, invalid: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export interface GsSyncActionResult {
  ok: boolean;
  error?: string;
  report?: {
    rows: number;
    skus: number;
    added: number;
    updated: number;
    deactivated: number;
    rejected: number;
    invalidBarcodes: number;
    duplicateBarcodes: number;
    catalogRegistered: number;
  };
}

/** Pull the whole GS flat assortment from their API and sync it. */
export async function runGsSyncFromApi(): Promise<GsSyncActionResult> {
  try {
    const { syncGoldenSneakersFromApi } = await import("@/server/feeds/goldensneakers");
    return { ok: true, report: await syncGoldenSneakersFromApi() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const GsBrowseSchema = z.object({
  q: z.string().optional(),
  page: z.number().int().min(1).default(1),
});

/** Browse the GS feed as products (the "what did the sync import?" table). */
export async function listGsFeed(input: z.infer<typeof GsBrowseSchema>): Promise<{
  ok: boolean;
  error?: string;
  page?: import("@/server/feeds/repo").FeedProductsPage;
}> {
  const parsed = GsBrowseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid input" };
  try {
    const { listFeedProductsPage, GS_FEED } = await import("@/server/feeds/repo");
    return {
      ok: true,
      page: await listFeedProductsPage(GS_FEED, { q: parsed.data.q, page: parsed.data.page }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const GsUploadSchema = z.object({ text: z.string().min(2) });

/** Sync from a manually uploaded/pasted GS JSON (API-less fallback). */
export async function uploadGsFeed(
  input: z.infer<typeof GsUploadSchema>,
): Promise<GsSyncActionResult> {
  const parsed = GsUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid input" };
  try {
    const { syncGoldenSneakers } = await import("@/server/feeds/goldensneakers");
    let payload: unknown;
    try {
      payload = JSON.parse(parsed.data.text);
    } catch {
      return { ok: false, error: "Not valid JSON." };
    }
    return { ok: true, report: await syncGoldenSneakers(payload) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const RunSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
  runId: z.uuid().optional(),
});

export interface FeedRunResult {
  ok: boolean;
  error?: string;
  runId?: string;
  requested?: number;
  refreshed?: number;
  missed?: number;
  remainingStale?: number;
}

/**
 * One round of the built-in KicksDB refresh feed: re-price up to `limit` of the
 * stalest entries. The client loops rounds (passing runId back) until
 * remainingStale is 0 — same accumulate-into-one-history-row pattern as import.
 */
export async function runKicksdbRefresh(
  input: z.infer<typeof RunSchema> = { limit: 100 },
): Promise<FeedRunResult> {
  const parsed = RunSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid input" };
  // Nothing to refresh on a supplier-feed-only instance: report an empty round
  // instead of hammering KicksDB with an absent key (and failing the cron).
  if (!kicksdbConfigured()) {
    return { ok: true, requested: 0, refreshed: 0, missed: 0, remainingStale: 0 };
  }

  const config = await getActiveConfig();
  const market = config.source.market;
  const ttl = config.source.cacheTtlSeconds;

  let runId = parsed.data.runId;
  try {
    runId = runId ?? (await createIngestionRun(KICKSDB_FEED_SOURCE, market));
  } catch {
    runId = undefined;
  }

  try {
    const source = getSource(config);
    const outcome = await refreshStaleCatalog(source, market, ttl, parsed.data.limit);
    if (runId) {
      // Feed-run semantics on the shared columns: known = refreshed entries,
      // rejected = stale SKUs the batch didn't return this round.
      await accumulateIngestionRun(runId, {
        requested: outcome.requested,
        added: 0,
        known: outcome.refreshed,
        rejected: outcome.missed,
      }).catch(() => {});
    }
    return {
      ok: true,
      runId,
      requested: outcome.requested,
      refreshed: outcome.refreshed,
      missed: outcome.missed,
      remainingStale: await countStale(market, ttl),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (runId) {
      await accumulateIngestionRun(
        runId,
        { requested: 0, added: 0, known: 0, rejected: 0 },
        message,
      ).catch(() => {});
    }
    return { ok: false, error: message, runId };
  }
}
