import { z } from "zod";
import type { AutomationConfig } from "@core/config";
import { DEFAULT_FEEDS_MINUTES, DEFAULT_TIMEZONE, isTimeZone, parseTimes } from "./schedule";

/**
 * The Automatic sync settings (AutomationConfig, core/config.ts): their
 * defaults, their bounds, and where they come from before the owner first
 * saves them. Pure — the scheduler's side reads them through
 * src/server/automation/settings.ts, the Feeds tab edits them.
 *
 * They used to be environment variables, a dozen of them, edited by hand in
 * the deploy's .env. Those variables are now only the STARTING values: read
 * while nothing is saved, ignored from the first save on (LEGACY_AUTOMATION_ENV).
 */

/** The bounds the Feeds tab's fields keep to, and the save checks. */
export const AUTOMATION_LIMITS = {
  /** A feed cycle: at least every 5 minutes (the supplier's API), at most twice a day. */
  feedsEveryMinutes: { min: 5, max: 720 },
  /** 0 = by hand only. */
  ordersEveryMinutes: { min: 0, max: 1440 },
  /** 0 = with the daily sync only. */
  collectionsEveryMinutes: { min: 0, max: 1440 },
  /** Variations or products: the safety limits. */
  changes: { min: 1, max: 1_000_000 },
  /** Times of day of the daily sync. */
  dailyTimes: { min: 1, max: 24 },
} as const;

export const DEFAULT_AUTOMATION: AutomationConfig = {
  storeSync: true,
  feedsEveryMinutes: DEFAULT_FEEDS_MINUTES,
  dailyStoreSync: false,
  dailyTimes: ["04:30"],
  timeZone: DEFAULT_TIMEZONE,
  maxChanges: 500,
  storeMaxChanges: 500,
  ordersEveryMinutes: 15,
  collectionsEveryMinutes: 5,
  collectionsMaxChanges: 200,
  autoRepair: false,
  heartbeatUrl: null,
  feedsHeartbeatUrl: null,
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const L = AUTOMATION_LIMITS;
const minutes = (range: { min: number; max: number }) => z.number().int().min(range.min).max(range.max);
const changes = minutes(L.changes);
/** A monitor's ping URL; blank is none. */
const pingUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v),
  z.url({ protocol: /^https?$/ }).max(2000).nullable(),
);

/** Every setting, checked: what a save must pass, field by field. */
export const AutomationSchema = z.object({
  storeSync: z.boolean(),
  feedsEveryMinutes: minutes(L.feedsEveryMinutes),
  dailyStoreSync: z.boolean(),
  // In order and once each, as the scheduler reads them.
  dailyTimes: z
    .array(z.string().trim().regex(TIME))
    .min(L.dailyTimes.min)
    .max(L.dailyTimes.max)
    .transform((times) => parseTimes(times.join(","))),
  timeZone: z.string().trim().refine((v) => isTimeZone(v)),
  maxChanges: changes,
  storeMaxChanges: changes,
  ordersEveryMinutes: minutes(L.ordersEveryMinutes),
  collectionsEveryMinutes: minutes(L.collectionsEveryMinutes),
  collectionsMaxChanges: changes,
  autoRepair: z.boolean(),
  heartbeatUrl: pingUrl,
  feedsHeartbeatUrl: pingUrl,
});

export type AutomationField = keyof AutomationConfig;

/** What the Feeds tab sends: the settings as typed, a blank or unreadable number as null — the check names the field. */
export type AutomationDraft = { [K in AutomationField]: AutomationConfig[K] | null };

const FIELDS = Object.keys(DEFAULT_AUTOMATION) as AutomationField[];

/**
 * Check a whole set of settings, as the Feeds tab saves it: the settings,
 * normalized (times in order, blank URLs as none), or the fields that are wrong.
 */
export function checkAutomation(
  input: unknown,
): { ok: true; settings: AutomationConfig } | { ok: false; invalid: AutomationField[] } {
  const parsed = AutomationSchema.safeParse(input);
  if (parsed.success) return { ok: true, settings: parsed.data };
  const invalid = new Set<AutomationField>();
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && (FIELDS as string[]).includes(field)) invalid.add(field as AutomationField);
  }
  // A wrong shape with no field to point at (not an object at all): every field.
  return { ok: false, invalid: invalid.size > 0 ? [...invalid] : FIELDS };
}

/**
 * The fields of a stored (or seeded) set that hold a valid value, each on
 * its own: one bad value — a hand-edited row, a shape from an older version —
 * falls back to its default and takes nothing else with it.
 */
export function sanitizeAutomation(stored: unknown): { values: Partial<AutomationConfig>; dropped: AutomationField[] } {
  const values: Partial<AutomationConfig> = {};
  const dropped: AutomationField[] = [];
  if (stored == null || typeof stored !== "object") return { values, dropped };
  const record = stored as Record<string, unknown>;
  for (const field of FIELDS) {
    if (record[field] === undefined) continue;
    const parsed = AutomationSchema.shape[field].safeParse(record[field]);
    if (parsed.success) (values as Record<string, unknown>)[field] = parsed.data;
    else dropped.push(field);
  }
  return { values, dropped };
}

/**
 * The settings in force: the saved ones — whole, the environment no longer
 * consulted — or, while nothing is saved, the defaults with whatever the
 * former variables still say on top. `saved` tells the two apart.
 */
