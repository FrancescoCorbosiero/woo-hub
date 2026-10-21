import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageActionInput } from "@/lib/vetrina/page-ops";
import type { RailSummary } from "@/lib/vetrina/types";

/**
 * The homepage's own actions on the Vetrina's demo shop (VETRINA_SOURCE=
 * fixture), end to end: written to the demo homepage, filed in the real
 * log, undone from it. Opt-in, like every *.db.test.ts: they need a
 * THROWAWAY Postgres with the migrations applied, and they empty
 * vetrina_operations.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

vi.mock("@/lib/env", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/env")>();
  return { env: { ...real.env, VETRINA_SOURCE: "fixture" } };
});

const load = async () => ({
  ...(await import("@/server/db/client")),
  ...(await import("@/server/db/schema")),
  ...(await import("@/server/vetrina/catalog")),
  ...(await import("@/server/vetrina/fixture-source")),
  ...(await import("@/config")),
  ...(await import("@/lib/vetrina/fields")),
  ...(await import("./page")),
  ...(await import("./service")),
});

async function rails(): Promise<RailSummary[]> {
  const { fixtureSource } = await load();
  return (await fixtureSource().homepage()).blocks.flatMap((b) => (b.kind === "rail" ? [b.rail] : []));
}

const keys = async () => (await rails()).map((r) => r.key);

async function act(input: PageActionInput, via: "app" | "api" = "app") {
  const { startPageOperation } = await load();
  const { operation } = await startPageOperation(input, via);
  expect(operation).not.toBeNull();
  return operation!;
}

describe.skipIf(!enabled)("the homepage's actions on the demo shop", () => {
  beforeEach(async () => {
    const { db, vetrinaOperations, forgetHomepagePresence } = await load();
    await db.delete(vetrinaOperations);
    const g = globalThis as Record<string, unknown>;
    for (const key of ["__vetrinaDemo", "__vetrinaDemoTerms", "__vetrinaOperations"]) delete g[key];
    forgetHomepagePresence();
  });

  it("switches a section off — filed, with how it came — and «Annulla» switches it on again", async () => {
    const { undoOperation, listOperations } = await load();
    const [first] = await rails();
    const op = await act({ kind: "sectionSwitch", key: first.key, on: false }, "api");
    expect(op).toMatchObject({ kind: "sectionSwitch", status: "done", via: "api", undoable: true, changed: 1 });
    expect(op.label).toBe(`«${first.title}» spenta sul sito`);
    expect((await rails())[0].switchedOff).toBe(true);
    expect((await listOperations(5))[0].id).toBe(op.id);

    const undone = await undoOperation(op.id);
    expect(undone).toMatchObject({ status: "undone", undoable: false, sectionKey: first.key });
    expect((await rails())[0].switchedOff).toBe(false);
  });

  it("refuses what changes nothing, in the owner's words", async () => {
    const { startPageOperation } = await load();
    const [first] = await rails();
    await expect(startPageOperation({ kind: "sectionSwitch", key: first.key, on: true })).rejects.toThrow(`«${first.title}» è già accesa.`);
    await expect(startPageOperation({ kind: "sectionMove", key: first.key, position: 1 })).rejects.toThrow("è già al 1° posto");
  });

  it("moves a section to the top, and «Annulla» puts every section back", async () => {
    const { undoOperation } = await load();
    const before = await keys();
    const third = (await rails())[2];
    const op = await act({ kind: "sectionMove", key: third.key, position: 1 });
    expect(op.label).toBe(`«${third.title}» spostata al 1° posto`);
    expect((await rails())[0].attrsHash).toBe(third.attrsHash);
    await undoOperation(op.id);
    expect(await keys()).toEqual(before);
  });

  it("arranges every section; «Annulla» is refused once a section changed since", async () => {
    const { undoOperation } = await load();
    const [a, b, ...rest] = await keys();
    const op = await act({ kind: "sectionsArrange", keys: [b, a, ...rest] });
    expect(op.label).toBe("1 sezione spostata");
    // Someone switches the section now first off: the page is no longer as the move left it.
    const top = (await rails())[0];
    await act({ kind: "sectionSwitch", key: top.key, on: false });
    await expect(undoOperation(op.id)).rejects.toThrow("Le sezioni della homepage sono cambiate dopo");
  });

  it("adds a section beside another, and «Annulla» takes it away", async () => {
    const { undoOperation } = await load();
    const before = await keys();
    const op = await act({
      kind: "sectionAdd",
      anchorKey: before[0],
      place: "after",
      source: { list: "best_selling" },
      fields: { title: "PIÙ VENDUTI" },
    });
    expect(op.label).toBe("Nuova sezione «PIÙ VENDUTI»");
    expect(op.sectionKey).toBeTruthy();
    expect(await keys()).toHaveLength(before.length + 1);
    await undoOperation(op.id);
    expect(await keys()).toEqual(before);
  });

  it("takes a section away, and «Annulla» puts it back where it was, as it was", async () => {
    const { undoOperation } = await load();
    const before = await rails();
    const second = before[1];
    const op = await act({ kind: "sectionRemove", key: second.key });
    expect(op.label).toBe(`«${second.title}» tolta dalla homepage`);
    expect(await keys()).not.toContain(second.key);
    await undoOperation(op.id);
    const after = await rails();
    expect(after.map((r) => r.key)).toEqual(before.map((r) => r.key));
    expect(after[1]).toMatchObject({ title: second.title, pin: second.pin, exclude: second.exclude, fallback: second.fallback });
  });

  it("points a section elsewhere — the preview says what changes — and «Annulla» points it back with its pins", async () => {
    const { assessPage, undoOperation } = await load();
    const section = (await rails()).find((r) => r.taxonomy === "product_cat" && r.pin.length > 0) ?? (await rails())[0];
    const to = { list: "sale" } as const;
    const { preview } = await assessPage({ kind: "sectionSource", key: section.key, source: to });
    expect(preview.page?.lines[0]).toMatch(new RegExp(`^«${section.title}» mostrerà In saldo invece di `));

    const op = await act({ kind: "sectionSource", key: section.key, source: to });
    expect(op.label).toBe(`«${section.title}» ora mostra In saldo`);
    expect(op.sectionKey).toBe("type:sale#0");

    const undone = await undoOperation(op.id);
    expect(undone.sectionKey).toBe(section.key);
    expect((await rails()).find((r) => r.key === section.key)).toMatchObject({ pin: section.pin, exclude: section.exclude });
  });

  it("publishes a section's settings, and «Annulla» puts the old ones back — unless it was published again since", async () => {
    const { undoOperation, fixtureSource } = await load();
    const section = (await rails())[0];
    const detail = await fixtureSource().rail(section.key);
    const product = detail.items.find((item) => !item.pinned)!;
    const op = await act({ kind: "sectionEdit", key: section.key, pin: [product.id, ...section.pin] });
    expect(op.label).toBe(`«${section.title}» pubblicata`);
    expect((await rails())[0].pin[0]).toBe(product.id);

    // Published again: the first publish's "Annulla" would undo this one too.
    const again = await act({ kind: "sectionEdit", key: section.key, pin: section.pin });
    await expect(undoOperation(op.id)).rejects.toThrow(`«${section.title}» è cambiata dopo`);
    // The newest one undoes, and then the first can too.
    await undoOperation(again.id);
    await undoOperation(op.id);
    expect((await rails())[0].pin).toEqual(section.pin);
  });

  it("saves a block's texts, and «Annulla» puts them back", async () => {
    const { fixtureSource, blockConfig, editableFields, undoOperation } = await load();
    const home = await fixtureSource().homepage();
    const block = home.blocks.find(
      (b) => b.kind === "static" && b.fields && b.attrsHash && editableFields(b.name, blockConfig(b.name).edit.fields, b.fields).length > 0,
    );
    // The demo homepage has a block whose texts the config lets the owner edit (the home screen's "Modifica").
    if (!block || block.kind !== "static" || !block.fields) throw new Error("no editable block on the demo homepage");
    const field = editableFields(block.name, blockConfig(block.name).edit.fields, block.fields)[0];
    const was = block.fields[field];
    const op = await act({ kind: "blockEdit", path: block.path, blockName: block.name, fields: { [field]: "Testo nuovo" } });
    expect(op.kind).toBe("blockEdit");
    const changed = (await fixtureSource().homepage()).blocks.find((b) => b.path === block.path);
    expect(changed?.kind === "static" && changed.fields?.[field]).toBe("Testo nuovo");
    await undoOperation(op.id);
    const back = (await fixtureSource().homepage()).blocks.find((b) => b.path === block.path);
    expect(back?.kind === "static" && back.fields?.[field]).toBe(was);
  });

  it("refuses a write over a page read before someone else's", async () => {
    const { startPageOperation, fixtureSource } = await load();
    const [first] = await rails();
    const read = await fixtureSource().homepage();
    await act({ kind: "sectionSwitch", key: first.key, on: false });
    await expect(
      startPageOperation({ kind: "sectionSwitch", key: first.key, on: true, expected: { modifiedGmt: read.modifiedGmt, attrsHash: first.attrsHash } }),
    ).rejects.toThrow("La homepage è stata modificata nel frattempo");
  });
});
