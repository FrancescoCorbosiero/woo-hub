import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RailSummary } from "@/lib/vetrina/types";

/**
 * Proposals on the Vetrina's demo shop (VETRINA_SOURCE=fixture): what an
 * assistant or a script gets before anything is written, and what the
 * owner's yes runs — the real log, the real index. Opt-in, like every
 * *.db.test.ts: they need a THROWAWAY Postgres with the migrations applied,
 * and they empty vetrina_operations, vetrina_proposals, store_index and
 * smart_collections.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

vi.mock("@/lib/env", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/env")>();
  return { env: { ...real.env, VETRINA_SOURCE: "fixture" } };
});
vi.mock("@/server/collections/runner", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/collections/runner")>();
  return { ...real, requestCheck: () => undefined };
});

const load = async () => ({
  ...(await import("@/server/db/client")),
  ...(await import("@/server/db/schema")),
  ...(await import("@/server/collections/runner")),
  ...(await import("@/server/vetrina/catalog")),
  ...(await import("@/server/vetrina/fixture-source")),
  ...(await import("@/server/vetrina/source")),
  ...(await import("./proposals")),
  ...(await import("./service")),
  ...(await import("./runner")),
});

async function rails(): Promise<RailSummary[]> {
  const { fixtureSource } = await load();
  return (await fixtureSource().homepage()).blocks.flatMap((b) => (b.kind === "rail" ? [b.rail] : []));
}

/** The refusal a call ends with, and the data it carries. */
async function refusal(call: Promise<unknown>): Promise<{ code: string; message: string; data?: unknown }> {
  const { VetrinaError } = await load();
  try {
    await call;
  } catch (e) {
    if (e instanceof VetrinaError) return { code: e.code, message: e.message, data: e.data };
    throw e;
  }
  throw new Error("expected a refusal");
}

describe.skipIf(!enabled)("proposals on the demo shop", () => {
  beforeEach(async () => {
    const { db, vetrinaOperations, vetrinaProposals, storeIndex, smartCollections, forgetHomepagePresence, runFull } = await load();
    await db.delete(vetrinaOperations);
    await db.delete(vetrinaProposals);
    await db.delete(storeIndex);
    await db.delete(smartCollections);
    const g = globalThis as Record<string, unknown>;
    for (const key of ["__vetrinaDemo", "__vetrinaDemoTerms", "__vetrinaOperations", "__storeHubCollections"]) delete g[key];
    forgetHomepagePresence();
    await runFull();
  });

  it("previews a homepage action without writing it, and the owner's yes runs it — once", async () => {
    const { propose, confirmProposal, loadProposal } = await load();
    const [first] = await rails();
    const proposal = await propose({ kind: "sectionSwitch", key: first.key, on: false }, "assistant");
    expect(proposal).toMatchObject({ kind: "sectionSwitch", status: "open", via: "assistant", label: `«${first.title}» spenta sul sito` });
    expect(proposal.summary).toContain(`«${first.title}» resta nella homepage ma non si vede più sul sito.`);
    expect(new Date(proposal.expiresAt).getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect((await rails())[0].switchedOff).toBe(false);

    const operation = await confirmProposal(proposal.id);
    expect(operation).toMatchObject({ kind: "sectionSwitch", status: "done", via: "assistant", undoable: true });
    expect((await rails())[0].switchedOff).toBe(true);
    // Confirmed again — a retry, a double tap: the same action, not a second one.
    expect((await confirmProposal(proposal.id))?.id).toBe(operation!.id);
    expect(await loadProposal(proposal.id)).toMatchObject({ status: "confirmed", operationId: operation!.id });
  });

  it("runs a catalog action proposed and confirmed like one started from the screens", async () => {
    const { propose, confirmProposal, idle, loadOperation, demoShop } = await load();
    const p = demoShop().products.find((x) => x.visibility === "visible")!;
    const proposal = await propose({ kind: "hide", target: { kind: "ids", ids: [p.id] } }, "api");
    expect(proposal.preview.changes).toBe(1);
    expect(proposal.summary).toContain("Cambia 1 prodotto.");
    expect(p.visibility).toBe("visible");

    const started = await confirmProposal(proposal.id);
    await idle();
    expect(await loadOperation(started!.id)).toMatchObject({ status: "done", via: "api", changed: 1 });
    expect(p.visibility).toBe("hidden");
  });

  it("runs nothing when the shop changed since: a new proposal comes with the new preview", async () => {
    const { propose, confirmProposal, loadProposal, startPageOperation } = await load();
    const [a, , c] = await rails();
    const proposal = await propose({ kind: "sectionMove", key: c.key, position: 1 }, "assistant");
    expect(proposal.summary).toContain(`«${c.title}» passa dal 3° al 1° posto tra le sezioni.`);
    // Meanwhile, from the screens: the first section goes third — the proposed one is second now.
    await startPageOperation({ kind: "sectionMove", key: a.key, position: 3 });
    const before = (await rails()).map((r) => r.key);

    const refused = await refusal(confirmProposal(proposal.id));
    expect(refused.code).toBe("stale");
    const fresh = (refused.data as { proposal: { id: string; status: string; summary: string[] } }).proposal;
    expect(fresh).toMatchObject({ status: "open" });
    expect(fresh.summary).toContain(`«${c.title}» passa dal 2° al 1° posto tra le sezioni.`);
    expect((await rails()).map((r) => r.key)).toEqual(before);
    expect(await loadProposal(proposal.id)).toMatchObject({ status: "changed", replacedBy: fresh.id });
    // Asked again, the old one points to the new one.
    expect((await refusal(confirmProposal(proposal.id))).data).toMatchObject({ proposal: { id: fresh.id } });

    await confirmProposal(fresh.id);
    expect((await rails())[0].attrsHash).toBe(c.attrsHash);
  });

  it("ends a proposal that can no longer be done as asked, saying why", async () => {
    const { propose, confirmProposal, loadProposal, startPageOperation } = await load();
    const [first] = await rails();
    const proposal = await propose({ kind: "sectionSwitch", key: first.key, on: false }, "assistant");
    await startPageOperation({ kind: "sectionSwitch", key: first.key, on: false });

    expect((await refusal(confirmProposal(proposal.id))).message).toBe(`«${first.title}» è già spenta.`);
    expect(await loadProposal(proposal.id)).toMatchObject({ status: "refused" });
    expect((await refusal(confirmProposal(proposal.id))).message).toBe(`Non si può più fare come chiesto: «${first.title}» è già spenta.`);
  });

  it("lets a proposal expire", async () => {
    const { propose, confirmProposal, loadProposal, db, vetrinaProposals } = await load();
    const [first] = await rails();
    const proposal = await propose({ kind: "sectionSwitch", key: first.key, on: false }, "assistant");
    await db.update(vetrinaProposals).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await loadProposal(proposal.id)).toMatchObject({ status: "expired" });
    expect((await refusal(confirmProposal(proposal.id))).message).toBe("La proposta è scaduta (vale 15 minuti): chiedine una nuova.");
    expect((await rails())[0].switchedOff).toBe(false);
  });

  it("refuses to propose what could not run", async () => {
    const { propose, db, vetrinaProposals } = await load();
    const [first] = await rails();
    expect((await refusal(propose({ kind: "sectionSwitch", key: first.key, on: true }, "assistant"))).message).toBe(
      `«${first.title}» è già accesa.`,
    );
    expect((await refusal(propose({ kind: "nothingLikeThis" }, "assistant"))).message).toBe("Azione non valida.");
    expect(await db.select().from(vetrinaProposals)).toHaveLength(0);
  });
});
