import "server-only";
import type { Homepage } from "@/lib/vetrina/types";
import { getVetrinaSource } from "./source";

/**
 * The homepage as the site last answered it, shared by every screen that
 * shows it: the Homepage tab, the catalog's "in homepage" marks, the "Metti
 * in homepage" sheet. One read costs the site a heavy request (every block,
 * every section's products), and the homepage changes rarely, so:
 *  - under a minute old, it is answered as it is;
 *  - older, it is answered at once while a new read runs behind it — but
 *    never past ten minutes: then the answer waits for the site;
 *  - our own changes (a section published, a block saved, an action that
 *    moves products) and ↻ forget it: the next answer waits for the site;
 *  - a read that failed is not tried again for half a minute, so a site that
 *    is down does not slow every screen.
 * Writes never use it: publishing reads the page again and refuses a change
 * made since (service.ts).
 */

export const HOME_FRESH_MS = 60_000;
export const HOME_STALE_MAX_MS = 10 * 60_000;
export const HOME_RETRY_MS = 30_000;

export interface HomepageCache {
  /** The homepage, from the last read when it is recent enough; `fresh` always asks the site. */
  get(opts?: { fresh?: boolean }): Promise<Homepage>;
  /** What the last good read saw, however old, or null before the first: for answers that must not wait. */
  last(): Homepage | null;
  /** The page changed (by us, or ↻ was tapped): the next answer reads it again. */
  forget(): void;
}

export function homepageCache(load: () => Promise<Homepage>, now: () => number = Date.now): HomepageCache {
  let settled: { home: Homepage; at: number; generation: number } | null = null;
  let flight: { promise: Promise<Homepage>; generation: number } | null = null;
  let failed: { error: unknown; at: number; generation: number } | null = null;
  // Bumped by every forget: a read started before it may have missed the change.
  let generation = 0;

  function read(): Promise<Homepage> {
    if (flight && flight.generation === generation) return flight.promise;
    const started = { at: now(), generation };
    const promise = load();
    const mine = { promise, generation: started.generation };
    flight = mine;
    promise
      .then(
        (home) => {
          if (started.generation !== generation) return;
          settled = { home, ...started };
          failed = null;
        },
        (error: unknown) => {
          if (started.generation === generation) failed = { error, at: now(), generation };
        },
      )
      .finally(() => {
        if (flight === mine) flight = null;
      });
    return promise;
  }

  const failedLately = () => failed != null && failed.generation === generation && now() - failed.at < HOME_RETRY_MS;

  return {
    async get({ fresh = false } = {}) {
      const age = settled && settled.generation === generation ? now() - settled.at : Infinity;
      if (!fresh && settled && age < HOME_FRESH_MS) return settled.home;
      if (!fresh && settled && age < HOME_STALE_MAX_MS) {
        if (!failedLately()) void read().catch(() => undefined);
        return settled.home;
      }
      if (!fresh && failed && failedLately()) throw failed.error;
      return read();
    },
    last: () => settled?.home ?? null,
    forget() {
      generation += 1;
      failed = null;
    },
  };
}

// One copy per process: the server actions and the scheduler's bundle each load their own copy of this module.
const g = globalThis as { __vetrinaHomepage?: HomepageCache };
const shared = () => (g.__vetrinaHomepage ??= homepageCache(async () => (await getVetrinaSource()).homepage()));

export const cachedHomepage = (opts?: { fresh?: boolean }) => shared().get(opts);
export const lastHomepage = () => shared().last();
export const forgetHomepage = () => shared().forget();
