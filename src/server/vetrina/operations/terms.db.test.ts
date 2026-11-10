import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationInput, OperationView } from "@/lib/vetrina/catalog-ops";
import type { Actor } from "@/lib/actors";

/**
 * The store's taxonomies managed from the Hub, on the demo shop
 * (VETRINA_SOURCE=fixture, whose terms keep WordPress's rules): a term made,
 * renamed, moved — done at once — and merged, deleted — product by product,
 * in the background — each filed in the real log and undone; the aliases
 * Publish follows; the refusals. Opt-in, like every *.db.test.ts: a
 * THROWAWAY Postgres with the migrations applied (npm run test:db).
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

vi.mock("@/lib/env", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/env")>();
  return { ...real, env: { ...real.env, VETRINA_SOURCE: "fixture" } };
});

const checks = vi.hoisted(() => ({ requested: 0 }));
vi.mock("@/server/collections/runner", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/collections/runner")>();
  // The automatic categories catching up is their own business: here, only that it is asked.
  return { ...real, requestCheck: () => void (checks.requested += 1) };
});

const load = async () => ({
  ...(await import("@/server/db/client")),
  ...(await import("@/server/db/schema")),
  ...(await import("@/server/vetrina/source")),
  ...(await import("@/server/collections/fixture-client")),
  ...(await import("@/server/woo/term-aliases")),
  ...(await import("./service")),
  ...(await import("./runner")),
  ...(await import("./terms")),
  ...(await import("./proposals")),
  ...(await import("./preview")),
});

const OWNER: Actor = { kind: "user", name: "owner" };
const ASSISTANT: Actor = { kind: "token", name: "assistant", scopes: ["read", "propose"] };

/** The refusal a call ends with. */
async function refusal(call: Promise<unknown>): Promise<{ code: string; message: string }> {
  const { VetrinaError } = await load();
  try {
    await call;
  } catch (e) {
    if (e instanceof VetrinaError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error("expected a refusal");
}

/** A catalog action (a merge, a deletion, a category for products) started and waited for. */
async function run(input: OperationInput): Promise<OperationView> {
  const { startOperation, idle, loadOperation } = await load();
  const started = await startOperation(input);
  await idle();
  return loadOperation(started.id);
}

async function undo(id: string): Promise<OperationView> {
  const { undoOperation, idle, loadOperation } = await load();
  await undoOperation(id);
  await idle();
  return loadOperation(id);
}

/** The demo store's terms of a taxonomy, by name. */
async function named(kind: "categories" | "brands" | "tags", name: string): Promise<{ id: number; name: string; slug: string; parent?: number } | undefined> {
  const { fixtureClient } = await load();
  const list: { id: number; name: string; slug: string; parent?: number }[] =
    kind === "categories" ? await fixtureClient().listCategories() : kind === "brands" ? await fixtureClient().listBrands() : await fixtureClient().listTags();
  return list.find((t) => t.name === name);
}

/** The products holding a term, by id, as the store reads them now. */
async function holding(kind: "categories" | "brands" | "tags", id: number): Promise<number[]> {
  const { fixtureClient } = await load();
  return (await fixtureClient().productIdsInTerm(kind, id)).sort((a, b) => a - b);
}

const ids = (...list: number[]) => ({ kind: "ids" as const, ids: list });

describe.skipIf(!enabled)("the store's taxonomies, managed from the Hub (the demo shop)", () => {
  beforeEach(async () => {
    const { db, vetrinaOperations, vetrinaProposals, termAliases, storeIndex } = await load();
    await db.delete(vetrinaOperations);
    await db.delete(vetrinaProposals);
    await db.delete(termAliases);
    await db.delete(storeIndex);
    const g = globalThis as Record<string, unknown>;
    for (const key of ["__vetrinaDemo", "__vetrinaDemoTerms", "__vetrinaOperations", "__vetrinaCatalogPresence"]) delete g[key];
    checks.requested = 0;
  });

  it("makes a category under another, refuses a name taken there in any case, and Annulla deletes it while nothing holds it", async () => {
    const { startTermOperation, assessTermAction, undoOperation } = await load();
    const assessed = await assessTermAction({ kind: "termCreate", taxonomy: "category", name: "Estate 2026", parent: 104 });
    expect(assessed.preview.page?.lines).toEqual(["Nasce la categoria «Estate 2026», sotto «Nuove release»."]);
    const made = await startTermOperation({ kind: "termCreate", taxonomy: "category", name: "Estate 2026", parent: 104 });
    expect(made.operation).toMatchObject({ kind: "termCreate", label: "Nuova categoria «Estate 2026» sotto «Nuove release»", undoable: true });
    expect(await named("categories", "Estate 2026")).toMatchObject({ parent: 104 });
    expect((await refusal(startTermOperation({ kind: "termCreate", taxonomy: "category", name: "estate 2026", parent: 104 }))).message).toBe(
      "C'è già una categoria «estate 2026» sotto «Nuove release»: scegli un altro nome.",
    );
    // At the top level the name is free: another parent, another place.
    await startTermOperation({ kind: "termCreate", taxonomy: "category", name: "Estate 2026" });

    await undoOperation(made.operation!.id);
    expect((await named("categories", "Estate 2026"))?.parent ?? 0).toBe(0);
  });

  it("renames a brand, keeps its old name as an alias for Publish, and Annulla gives the name back and drops the alias", async () => {
    const { startTermOperation, assessTermAction, undoOperation, listAliases } = await load();
    const assessed = await assessTermAction({ kind: "termRename", taxonomy: "brand", termId: 208, name: "Asics Tiger" });
    expect(assessed.preview.page?.lines).toEqual([
      "Il brand «Asics» si chiamerà «Asics Tiger». Il suo indirizzo sul sito resta lo stesso.",
      "Publish lo riconoscerà anche col vecchio nome: niente doppioni.",
    ]);
    const renamed = await startTermOperation({ kind: "termRename", taxonomy: "brand", termId: 208, name: "Asics Tiger" });
    expect(renamed.operation?.label).toBe("Brand «Asics» rinominato «Asics Tiger»");
    expect(await named("brands", "Asics Tiger")).toMatchObject({ id: 208, slug: "asics" });
    expect((await listAliases("brand")).map((a) => [a.nameKey, a.termId])).toEqual([["asics", 208]]);
    expect((await refusal(startTermOperation({ kind: "termRename", taxonomy: "brand", termId: 208, name: "nike" }))).message).toBe(
      "C'è già un brand «nike» al primo livello: scegli un altro nome.",
    );

    await undoOperation(renamed.operation!.id);
    expect(await named("brands", "Asics")).toMatchObject({ id: 208 });
    expect(await listAliases("brand")).toEqual([]);
  });

  it("moves a category under another, never under itself or a term below it, and Annulla puts it back", async () => {
    const { startTermOperation, undoOperation, listAliases } = await load();
    const made = await startTermOperation({ kind: "termCreate", taxonomy: "category", name: "Running" });
    const running = made.result.term!.id;
    const child = (await startTermOperation({ kind: "termCreate", taxonomy: "category", name: "Trail", parent: running })).result.term!.id;
    expect((await refusal(startTermOperation({ kind: "termMove", taxonomy: "category", termId: running, parent: child }))).message).toBe(
      "Una categoria non può andare sotto se stessa o sotto una sua sottocategoria.",
    );
    expect((await refusal(startTermOperation({ kind: "termMove", taxonomy: "category", termId: running, parent: 0 }))).message).toBe("«Running» è già lì.");

    const moved = await startTermOperation({ kind: "termMove", taxonomy: "category", termId: running, parent: 103 });
    expect(moved.operation?.label).toBe("Categoria «Running» spostata sotto «Sneakers in offerta»");
    expect(await named("categories", "Running")).toMatchObject({ parent: 103 });
    // Publish finds categories by name under their parent: the old place leads here.
    expect((await listAliases("category")).map((a) => [a.parent, a.nameKey, a.termId])).toEqual([[0, "running", running]]);
    expect(checks.requested).toBeGreaterThan(0);

    await undoOperation(moved.operation!.id);
    expect(await named("categories", "Running")).toMatchObject({ parent: 0 });
    expect(await listAliases("category")).toEqual([]);
  });

  it("merges a category into another product by product, its sub-terms going along, and Annulla makes it again with its products", async () => {
    const { startTermOperation, assess, listAliases } = await load();
    const summer = (await startTermOperation({ kind: "termCreate", taxonomy: "category", name: "Estate" })).result.term!.id;
    const sub = (await startTermOperation({ kind: "termCreate", taxonomy: "category", name: "Infradito", parent: summer })).result.term!.id;
    const first = await holding("categories", 104);
    const mine = [1001, 1002, 1003];
    await run({ kind: "categorize", target: ids(...mine), categoryId: summer });
    const before = await holding("categories", summer);
    expect(before).toEqual(mine);

    const assessed = await assess({ kind: "termMerge", taxonomy: "category", termId: summer, into: 104 }, { live: true });
    expect(assessed.refusal).toBeNull();
    expect(assessed.preview.page?.lines).toEqual([
      "I suoi 3 prodotti passano da «Estate» a «Nuove release», poi «Estate» viene eliminata.",
      "La sua sottocategoria va sotto «Nuove release».",
      "Publish metterà in «Nuove release» anche ciò che arriva col nome «Estate».",
    ]);

    const merged = await run({ kind: "termMerge", taxonomy: "category", termId: summer, into: 104 });
    expect(merged).toMatchObject({ status: "done", label: "Categoria «Estate» unita a «Nuove release» · 3 prodotti", undoable: true });
    expect(await named("categories", "Estate")).toBeUndefined();
    expect(await named("categories", "Infradito")).toMatchObject({ parent: 104 });
    expect(await holding("categories", 104)).toEqual([...new Set([...first, ...mine])].sort((a, b) => a - b));
    expect((await listAliases("category")).map((a) => [a.nameKey, a.termId])).toEqual([["estate", 104]]);

    const undone = await undo(merged.id);
    expect(undone).toMatchObject({ status: "undone", undo: { restored: 3, kept: 0, failed: 0 } });
    const again = (await named("categories", "Estate"))!;
    expect(again.id).not.toBe(summer);
    expect(await holding("categories", again.id)).toEqual(mine);
    // What held "Nuove release" before keeps it; what the merge gave it, it takes back.
    expect(await holding("categories", 104)).toEqual(first);
    expect(await named("categories", "Infradito")).toMatchObject({ id: sub, parent: again.id });
    expect(await listAliases("category")).toEqual([]);
  });

  it("deletes a tag from its products, then the tag; Annulla makes it again and gives it back to them", async () => {
    const { startTermOperation } = await load();
    const tag = (await startTermOperation({ kind: "termCreate", taxonomy: "tag", name: "Prova" })).result.term!.id;
    await run({ kind: "tag", target: ids(1004, 1005), tag: { id: tag, name: "Prova" } });
    expect(await holding("tags", tag)).toEqual([1004, 1005]);

    const deleted = await run({ kind: "termDelete", taxonomy: "tag", termId: tag });
    expect(deleted).toMatchObject({ status: "done", label: "Tag «Prova» eliminato · 2 prodotti" });
    expect(await named("tags", "Prova")).toBeUndefined();

    await undo(deleted.id);
    const again = (await named("tags", "Prova"))!;
    expect(await holding("tags", again.id)).toEqual([1004, 1005]);
  });

  it("deletes an empty brand, and its undo is there all the same", async () => {
    const { startTermOperation } = await load();
    const empty = (await startTermOperation({ kind: "termCreate", taxonomy: "brand", name: "Vuoto" })).result.term!.id;
    const deleted = await run({ kind: "termDelete", taxonomy: "brand", termId: empty });
    expect(deleted).toMatchObject({ status: "done", undoable: true, label: "Brand «Vuoto» eliminato · 0 prodotti" });
    await undo(deleted.id);
    expect(await named("brands", "Vuoto")).toBeDefined();
  });

  it("refuses to take away a term the homepage shows, to merge into itself or below itself, and says so first", async () => {
    const { assess, startTermOperation } = await load();
    expect(await refusal(assess({ kind: "termDelete", taxonomy: "category", termId: 102 }, { live: true }))).toEqual({
      code: "invalid",
      message: "«Saldi outlet» è nella homepage («SALDI»): cambia prima la sezione.",
    });
    expect((await refusal(run({ kind: "termDelete", taxonomy: "category", termId: 102 }))).code).toBe("invalid");

    const top = (await startTermOperation({ kind: "termCreate", taxonomy: "category", name: "Alto" })).result.term!.id;
    const low = (await startTermOperation({ kind: "termCreate", taxonomy: "category", name: "Basso", parent: top })).result.term!.id;
    expect((await refusal(assess({ kind: "termMerge", taxonomy: "category", termId: top, into: top }, { live: true }))).message).toBe(
      "Scegli un'altra categoria in cui unirla.",
    );
    expect((await refusal(assess({ kind: "termMerge", taxonomy: "category", termId: top, into: low }, { live: true }))).message).toBe(
      "«Basso» sta sotto quella da unire: scegline una fuori dal suo ramo.",
    );
  });

  it("is proposed like any action: a rename on a person's yes, filed as the assistant's", async () => {
    const { propose, confirmProposal } = await load();
    const proposal = await propose({ kind: "termRename", taxonomy: "category", termId: 103, name: "Sneakers scontate" }, "assistant", ASSISTANT);
    expect(proposal.summary).toContain("La categoria «Sneakers in offerta» si chiamerà «Sneakers scontate». Il suo indirizzo sul sito resta lo stesso.");
    const operation = await confirmProposal(proposal.id, OWNER);
    expect(operation).toMatchObject({ kind: "termRename", via: "assistant", actor: "user:owner", status: "done" });
    expect(await named("categories", "Sneakers scontate")).toMatchObject({ id: 103 });
  });
});
