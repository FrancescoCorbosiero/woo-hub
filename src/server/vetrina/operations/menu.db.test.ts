import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actors";
import type { Menu } from "@/lib/menus/types";

/**
 * The menus' actions on the demo shop's menus (VETRINA_SOURCE=fixture, which
 * keep WordPress's own rules): previewed, written, filed in the real log,
 * undone — and proposed and confirmed. Opt-in, like every *.db.test.ts: a
 * THROWAWAY Postgres with the migrations applied (npm run test:db); it
 * empties vetrina_operations and vetrina_proposals.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

vi.mock("@/lib/env", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/env")>();
  return { env: { ...real.env, VETRINA_SOURCE: "fixture" } };
});

/** A write WordPress refuses, on demand: the next `failAt`-th item update of a call fails. */
const faults = vi.hoisted(() => ({ failUpdateAt: null as number | null }));
vi.mock("@/server/wordpress/menus/fixture-menus", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/wordpress/menus/fixture-menus")>();
  const { VetrinaError } = await import("@/server/vetrina/source");
  return {
    ...real,
    fixtureMenus: () => {
      const source = real.fixtureMenus();
      return {
        ...source,
        async update(changes: Parameters<typeof source.update>[0]) {
          const at = faults.failUpdateAt;
          if (at == null) return source.update(changes);
          faults.failUpdateAt = null;
          const ok = await source.update(changes.slice(0, at));
          return [...ok, ...changes.slice(at).map(() => ({ ok: false as const, error: new VetrinaError("failed", "HTTP 500", 500) }))];
        },
      };
    },
  };
});

const load = async () => ({
  ...(await import("@/server/db/client")),
  ...(await import("@/server/db/schema")),
  ...(await import("@/server/vetrina/source")),
  ...(await import("@/server/wordpress/menus/source")),
  ...(await import("./menu")),
  ...(await import("./proposals")),
  ...(await import("./service")),
});

const OWNER: Actor = { kind: "user", name: "owner" };
const ASSISTANT: Actor = { kind: "token", name: "assistant", scopes: ["read", "propose"] };

/** The demo's main menu as it reads: titles, each under its parent's ("Brand > Nike"). */
async function shape(menuId = 1): Promise<string[]> {
  const { getMenuSource } = await load();
  const { layoutOf, rowsOf } = await import("@/lib/menus/plan");
  const menu = await (await getMenuSource()).menu(menuId);
  const byId = new Map(menu.items.map((i) => [i.id, i]));
  return rowsOf(layoutOf(menu.items)).map((r) => (r.parent ? `${byId.get(r.parent)!.title} > ` : "") + byId.get(r.id)!.title);
}

async function menu(menuId = 1): Promise<Menu> {
  const { getMenuSource } = await load();
  return (await getMenuSource()).menu(menuId);
}

/** The refusal a call ends with. */
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

const MAIN = ["Home", "Novità", "Brand", "Brand > Nike", "Brand > Adidas", "Brand > New Balance", "Saldi outlet", "Chi siamo"];

