import type { PublishActionResult } from "@/server/actions/publish";
import type { PublishOutcome } from "@/server/woo/publish";
import { FIRST_BATCH, nextBatchSize, nextPace } from "./publish-batching";

/**
 * A publish run from a screen: the products, a batch per request, each batch
 * sized from the shop's measured pace (publish-batching.ts) — the Hub's
 * Publish tab and the Vetrina's "Nuovi prodotti" run the same loop.
 *
 * Through a plain request (the route each screen names), not the server
 * action: an action in flight holds every page change behind it, and a run is
 * batch after batch of them. A batch the proxy in front stopped waiting for is
 * most likely being finished on the server; the run moves on — publishing it
 * again later is safe, the ones created by then are skipped — and stops only
 * after MAX_PROXY_FAILURES of those in a row.
 */

/** Answers from the proxy in front, not the app: it stopped waiting. */
export const PROXY_GAVE_UP: ReadonlySet<number> = new Set([502, 503, 504, 520, 522, 524]);
/** Such answers in a row before a run stops: the server itself is in trouble. */
export const MAX_PROXY_FAILURES = 3;

/** The server answered with something that is not the route's JSON (a sign-in page, a proxy's error). */
export class UnexpectedResponse extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

export interface PublishBatchInput {
  skus: string[];
  dryRun: boolean;
  includeGallery: boolean;
  force: boolean;
  replaceMedia: boolean;
}

/** One batch through the screen's publish route. */
export async function publishBatch(url: string, input: PublishBatchInput): Promise<PublishActionResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  // A sign-in that expired mid-run answers with the sign-in page, not JSON.
  if (!res.headers.get("content-type")?.includes("application/json")) {
    throw new UnexpectedResponse(res.status);
  }
  return (await res.json()) as PublishActionResult;
}

/** Two batches' outcomes as one run's. */
export function mergeOutcomes(a: PublishOutcome, b: PublishOutcome): PublishOutcome {
  return {
    ...a,
    status: b.status === "failed" || a.status === "failed" ? "failed" : a.status,
    products: [...a.products, ...b.products],
    created: a.created + b.created,
    reimported: a.reimported + b.reimported,
    completed: a.completed + b.completed,
    variations: a.variations + b.variations,
    skipped: a.skipped + b.skipped,
    failed: a.failed + b.failed,
  };
}

export interface PublishRunHooks {
  /** Before each batch: how far, and the time left at the pace so far (null until there is one). */
  progress?: (at: { done: number; total: number; msLeft: number | null }) => void;
  /** After each batch: the run's outcome so far. */
  outcome?: (merged: PublishOutcome) => void;
  /** Products of batches the proxy stopped waiting for, so far. */
  unanswered?: (count: number) => void;
  /** Asked before each batch: stop here. */
  stop?: () => boolean;
}

export interface PublishRunEnd {
  merged: PublishOutcome | null;
  /** Stopped by the person, after `done` of `total`. */
  stopped: { done: number; total: number } | null;
  /** Why the run ended early: the proxy gave up too often, an answer that was not ours, a refusal or a failure. */
  error: { kind: "proxy"; status: number } | { kind: "unexpected"; status: number } | { kind: "failed"; message: string | null } | null;
}

export async function runPublishBatches(
  url: string,
  skus: readonly string[],
  options: Omit<PublishBatchInput, "skus">,
  hooks: PublishRunHooks = {},
): Promise<PublishRunEnd> {
  let merged: PublishOutcome | null = null;
  let lost = 0;
  let proxyFailures = 0;
  let size = FIRST_BATCH;
  let pace: number | null = null; // ms per product, smoothed
  try {
    for (let i = 0; i < skus.length; ) {
      if (hooks.stop?.()) return { merged, stopped: { done: i, total: skus.length }, error: null };
      const batch = skus.slice(i, i + size);
      hooks.progress?.({ done: i, total: skus.length, msLeft: pace == null ? null : (skus.length - i) * pace });
      const started = performance.now();
      let res: PublishActionResult;
      try {
        res = await publishBatch(url, { ...options, skus: batch });
      } catch (e) {
        if (!(e instanceof UnexpectedResponse) || !PROXY_GAVE_UP.has(e.status)) throw e;
        // Most likely being finished on the server right now: on to the next batch.
        lost += batch.length;
        hooks.unanswered?.(lost);
        if (++proxyFailures >= MAX_PROXY_FAILURES) return { merged, stopped: null, error: { kind: "proxy", status: e.status } };
        // The time the proxy waited counts as this batch's pace: the next one comes out smaller.
        pace = nextPace(pace, performance.now() - started, batch.length);
        size = nextBatchSize(size, pace);
        i += batch.length;
        continue;
      }
      proxyFailures = 0;
      pace = nextPace(pace, performance.now() - started, batch.length);
      size = nextBatchSize(size, pace);
      i += batch.length;
      if (!res.ok || !res.outcome) return { merged, stopped: null, error: { kind: "failed", message: res.error ?? null } };
      merged = merged ? mergeOutcomes(merged, res.outcome) : res.outcome;
      hooks.outcome?.(merged);
    }
  } catch (e) {
    return {
      merged,
      stopped: null,
      error:
        e instanceof UnexpectedResponse
          ? { kind: "unexpected", status: e.status }
          : { kind: "failed", message: e instanceof Error ? e.message : null },
    };
  }
  return { merged, stopped: null, error: null };
}
