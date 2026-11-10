import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getApplyJob, runningApplyJob, startApplyJob, type ApplyProgress } from "./apply-job";
import type { ApplyOutcome } from "@/server/woo/apply";

// Which process this is (HUB_ROLE, src/server/writer.ts): the writer unless a test says otherwise.
const env = vi.hoisted(() => ({ HUB_ROLE: undefined as "writer" | "web" | undefined }));
vi.mock("@/lib/env", () => ({ env }));

const outcome = { auditId: "a1", dryRun: false, status: "applied", updated: 3 } as ApplyOutcome;

/** A stand-in apply the test finishes by hand. */
function deferred() {
  let progress!: ApplyProgress;
  let resolve!: (o: ApplyOutcome) => void;
  let reject!: (e: unknown) => void;
  const run = (p: ApplyProgress) => {
    progress = p;
    return new Promise<ApplyOutcome>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  };
  return { run, progress: (d: number, t: number) => progress(d, t), resolve: (o: ApplyOutcome) => resolve(o), reject: (e: unknown) => reject(e) };
}

/** Let the job's promise chain settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the Sync tab's live apply, in the background", () => {
  beforeEach(() => {
    delete (globalThis as { __storeHubApplyJobs?: unknown }).__storeHubApplyJobs;
    env.HUB_ROLE = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("answers at once with a running job, and reports its progress as it writes", async () => {
    const apply = deferred();
    const job = startApplyJob(apply.run)!;
    expect(job).toMatchObject({ status: "running", done: 0, total: null, outcome: null });
    expect(runningApplyJob()?.id).toBe(job.id);

    await settle();
    apply.progress(0, 40);
    expect(getApplyJob(job.id)).toMatchObject({ done: 0, total: 40 });
    apply.progress(12, 40);
    expect(getApplyJob(job.id)).toMatchObject({ status: "running", done: 12, total: 40 });

    apply.resolve(outcome);
    await settle();
    expect(getApplyJob(job.id)).toMatchObject({ status: "done", outcome, error: null });
    expect(getApplyJob(job.id)?.finishedAt).not.toBeNull();
    expect(runningApplyJob()).toBeNull();
  });

  it("one at a time: a second apply is refused while the first writes", async () => {
    const first = deferred();
    const job = startApplyJob(first.run)!;
    const second = vi.fn(deferred().run);
    expect(startApplyJob(second)).toBeNull();
    await settle();
    expect(second).not.toHaveBeenCalled();

    first.resolve(outcome);
    await settle();
    const next = startApplyJob(deferred().run);
    expect(next).not.toBeNull();
    expect(next!.id).not.toBe(job.id);
  });

  it("an apply that throws ends the job failed, with the reason the database gave", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const apply = deferred();
    const job = startApplyJob(apply.run)!;
    await settle();
    apply.reject(new Error("Failed query: update apply_audit", { cause: new Error("connection terminated") }));
    await settle();
    expect(getApplyJob(job.id)).toMatchObject({ status: "failed", error: "connection terminated", outcome: null });
    expect(runningApplyJob()).toBeNull();
  });

  it("the tab reads what it is sent, never the job the apply writes to", async () => {
    const apply = deferred();
    const job = startApplyJob(apply.run)!;
    await settle();
    apply.progress(5, 10);
    expect(job.done).toBe(0);
    const read = getApplyJob(job.id)!;
    read.status = "failed";
    expect(getApplyJob(job.id)?.status).toBe("running");
  });

  it("starts only in the writer process: a second process on the same database never writes", async () => {
    env.HUB_ROLE = "web";
    const apply = vi.fn(deferred().run);
    expect(() => startApplyJob(apply)).toThrow(/HUB_ROLE=web/);
    await settle();
    expect(apply).not.toHaveBeenCalled();
    expect(runningApplyJob()).toBeNull();

    env.HUB_ROLE = "writer";
    expect(startApplyJob(deferred().run)).toMatchObject({ status: "running" });
  });

  it("an unknown job reads as gone (the server restarted), and a finished one is forgotten after an hour", async () => {
    expect(getApplyJob("00000000-0000-4000-8000-000000000000")).toBeNull();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    const apply = deferred();
    const job = startApplyJob(apply.run)!;
    await settle();
    apply.resolve(outcome);
    await settle();

    vi.setSystemTime(new Date("2026-10-12T10:59:00Z"));
    expect(getApplyJob(job.id)?.status).toBe("done");
    vi.setSystemTime(new Date("2026-10-12T11:01:00Z"));
    expect(getApplyJob(job.id)).toBeNull();
  });
});
