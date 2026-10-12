import "server-only";
import { randomUUID } from "node:crypto";
import type { ApplyOutcome } from "@/server/woo/apply";

/**
 * The Sync tab's live apply, run in the background.
 *
 * A whole-store apply writes for many minutes — a product at a time, three at
 * once — and behind Cloudflare a request that takes over 100 seconds gets a
 * 524. The browser lost the answer while the server went on writing: the
 * button came back as if nothing had happened, and only the history said
 * otherwise. The apply now runs here, in the server process, and the tab asks
 * how it is going every few seconds: short requests, however long the apply.
 *
 * One at a time: a second apply would be planned against the snapshot the
 * first is still writing. Kept in the process, like the scheduler's state: a
 * restart loses the job, and the history (apply_audit) says what it wrote.
 */

export interface ApplyJob {
  id: string;
  status: "running" | "done" | "failed";
  /** Products written so far… */
  done: number;
  /** …of this many; null until the apply has planned them. */
  total: number | null;
  outcome: ApplyOutcome | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export type ApplyProgress = (done: number, total: number) => void;

/** A finished job is kept this long: a tab that was away reads how it ended. */
const KEEP_MS = 60 * 60 * 1000;

// Instrumentation and the server-action bundle each get their own copy of
// this module; globalThis is the one store both see.
const g = globalThis as { __storeHubApplyJobs?: Map<string, ApplyJob> };
const jobs = () => (g.__storeHubApplyJobs ??= new Map());

/** A copy: what the tab receives is never the object the apply writes to. */
const view = (job: ApplyJob): ApplyJob => ({ ...job });

function messageOf(e: unknown): string {
  const cause = (e as { cause?: { message?: string } })?.cause;
  return cause?.message ?? (e instanceof Error ? e.message : String(e));
}

function prune(now: number): void {
  for (const [id, job] of jobs()) {
    if (job.finishedAt != null && now - job.finishedAt > KEEP_MS) jobs().delete(id);
  }
}

/** The apply writing now, if any. */
export function runningApplyJob(): ApplyJob | null {
  for (const job of jobs().values()) if (job.status === "running") return view(job);
  return null;
}

/** A job by id; null once forgotten, or when the server has restarted since. */
export function getApplyJob(id: string): ApplyJob | null {
  prune(Date.now());
  const job = jobs().get(id);
  return job ? view(job) : null;
}

/**
 * Start `run` in the background and answer at once with its job. Null while
 * another apply is running: the caller says so rather than start a second.
 */
export function startApplyJob(run: (progress: ApplyProgress) => Promise<ApplyOutcome>): ApplyJob | null {
  prune(Date.now());
  if (runningApplyJob()) return null;
  const job: ApplyJob = {
    id: randomUUID(),
    status: "running",
    done: 0,
    total: null,
    outcome: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  jobs().set(job.id, job);
  void Promise.resolve()
    .then(() =>
      run((done, total) => {
        job.done = done;
        job.total = total;
      }),
    )
    .then(
      (outcome) => {
        job.outcome = outcome;
        job.status = "done";
        job.finishedAt = Date.now();
      },
      (e: unknown) => {
        job.error = messageOf(e);
        job.status = "failed";
        job.finishedAt = Date.now();
        console.error(`[sync] apply ${job.id} failed: ${job.error}`);
      },
    );
  return view(job);
}
