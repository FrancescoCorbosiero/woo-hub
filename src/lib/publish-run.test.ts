import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublishOutcome } from "@/server/woo/publish";
import { FIRST_BATCH } from "./publish-batching";
import { runPublishBatches } from "./publish-run";

/** An outcome that created every SKU it was given. */
const created = (skus: string[]): PublishOutcome =>
  ({
    auditId: "a",
    identitySkipped: [],
    dryRun: false,
    status: "applied",
    products: skus.map((sku) => ({ sku, title: sku, action: "create" })),
    created: skus.length,
    reimported: 0,
    completed: 0,
    variations: skus.length * 2,
    skipped: 0,
    failed: 0,
  }) as unknown as PublishOutcome;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** The route, answering each batch with `answer` (its SKUs in, a Response out). */
function route(answer: (skus: string[], call: number) => Response) {
  let call = 0;
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => answer(JSON.parse(String(init?.body)).skus, call++));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const skus = Array.from({ length: 20 }, (_, i) => `SKU-${i}`);
const options = { dryRun: false, includeGallery: false, force: false, replaceMedia: false };

describe("a publish run, batch by batch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("publishes everything through the screen's route, the first batch small, the outcomes merged", async () => {
    const fetch = route((batch) => json({ ok: true, outcome: created(batch) }));
    const progress: number[] = [];
    const end = await runPublishBatches("/vetrina/negozio/nuovi/pubblica", skus, options, {
      progress: (at) => progress.push(at.done),
    });
    expect(end.error).toBeNull();
    expect(end.merged?.created).toBe(20);
    expect(end.merged?.products.map((p) => p.sku)).toEqual(skus);
    expect(fetch.mock.calls[0][0]).toBe("/vetrina/negozio/nuovi/pubblica");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).skus).toHaveLength(FIRST_BATCH);
    expect(progress[0]).toBe(0);
  });

  it("moves past a batch the proxy stopped waiting for, and stops after three in a row", async () => {
    const lost: number[] = [];
    route((batch, call) => (call === 0 ? new Response("gateway", { status: 524 }) : json({ ok: true, outcome: created(batch) })));
    const once = await runPublishBatches("/r", skus, options, { unanswered: (n) => lost.push(n) });
    expect(once.error).toBeNull();
    expect(lost).toEqual([FIRST_BATCH]);
    expect(once.merged?.created).toBe(20 - FIRST_BATCH);

    route(() => new Response("gateway", { status: 524 }));
    const thrice = await runPublishBatches("/r", skus, options);
    expect(thrice.error).toEqual({ kind: "proxy", status: 524 });
  });

  it("stops between batches when asked, and says how far it got", async () => {
    route((batch) => json({ ok: true, outcome: created(batch) }));
    let batches = 0;
    const end = await runPublishBatches("/r", skus, options, { outcome: () => batches++, stop: () => batches >= 1 });
    expect(end.stopped).toEqual({ done: FIRST_BATCH, total: 20 });
    expect(end.merged?.created).toBe(FIRST_BATCH);
  });

  it("ends on a refusal, and on an answer that is not the route's", async () => {
    route(() => json({ ok: false, error: "skus: too many" }));
    expect((await runPublishBatches("/r", skus, options)).error).toEqual({ kind: "failed", message: "skus: too many" });
    route(() => new Response("<html>sign in</html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await runPublishBatches("/r", skus, options)).error).toEqual({ kind: "unexpected", status: 200 });
  });
});
