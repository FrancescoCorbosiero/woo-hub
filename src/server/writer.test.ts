import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WooClient } from "@/server/woo/client";

/**
 * One writer per shop (writer.ts): in a process that is not the writer
 * (HUB_ROLE=web), none of the background writers starts — the scheduler, the
 * catalog's actions, the automatic categories (the live apply: apply-job.test.ts)
 * — and nothing there marks the writer's running actions as cut off.
 */
const env = vi.hoisted(() => ({ HUB_ROLE: "web" as "writer" | "web" | undefined, SCHEDULER: "on" as const }));
vi.mock("@/lib/env", () => ({ env }));
const repo = vi.hoisted(() => ({ markInterrupted: vi.fn(async () => 0), getOperation: vi.fn(async () => null) }));
vi.mock("@/server/vetrina/operations/repo", () => repo);

const client = {} as WooClient;

describe("a process that is not the writer", () => {
  beforeEach(() => {
    env.HUB_ROLE = "web";
    const g = globalThis as Record<string, unknown>;
    for (const key of ["__vetrinaOperations", "__storeHubCollections", "__storeHubScheduler"]) delete g[key];
    repo.markInterrupted.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("is any process that says HUB_ROLE=web; the default is the writer", async () => {
    const { isWriter } = await import("./writer");
    expect(isWriter()).toBe(false);
    env.HUB_ROLE = undefined;
    expect(isWriter()).toBe(true);
    env.HUB_ROLE = "writer";
    expect(isWriter()).toBe(true);
  });

  it("leaves the actions' log alone at its start, and queues no action, undo or sweep", async () => {
    const runner = await import("./vetrina/operations/runner");
    await runner.recover();
    expect(repo.markInterrupted).not.toHaveBeenCalled();
    expect(() => runner.queueRun("00000000-0000-4000-8000-000000000001")).toThrow(/HUB_ROLE=web/);
    expect(() => runner.queueUndo("00000000-0000-4000-8000-000000000001", { status: "done", done: 1, total: 1 })).toThrow(
      /HUB_ROLE=web/,
    );
    await runner.queueSweep();
    expect(runner.isQueued("sweep")).toBe(false);
  });

  it("runs no automatic categories: a run refused, a request left to the writer, no write through the queue", async () => {
    const collections = await import("./collections/runner");
    await expect(collections.runCheck({ client })).rejects.toThrow(/HUB_ROLE=web/);
    await expect(collections.runFull({ client })).rejects.toThrow(/HUB_ROLE=web/);
    collections.requestCheck();
    collections.requestFullRead();
    collections.requestApply("c1");
    expect(collections.getRunnerStatus()).toMatchObject({ running: null, queued: [] });
    const write = vi.fn(async () => "written");
    await expect(collections.queueProductWrite(write)).rejects.toThrow(/HUB_ROLE=web/);
    expect(write).not.toHaveBeenCalled();
    // Refused before a tag is made on the store.
    await expect(collections.setProductTags(1, [{ name: "Nuovo" }], { client })).rejects.toThrow(/HUB_ROLE=web/);
  });

  it("does not start the scheduler, even with SCHEDULER=on", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { getSchedulerStatus, startScheduler } = await import("./scheduler");
    startScheduler();
    expect(getSchedulerStatus().enabled).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/not started: HUB_ROLE=web/));
  });

  it("in the writer, the same queue runs what it is given", async () => {
    env.HUB_ROLE = "writer";
    const collections = await import("./collections/runner");
    await expect(collections.queueProductWrite(async () => "written")).resolves.toBe("written");
  });
});
