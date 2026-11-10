import "server-only";
import type { AutomationConfig } from "@core/config";
import { env } from "@/lib/env";
import {
  fromLegacyEnv,
  legacyEnvSet,
  resolveAutomation,
  sameAutomation,
  type AutomationField,
} from "@/lib/automation";

/**
 * The Automatic sync settings, as the processes of this shop read them.
 *
 * They are stored with the rest of the config (AppConfig.automation) and
 * edited on the Feeds tab. Every process keeps the last copy it read and
 * reads it again every minute (watchAutomation, started at boot), so a change
 * saved in one process — the screens' — reaches the scheduler in another
 * within a minute, and at once in the process that saved it. No restart: the
 * scheduler re-arms its timers when the copy changes (onAutomationChange).
 *
 * Until the owner first saves them, the defaults stand in, seeded by the
 * environment variables that used to hold these settings (src/lib/automation.ts).
 */

export interface AutomationState {
  settings: AutomationConfig;
  /** Saved in the Hub. False: the defaults, with the environment's former variables on top. */
  saved: boolean;
  /** Former variables still set in the environment — after the first save they do nothing, and can go. */
  legacyEnv: string[];
}

type Listener = (next: AutomationConfig, previous: AutomationConfig) => void;

interface Shared {
  current: AutomationState | null;
  listeners: Set<Listener>;
  watching: boolean;
  /** The last failed read, said once rather than every minute. */
  error: string | null;
  /** What the log was last told about the former variables and the stored values, said once. */
  told: string | null;
}

/** Re-read this often: the most a change saved elsewhere waits to reach the scheduler. */
const WATCH_MS = 60 * 1000;

// Instrumentation and the server-action bundle each get their own copy of
// this module; globalThis is the one store both see (as the scheduler's).
const g = globalThis as { __storeHubAutomation?: Shared };

function shared(): Shared {
  return (g.__storeHubAutomation ??= {
    current: null,
    listeners: new Set(),
    watching: false,
    error: null,
    told: null,
  });
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Before the first read: the defaults, seeded by the former variables. */
function unread(): AutomationState {
  const { settings, saved } = resolveAutomation(undefined, fromLegacyEnv(env));
  return { settings, saved, legacyEnv: legacyEnvSet(env) };
}

/**
 * The settings as this process last read them — before the first read, the
 * defaults seeded by the environment. Synchronous, for the readers that
 * cannot wait on the database: a sale's last day, a run's limit.
 */
export function automationNow(): AutomationConfig {
  return (shared().current ?? unread()).settings;
}

/** Read the stored settings, keep them, and tell the listeners when they changed. */
export async function loadAutomation(): Promise<AutomationState> {
  const { getActiveConfig } = await import("@/server/config/repo");
  const config = await getActiveConfig();
  const { settings, saved, dropped } = resolveAutomation(config.automation, fromLegacyEnv(env));
  const state: AutomationState = { settings, saved, legacyEnv: legacyEnvSet(env) };
  tell(state, dropped);
  keep(state);
  return state;
}

function keep(state: AutomationState): void {
  const sh = shared();
  const previous = (sh.current ?? unread()).settings;
  sh.current = state;
  if (sameAutomation(previous, state.settings)) return;
  for (const listener of sh.listeners) {
    try {
      listener(state.settings, previous);
    } catch (e) {
      console.error(`[settings] a listener failed on the new settings: ${messageOf(e)}`);
    }
  }
}

/** The log hears once what the environment still says, and about a stored value that could not be used. */
function tell(state: AutomationState, dropped: AutomationField[]): void {
  const sh = shared();
  const said = `${state.saved}|${state.legacyEnv.join(",")}|${dropped.join(",")}`;
  if (sh.told === said) return;
  sh.told = said;
  const names = state.legacyEnv.join(", ");
  if (state.legacyEnv.length > 0 && state.saved) {
    console.warn(
      `[settings] ${names} ${state.legacyEnv.length === 1 ? "is" : "are"} set in the environment but no longer read: ` +
        "the Automatic sync settings saved on the Feeds tab hold them now. Remove them from the .env file.",
    );
  } else if (state.legacyEnv.length > 0) {
    console.log(
      `[settings] ${names} from the environment: the Automatic sync settings' starting values, ` +
        "until they are saved on the Feeds tab (then the .env lines can go).",
    );
  }
  if (dropped.length > 0) {
    console.warn(`[settings] stored Automatic sync settings not usable, defaults used instead: ${dropped.join(", ")}`);
  }
}

/**
 * Save the settings whole (checked by the caller: src/lib/automation.ts's
 * checkAutomation), under the config's lock — a margin saved at the same
 * moment keeps its change — then read them back, which re-arms the scheduler
 * when it runs in this process. Answers what is now in force.
 */
export async function saveAutomation(settings: AutomationConfig): Promise<AutomationState> {
  const { updateActiveConfig } = await import("@/server/config/repo");
  await updateActiveConfig((current) => ({ ...current, automation: settings }));
  return loadAutomation();
}

/** Call `listener` whenever the settings this process reads change. Once per process: keep it registered for good. */
export function onAutomationChange(listener: Listener): void {
  shared().listeners.add(listener);
}

/**
 * Read the settings now and then every minute, for as long as the process
 * lives. Once per process. A failed read keeps the last copy (or the
 * defaults), says so once, and says when reads work again.
 */
export function watchAutomation(): void {
  const sh = shared();
  if (sh.watching) return;
  sh.watching = true;
  const round = async () => {
    try {
      await loadAutomation();
      if (sh.error) console.log("[settings] the stored settings can be read again");
      sh.error = null;
    } catch (e) {
      const message = messageOf(e);
      if (sh.error !== message) {
        console.error(`[settings] could not read the stored settings (${message}): the last ones read stay in force`);
      }
      sh.error = message;
    } finally {
      setTimeout(() => void round(), WATCH_MS).unref();
    }
  };
  void round();
}