describe.skipIf(!enabled)("the menus' actions on the demo shop", () => {
  beforeEach(async () => {
    const { db, vetrinaOperations, vetrinaProposals } = await load();
    await db.delete(vetrinaOperations);
    await db.delete(vetrinaProposals);
    const g = globalThis as Record<string, unknown>;
    for (const key of ["__vetrinaDemoMenus", "__vetrinaDemo", "__vetrinaOperations"]) delete g[key];
    faults.failUpdateAt = null;
  });

  it("adds a brand and a link at a place, renumbers the menu as WordPress's editor does, and Annulla takes them away", async () => {
    const { assessMenu, startMenuOperation, undoOperation, menuDigest } = await load();
    const before = menuDigest(await menu());
    const add = { kind: "menuItemAdd" as const, menuId: 1, items: [{ kind: "brand" as const, id: 208 }, { kind: "link" as const, url: "/marchi/", label: "Tutti i brand" }], place: { parent: 13, position: 2 } };

    const assessed = await assessMenu(add);
    expect(assessed.preview.page?.lines).toEqual([
      "2 voci entrano nel menu «Menu principale», sotto «Brand», al 2° posto: «Asics» e «Tutti i brand».",
      "Sul sito si vede in: Menu principale.",
    ]);

    const { operation, result } = await startMenuOperation(add, "app", OWNER);
    expect(operation).toMatchObject({ kind: "menuItemAdd", status: "done", via: "app", actor: "user:owner", label: "2 voci aggiunte · Menu principale", undoable: true });
    expect(await shape()).toEqual([
      "Home", "Novità", "Brand", "Brand > Nike", "Brand > Asics", "Brand > Tutti i brand", "Brand > Adidas", "Brand > New Balance", "Saldi outlet", "Chi siamo",
    ]);
    // Numbered 1…n top to bottom, as WordPress's own editor saves a menu.
    expect(result.menu!.items.map((i) => i.order).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.created).toHaveLength(2);

    expect(await undoOperation(operation!.id, OWNER)).toMatchObject({ status: "undone", undoneBy: "user:owner", undo: { restored: 2 } });
    expect(await shape()).toEqual(MAIN);
    expect(menuDigest(await menu())).toBe(before);
  });

  it("moves an item with its own items, and Annulla puts it back after the same neighbour", async () => {
    const { assessMenu, startMenuOperation, undoOperation } = await load();
    const move = { kind: "menuItemMove" as const, menuId: 1, itemId: 13, place: { parent: 0, position: 1 } };
    expect((await assessMenu(move)).preview.page?.lines.slice(0, 2)).toEqual(["«Brand» passa in cima al menu.", "Con lei si spostano le sue 3 voci."]);

    const { operation } = await startMenuOperation(move);
    expect(await shape()).toEqual(["Brand", "Brand > Nike", "Brand > Adidas", "Brand > New Balance", "Home", "Novità", "Saldi outlet", "Chi siamo"]);
    await undoOperation(operation!.id);
    expect(await shape()).toEqual(MAIN);
  });

  it("takes an item out with its items lifted into its place, and Annulla brings it back with them", async () => {
    const { assessMenu, startMenuOperation, undoOperation } = await load();
    const remove = { kind: "menuItemRemove" as const, menuId: 1, itemId: 13 };
    expect((await assessMenu(remove)).preview.page?.lines.slice(0, 2)).toEqual([
      "«Brand» esce dal menu «Menu principale».",
      "Le sue 3 voci salgono al suo posto: «Nike», «Adidas» e «New Balance».",
    ]);

    const { operation } = await startMenuOperation(remove);
    expect(await shape()).toEqual(["Home", "Novità", "Nike", "Adidas", "New Balance", "Saldi outlet", "Chi siamo"]);
    expect(await undoOperation(operation!.id)).toMatchObject({ status: "undone", undo: { restored: 4 } });
    expect(await shape()).toEqual(MAIN);
    // Back as it was: a link, its label, where it led.
    expect((await menu()).items.find((i) => i.title === "Brand")).toMatchObject({ label: "Brand", target: { kind: "link", url: "#" } });
  });

  it("renames an item, or gives it back its category's name, and Annulla puts the label back", async () => {
    const { startMenuOperation, undoOperation } = await load();
    const renamed = await startMenuOperation({ kind: "menuItemRename", menuId: 1, itemId: 17, label: "Saldi" });
    expect(renamed.operation).toMatchObject({ label: "Voce «Saldi outlet» rinominata «Saldi» · Menu principale" });
    expect((await menu()).items.find((i) => i.id === 17)).toMatchObject({ title: "Saldi", label: "Saldi" });

    const own = await startMenuOperation({ kind: "menuItemRename", menuId: 1, itemId: 12, label: null });
    expect(own.operation).toMatchObject({ label: "Voce «Novità» col suo nome originale · Menu principale" });
    expect((await menu()).items.find((i) => i.id === 12)).toMatchObject({ title: "Nuove release", label: null });

    await undoOperation(renamed.operation!.id);
    expect((await menu()).items.find((i) => i.id === 17)).toMatchObject({ title: "Saldi outlet", label: null });
  });

  it("refuses what cannot be done, saying why — and a screen's read of a menu changed since", async () => {
    const { startMenuOperation, menuDigest } = await load();
    const go = (input: unknown) => refusal(startMenuOperation(input as never));
    expect(await go({ kind: "menuItemMove", menuId: 1, itemId: 13, place: { parent: 14 } })).toMatchObject({
      code: "invalid",
      message: "Una voce non può andare sotto se stessa o sotto le sue voci.",
    });
    expect((await go({ kind: "menuItemMove", menuId: 1, itemId: 14, place: { parent: 13, position: 1 } })).message).toBe("«Nike» è già lì.");
    expect((await go({ kind: "menuItemMove", menuId: 1, itemId: 14, place: { parent: 13, position: 9 } })).message).toBe("Il posto va da 1 a 3.");
    expect(await go({ kind: "menuItemRemove", menuId: 1, itemId: 999 })).toMatchObject({ code: "not_found", message: "Questa voce non è più nel menu." });
    expect(await go({ kind: "menuItemRemove", menuId: 99, itemId: 13 })).toMatchObject({ code: "not_found", message: "Questo menu non c'è più sul sito." });
    expect((await go({ kind: "menuItemAdd", menuId: 1, items: [{ kind: "category", id: 999 }] })).message).toBe("Nel negozio non c'è la categoria 999.");
    expect((await go({ kind: "menuItemAdd", menuId: 1, items: [{ kind: "page", id: 999 }] })).message).toBe("Sul sito non c'è la pagina pubblicata 999.");
    expect((await go({ kind: "menuItemRename", menuId: 1, itemId: 11, label: null })).message).toBe("Un link ha sempre un nome suo.");
    expect((await go({ kind: "menuItemRename", menuId: 1, itemId: 17, label: "Saldi outlet" })).message).toBe("«Saldi outlet» si chiama già così.");

    const read = menuDigest(await menu());
    await startMenuOperation({ kind: "menuItemRename", menuId: 1, itemId: 18, label: "La nostra storia" });
    expect(await go({ kind: "menuItemRemove", menuId: 1, itemId: 17, expected: { digest: read } })).toMatchObject({
      code: "stale",
      message: "Il menu è cambiato nel frattempo: rileggilo e riprova.",
    });
    expect(await shape()).toContain("Saldi outlet");
  });

  it("warns of an item already in the menu, and adds it all the same", async () => {
    const { assessMenu } = await load();
    const assessed = await assessMenu({ kind: "menuItemAdd", menuId: 1, items: [{ kind: "brand", id: 201 }] });
    expect(assessed.preview.warnings).toEqual(["«Nike» è già nel menu, sotto «Brand»."]);
  });

  it("refuses an undo over a change made since: the newer change stands", async () => {
    const { startMenuOperation, undoOperation } = await load();
    const renamed = await startMenuOperation({ kind: "menuItemRename", menuId: 1, itemId: 17, label: "Saldi" });
    await startMenuOperation({ kind: "menuItemRename", menuId: 1, itemId: 17, label: "Outlet" });
    expect(await refusal(undoOperation(renamed.operation!.id))).toMatchObject({
      code: "stale",
      message: "«Saldi outlet» è cambiata dopo questa azione: la modifica più recente resta.",
    });

    const added = await startMenuOperation({ kind: "menuItemAdd", menuId: 1, items: [{ kind: "page", id: 6 }] });
    const [made] = added.result.created;
    await startMenuOperation({ kind: "menuItemAdd", menuId: 1, items: [{ kind: "page", id: 4 }], place: { parent: made } });
    expect((await refusal(undoOperation(added.operation!.id))).message).toBe("Sotto «Guida alle taglie» sono state messe altre voci: resta com'è.");
    expect(await shape()).toContain("Guida alle taglie");
  });

  it("puts the menu back when WordPress takes only part of a write, and says so", async () => {
    const { startMenuOperation } = await load();
    faults.failUpdateAt = 2;
    expect(await refusal(startMenuOperation({ kind: "menuItemMove", menuId: 1, itemId: 18, place: { parent: 0, position: 1 } }))).toMatchObject({
      code: "failed",
      message: "WordPress non ha accettato la modifica: il menu è rimasto com'era.",
    });
    expect(await shape()).toEqual(MAIN);
  });

  it("is proposed like any action: a person's yes runs it once, and a menu changed since makes a new proposal", async () => {
    const { propose, confirmProposal, loadProposal, startMenuOperation } = await load();
    const proposal = await propose({ kind: "menuItemAdd", menuId: 1, items: [{ kind: "page", id: 6 }], place: { parent: 0, position: 2 } }, "assistant", ASSISTANT);
    expect(proposal).toMatchObject({ kind: "menuItemAdd", status: "open", actor: "token:assistant" });
    expect(proposal.summary).toContain("«Guida alle taglie» entra nel menu «Menu principale», al 2° posto del menu.");
    expect((await refusal(confirmProposal(proposal.id, ASSISTANT))).code).toBe("forbidden");

    const operation = await confirmProposal(proposal.id, OWNER);
    expect(operation).toMatchObject({ kind: "menuItemAdd", via: "assistant", actor: "user:owner", status: "done" });
    expect((await shape())[1]).toBe("Guida alle taglie");
    expect((await confirmProposal(proposal.id, OWNER))?.id).toBe(operation!.id);

    const move = await propose({ kind: "menuItemMove", menuId: 1, itemId: 18, place: { parent: 0, position: 1 } }, "assistant", ASSISTANT);
    // Meanwhile, from the screens: another item renamed.
    await startMenuOperation({ kind: "menuItemRename", menuId: 1, itemId: 17, label: "Saldi" });
    const stale = await refusal(confirmProposal(move.id, OWNER));
    expect(stale.code).toBe("stale");
    expect(await loadProposal(move.id)).toMatchObject({ status: "changed" });
    expect((await shape())[0]).toBe("Home");
  });
});
