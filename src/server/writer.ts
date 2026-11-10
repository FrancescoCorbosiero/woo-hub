import "server-only";
import { env } from "@/lib/env";

/**
 * One writer per shop (docs/deploy.md#one-writer-per-shop). The scheduler
 * (scheduler.ts), the catalog's actions (vetrina/operations/runner.ts), the
 * automatic categories (collections/runner.ts) and the Sync tab's live apply
 * (sync/apply-job.ts) keep their queues in the process: two processes
 * running them would write the same products from two queues — and each,
 * starting, would mark the other's running actions as cut off by a restart.
 *
 * HUB_ROLE names the process that runs them: "writer", the default (the one
 * app container); "web" for any other process on the same database (a
 * second app container, a script), which then refuses to start them rather
 * than become a second writer. Reads, previews, proposals and a homepage
 * write (one write the page itself checks) work in either.
 */

export const NOT_WRITER =
  "This process is not the shop's writer (HUB_ROLE=web): the actions, the scheduler, the automatic categories " +
  "and the live sync run only in the process that writes (HUB_ROLE=writer, the default).";

/** This process runs the background writers. */
export function isWriter(): boolean {
  return env.HUB_ROLE !== "web";
}

/** Refuse, in a process that is not the writer, before anything starts. */
export function assertWriter(): void {
  if (!isWriter()) throw new Error(NOT_WRITER);
}
