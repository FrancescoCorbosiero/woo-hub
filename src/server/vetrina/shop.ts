import "server-only";
import { env } from "@/lib/env";
import { kicksdbConfigured } from "@/server/adapters/kicksdb";
import { loadAutomation, type AutomationState } from "@/server/automation/settings";
import { loadDockStatus } from "@/server/dock/status";
import {
  getSchedulerStatus,
  lastFinishedRun,
  lastManualRun,
  type SchedulerStatus,
  type SchedulerStep,
} from "@/server/scheduler";
import { wooConfigured } from "@/server/woo/client";

/**
 * The Vetrina's "Negozio" tab, read in one go: is the store connected, what
 * the sync is doing, when it last ran and runs next, what the last run by hand
 * did, the few settings the owner sets there, and what waits for them —
 * orders to fulfil, prices changed on WordPress, products to publish.
 *
 * Each part is the Hub's own: the scheduler's status and run history, the
 * Automatic sync settings, the dock's counts. Nothing here is a second copy.
 */

export interface ShopRun {
  /** "manual": started from this tab ("Sincronizza ora"); the others, by the schedule. */
  kind: "daily" | "feeds" | "manual";
  steps: SchedulerStep[];
  step: SchedulerStep | null;
  startedAt: number;
}

export interface ShopOverview {
  /** The store's REST keys are set: there is a store to sync. */
  woo: boolean;
  /** A supplier feed's API is set (GoldenSneakers). */
  feed: boolean;
  /** KicksDB is set: there are KicksDB prices. */
  kicksdb: boolean;
  /** This process runs the scheduled syncs (production; off in development). */
  scheduled: boolean;
  /** A run going now, by hand or on schedule; null when none is. */
  running: ShopRun | null;
  /** The last sync that ended, of any kind, and its failure if it failed. */
  last: { at: number; manual: boolean; error: string | null } | null;
  /** The next scheduled sync: the next feed cycle, else the next full sync; null when none is scheduled. */
  nextAt: number | null;
  /** What the last run by hand did, step by step. */
  lastManual: SchedulerStatus["lastManual"];
  automation: AutomationState;
  /** What waits for the owner; null where it could not be counted. */
  todo: { orders: number | null; storeEdits: number | null; toPublish: number | null };
  timeZone: string;
  /** When this was read: "today" and "tomorrow" are said from it, the same on the server and on the phone. */
  now: number;
}

/** The next sync the schedule has armed: the feed cycle's, sooner, when there is one. */
function nextOf(status: SchedulerStatus): number | null {
  if (!status.enabled) return null;
  const times = [status.feedsEveryMinutes > 0 ? status.feedsNextAt : null, status.nextRunAt].filter(
    (at): at is number => at != null,
  );
  return times.length > 0 ? Math.min(...times) : null;
}

export async function readShopOverview(): Promise<ShopOverview> {
  const status = getSchedulerStatus();
  const [automation, dock, last, manual] = await Promise.all([
    loadAutomation(),
    loadDockStatus(),
    lastFinishedRun().catch(() => null),
    // This process's own copy first: the scheduler keeps it when it runs here.
    status.lastManual ? Promise.resolve(status.lastManual) : lastManualRun().catch(() => null),
  ]);
  return {
    woo: wooConfigured(),
    // gsConfigured()'s test, without loading the feed's module for a read.
    feed: !!(env.GS_FEED_URL && env.GS_FEED_TOKEN),
    kicksdb: kicksdbConfigured(),
    scheduled: status.enabled,
    running: status.current ? { ...status.current, steps: [...status.current.steps] } : null,
    last: last ? { at: last.at, manual: last.trigger === "manual", error: last.error } : null,
    nextAt: nextOf(status),
    lastManual: manual,
    automation,
    todo: { orders: dock.openOrders, storeEdits: dock.storeEdits, toPublish: dock.toPublish },
    timeZone: automation.settings.timeZone,
    now: Date.now(),
  };
}