export function resolveAutomation(
  stored: unknown,
  legacy: Partial<AutomationConfig>,
): { settings: AutomationConfig; saved: boolean; dropped: AutomationField[] } {
  if (stored != null && typeof stored === "object") {
    const { values, dropped } = sanitizeAutomation(stored);
    return { settings: { ...DEFAULT_AUTOMATION, ...values }, saved: true, dropped };
  }
  return { settings: { ...DEFAULT_AUTOMATION, ...sanitizeAutomation(legacy).values }, saved: false, dropped: [] };
}

/* ------------------------------------------------------------------ */
/* The former environment variables                                    */
/* ------------------------------------------------------------------ */

/**
 * The variables these settings used to be. Still read — the starting values
 * of a deploy that set them — until the first save; never after.
 */
export const LEGACY_AUTOMATION_ENV = [
  "AUTO_SYNC",
  "SCHEDULER_FEEDS_MINUTES",
  "SCHEDULER_TIMES",
  "SCHEDULER_TIMEZONE",
  "AUTO_SYNC_MAX_CHANGES",
  "AUTO_SYNC_STORE_MAX_CHANGES",
  "SCHEDULER_ORDERS_MINUTES",
  "SCHEDULER_COLLECTIONS_MINUTES",
  "COLLECTIONS_MAX_CHANGES",
  "AUTO_REPAIR",
  "SCHEDULER_HEARTBEAT_URL",
  "SCHEDULER_FEEDS_HEARTBEAT_URL",
] as const;

/** Those variables as src/lib/env.ts reads them (validated there, at boot). */
export interface LegacyAutomationEnv {
  AUTO_SYNC?: "on" | "off";
  SCHEDULER_FEEDS_MINUTES?: number;
  SCHEDULER_TIMES?: string;
  SCHEDULER_TIMEZONE?: string;
  AUTO_SYNC_MAX_CHANGES?: number;
  AUTO_SYNC_STORE_MAX_CHANGES?: number;
  SCHEDULER_ORDERS_MINUTES?: number;
  SCHEDULER_COLLECTIONS_MINUTES?: number;
  COLLECTIONS_MAX_CHANGES?: number;
  AUTO_REPAIR?: "on" | "off";
  SCHEDULER_HEARTBEAT_URL?: string;
  SCHEDULER_FEEDS_HEARTBEAT_URL?: string;
}

/** The former variables that are set: what the Feeds tab lists as safe to remove. */
export function legacyEnvSet(env: LegacyAutomationEnv): string[] {
  return LEGACY_AUTOMATION_ENV.filter((name) => env[name] !== undefined);
}

/**
 * What the former variables said, as settings: only what they set. Their old
 * meanings, mapped —
 *  - AUTO_SYNC=off wrote nothing unattended, and SCHEDULER_FEEDS_MINUTES=0
 *    with AUTO_SYNC unset had no cycle and wrote nothing: both are the store
 *    sync off. AUTO_SYNC=on is the store sync on, the rest of the store
 *    included (the daily sync's KicksDB prices);
 *  - AUTO_SYNC_STORE_MAX_CHANGES defaulted to AUTO_SYNC_MAX_CHANGES.
 */
export function fromLegacyEnv(env: LegacyAutomationEnv): Partial<AutomationConfig> {
  const out: Partial<AutomationConfig> = {};
  if (env.AUTO_SYNC === "on") {
    out.storeSync = true;
    out.dailyStoreSync = true;
  } else if (env.AUTO_SYNC === "off" || env.SCHEDULER_FEEDS_MINUTES === 0) {
    out.storeSync = false;
  }
  if (env.SCHEDULER_FEEDS_MINUTES) out.feedsEveryMinutes = env.SCHEDULER_FEEDS_MINUTES;
  if (env.SCHEDULER_TIMES !== undefined) {
    try {
      out.dailyTimes = parseTimes(env.SCHEDULER_TIMES);
    } catch {
      // Checked at boot (env.ts): never reached with a value that got that far.
    }
  }
  if (env.SCHEDULER_TIMEZONE !== undefined) out.timeZone = env.SCHEDULER_TIMEZONE;
  if (env.AUTO_SYNC_MAX_CHANGES !== undefined) out.maxChanges = env.AUTO_SYNC_MAX_CHANGES;
  const storeMax = env.AUTO_SYNC_STORE_MAX_CHANGES ?? env.AUTO_SYNC_MAX_CHANGES;
  if (storeMax !== undefined) out.storeMaxChanges = storeMax;
  if (env.SCHEDULER_ORDERS_MINUTES !== undefined) out.ordersEveryMinutes = env.SCHEDULER_ORDERS_MINUTES;
  if (env.SCHEDULER_COLLECTIONS_MINUTES !== undefined) out.collectionsEveryMinutes = env.SCHEDULER_COLLECTIONS_MINUTES;
  if (env.COLLECTIONS_MAX_CHANGES !== undefined) out.collectionsMaxChanges = env.COLLECTIONS_MAX_CHANGES;
  if (env.AUTO_REPAIR !== undefined) out.autoRepair = env.AUTO_REPAIR === "on";
  if (env.SCHEDULER_HEARTBEAT_URL !== undefined) out.heartbeatUrl = env.SCHEDULER_HEARTBEAT_URL;
  if (env.SCHEDULER_FEEDS_HEARTBEAT_URL !== undefined) out.feedsHeartbeatUrl = env.SCHEDULER_FEEDS_HEARTBEAT_URL;
  return out;
}

/** Two sets of settings say the same. */
export function sameAutomation(a: AutomationConfig, b: AutomationConfig): boolean {
  return FIELDS.every((field) => JSON.stringify(a[field]) === JSON.stringify(b[field]));
}
