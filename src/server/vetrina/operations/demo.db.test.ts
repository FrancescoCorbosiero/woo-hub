import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationInput, OperationView } from "@/lib/vetrina/catalog-ops";

/**
 * The catalog's actions on the Vetrina's demo shop (VETRINA_SOURCE=fixture),
 * end to end — the demo store, the demo homepage, the real index and log —
 * as the walkthrough uses them. Opt-in, like every *.db.test.ts: they need a
 * THROWAWAY Postgres with the migrations applied, and they empty
 * vetrina_operations, store_index and smart_collections.
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
  ...(await import("@/server/collections/repo")),
  ...(await import("@/server/collections/runner")),
  ...(await import("@/server/vetrina/catalog")),
  ...(await import("@/server/vetrina/fixture-source")),
  ...(await import("@/server/vetrina/fixture-data")),
  ...(await import("./service")),
  ...(await import("./runner")),
});

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

describe.skipIf(!enabled)("the catalog's actions on the demo shop", () => {
  beforeEach(async () => {
    const { db, vetrinaOperations, storeIndex, smartCollections, forgetHomepagePresence, runFull } = await load();
    await db.delete(vetrinaOperations);
    await db.delete(storeIndex);
    await db.delete(smartCollections);
    const g = globalThis as Record<string, unknown>;
    for (const key of ["__vetrinaDemo", "__vetrinaDemoTerms", "__vetrinaOperations", "__storeHubCollections"]) delete g[key];
    forgetHomepagePresence();
    // The index, read from the demo shop as the catalog's first opening does.
    await runFull();
  });

  it("hides a whole category — its homepage section empties — and «Mostra» brings it back", async () => {
    const { demoShop, fixtureSource, DEMO_TERM_IDS, loadTermActions } = await load();
    const outlet = DEMO_TERM_IDS["saldi-sneakers-outlet"];
    const members = demoShop().products.filter((p) => p.categories.includes("saldi-sneakers-outlet"));
    expect((await fixtureSource().rail("category:saldi-sneakers-outlet#0")).items.length).toBeGreaterThan(0);

    const op = await run({ kind: "hide", target: { kind: "query", query: { taxonomy: "category", termId: outlet } }, termKey: `category:${outlet}` });
    expect(op).toMatchObject({ status: "done", changed: members.length, label: `${members.length} prodotti nascosti · Saldi outlet` });
    expect(members.every((p) => p.visibility === "hidden")).toBe(true);
    expect((await fixtureSource().rail("category:saldi-sneakers-outlet#0")).items).toEqual([]);
    expect((await loadTermActions("category", outlet)).hiddenBy?.id).toBe(op.id);

    await undo(op.id);
    expect(members.every((p) => p.visibility === "visible")).toBe(true);
    expect((await fixtureSource().rail("category:saldi-sneakers-outlet#0")).items.length).toBeGreaterThan(0);
  });

  it("puts a product on sale — its card shows the sale price — and «Annulla» puts the price back", async () => {
    const { demoShop, fixtureSource, readIndexRowsById } = await load();
    const p = demoShop().products.find((x) => !x.onSale)!;
    const regular = p.price;
    const op = await run({ kind: "sale", target: { kind: "ids", ids: [p.id] }, percent: 20, rounding: "charm", endsOn: null });
    expect(op).toMatchObject({ status: "done", changed: 1 });
    const [card] = await fixtureSource().products([p.id]);
    expect(card.onSale).toBe(true);
    expect(card.price).toBeLessThan(regular);
    expect(String(card.price)).toMatch(/\.99$/);
    expect(p.regularPrice).toBe(regular);
    expect((await readIndexRowsById([p.id]))[0]).toMatchObject({ onSale: true, price: card.price });

    await undo(op.id);
    const [back] = await fixtureSource().products([p.id]);
    expect(back).toMatchObject({ onSale: false, price: regular });
  });

  it("puts products at the top of a category's order — the store's order follows — and «Annulla» puts it back", async () => {
    const { demoShop, DEMO_TERM_IDS } = await load();
    const { readTermOrder } = await import("./order");
    const outlet = DEMO_TERM_IDS["saldi-sneakers-outlet"];
    const before = (await readTermOrder("category", outlet)).members.map((m) => m.id);
    const [a, b] = [before[before.length - 1], before[Math.floor(before.length / 2)]];
    const numbers = new Map(demoShop().products.map((p) => [p.id, p.menuOrder]));

    const op = await run({ kind: "order", target: { kind: "ids", ids: [a, b] }, term: { taxonomy: "category", id: outlet }, position: 1 });
    expect(op).toMatchObject({ status: "done", label: "2 prodotti in cima · Saldi outlet" });
    const after = (await readTermOrder("category", outlet)).members.map((m) => m.id);
    expect(after.slice(0, 2)).toEqual([a, b]);
    expect(after.slice(2)).toEqual(before.filter((id) => id !== a && id !== b));

    await undo(op.id);
    expect(demoShop().products.every((p) => p.menuOrder === numbers.get(p.id))).toBe(true);
    expect((await readTermOrder("category", outlet)).members.map((m) => m.id)).toEqual(before);
  });

  it("a drag in «Riordina» moves only the product dragged, and says where", async () => {
    const { DEMO_TERM_IDS, previewOperation } = await load();
    const { readTermOrder } = await import("./order");
    const outlet = DEMO_TERM_IDS["saldi-sneakers-outlet"];
    const before = (await readTermOrder("category", outlet)).members.map((m) => m.id);
    const window = before.slice(0, 5);
    const [dragged] = window.splice(4, 1);
    window.splice(2, 0, dragged);
    const input = { kind: "order" as const, target: { kind: "ids" as const, ids: window }, term: { taxonomy: "category" as const, id: outlet }, position: 1, reorder: true as const };
    const preview = await previewOperation(input);
    expect(preview.changes).toBe(1);
    expect(preview.sample).toMatchObject([{ id: dragged, before: "#5", after: "#3" }]);
    const op = await run(input);
    expect(op.label).toBe("Nuovo ordine · Saldi outlet: 1 prodotto spostato");
    expect((await readTermOrder("category", outlet)).members.map((m) => m.id).slice(0, 5)).toEqual(window);
  });

  it("refuses to order products already in that order", async () => {
    const { DEMO_TERM_IDS, previewOperation } = await load();
    const { readTermOrder } = await import("./order");
    const outlet = DEMO_TERM_IDS["saldi-sneakers-outlet"];
    const [first] = (await readTermOrder("category", outlet)).members;
    const preview = await previewOperation({ kind: "order", target: { kind: "ids", ids: [first.id] }, term: { taxonomy: "category", id: outlet }, position: 1 });
    expect(preview.changes).toBe(0);
    expect(preview.warnings[0]).toBe("Sono già in quest'ordine.");
  });

  it("ends a demo sale and puts it back", async () => {
    const { demoShop } = await load();
    const p = demoShop().products.find((x) => x.onSale)!;
    const sale = p.price;
    const op = await run({ kind: "unsale", target: { kind: "ids", ids: [p.id] } });
    expect(op.changed).toBe(1);
    expect(p).toMatchObject({ onSale: false, price: p.regularPrice, salePrice: null });
    await undo(op.id);
    expect(p).toMatchObject({ onSale: true, price: sale });
  });

  it("pins a product into a section of a category it was not in, then takes it all back", async () => {
    const { demoShop, fixtureSource } = await load();
    const p = demoShop().products.find((x) => x.inStock && !x.categories.includes("new-nuove-release"))!;
    const op = await run({ kind: "pin", target: { kind: "ids", ids: [p.id] }, sectionKey: "category:new-nuove-release#0" });
    expect(op).toMatchObject({ status: "done", changed: 1, label: "1 prodotto fissato in NUOVI ARRIVI" });
    expect(p.categories).toContain("new-nuove-release");
    const rail = await fixtureSource().rail("category:new-nuove-release#0");
    expect(rail.items[0].id).toBe(p.id);
    expect(rail.pin).toEqual([p.id]);

    await undo(op.id);
    expect(p.categories).not.toContain("new-nuove-release");
    expect((await fixtureSource().rail("category:new-nuove-release#0")).pin).toEqual([]);
  });

  it("starts again with the demo shop: a restart's index and log forget what was done to the one before", async () => {
    const { demoShop, runFull, readIndexRowsById, listOperations, loadOperation } = await load();
    const p = demoShop().products.find((x) => x.inStock)!;
    const op = await run({ kind: "hide", target: { kind: "ids", ids: [p.id] } });
    expect((await readIndexRowsById([p.id]))[0].visibility).toBe("hidden");

    // A restart, a minute later: the demo shop, and the actions' queue, are made again.
    vi.useFakeTimers({ now: Date.now() + 60_000, toFake: ["Date"] });
    try {
      const g = globalThis as Record<string, unknown>;
      for (const key of ["__vetrinaDemo", "__vetrinaDemoTerms", "__vetrinaOperations"]) delete g[key];
      expect(demoShop().byId.get(p.id)!.visibility).toBe("visible");
      await runFull();
      expect((await readIndexRowsById([p.id]))[0].visibility).toBe("visible");
      expect(await listOperations(10)).toEqual([]);
      await expect(loadOperation(op.id)).rejects.toThrow("Questa azione non c'è più nel registro.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends a demo sale after its last day, as WooCommerce's scheduled sales do", async () => {
    const { demoShop } = await load();
    const p = demoShop().products.find((x) => !x.onSale)!;
    const op = await run({ kind: "sale", target: { kind: "ids", ids: [p.id] }, percent: 30, rounding: "exact", endsOn: null });
    expect(op.changed).toBe(1);
    expect(p.onSale).toBe(true);
    p.saleTo = "2020-01-31T23:59:59";
    demoShop();
    expect(p).toMatchObject({ onSale: false, salePrice: null, saleTo: null, price: p.regularPrice });
  });

  it("tags demo products", async () => {
    const { demoShop } = await load();
    const [a, b] = demoShop().products.filter((x) => !x.tags.includes("estate"));
    const op = await run({ kind: "tag", target: { kind: "ids", ids: [a.id, b.id] }, tag: { id: 302, name: "estate" } });
    expect(op).toMatchObject({ status: "done", changed: 2, label: "Tag «estate» a 2 prodotti" });
    expect(a.tags).toContain("estate");
  });

  it("gives a new demo category an id no saved rule holds: the rules outlive a restart, the demo's own terms do not", async () => {
    const { db, smartCollections, listCollectionRows } = await load();
    const { saveDraft } = await import("@/server/collections/service");
    // A rule saved on a category an earlier demo shop created (its ids start at 900 on every boot).
    await db.insert(smartCollections).values({ termId: 900, name: "Di prima", match: "all", conditions: [], enabled: false });
    const id = await saveDraft({
      newCategory: { name: "Nuova", parent: 0 },
      match: "all",
      conditions: [{ field: "tag", op: "is", value: "301", label: "saldi" }],
      enabled: false,
    });
    const rows = await listCollectionRows();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === id)?.termId).toBe(901);
  });
});
