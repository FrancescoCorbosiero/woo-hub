import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the validation: the service is a stand-in that answers what it was asked.
const ops = vi.hoisted(() => ({
  shopToday: () => "2026-10-13",
  previewOperation: vi.fn(async (input: unknown) => input),
  startOperation: vi.fn(async (input: unknown) => input),
  loadOperation: vi.fn(async (id: string) => id),
  listOperations: vi.fn(async (limit: number) => limit),
  undoOperation: vi.fn(async (id: string) => id),
  loadTermActions: vi.fn(async (taxonomy: string, id: number) => ({ taxonomy, id })),
  loadHomepageSections: vi.fn(async () => []),
}));
vi.mock("@/server/vetrina/operations/service", () => ops);
vi.mock("@/server/vetrina/service", () => ({
  attempt: async <T,>(fn: () => Promise<T>) => ({ ok: true, data: await fn() }),
}));

import { MAX_OPERATION_PRODUCTS } from "@/lib/vetrina/catalog-ops";
import {
  listOperations,
  loadOperation,
  loadTermActions,
  previewOperation,
  startOperation,
  undoOperation,
} from "./vetrina-operations";

const ids = (...list: number[]) => ({ kind: "ids" as const, ids: list });
const sale = { kind: "sale" as const, target: ids(1), percent: 20, rounding: "charm" as const, endsOn: null };

beforeEach(() => {
  for (const fn of Object.values(ops)) if (typeof fn === "function" && "mockClear" in fn) fn.mockClear();
});

describe("the catalog actions' server actions", () => {
  it("takes a sale from 1 to 90%, whole, with an end date today or later", async () => {
    expect(await startOperation(sale)).toMatchObject({ ok: true });
    expect(await startOperation({ ...sale, percent: 0 })).toEqual({ ok: false, code: "invalid", error: "Lo sconto va da 1 a 90%." });
    expect(await startOperation({ ...sale, percent: 91 })).toMatchObject({ ok: false, error: "Lo sconto va da 1 a 90%." });
    expect(await startOperation({ ...sale, percent: 12.5 })).toMatchObject({ ok: false });
    expect(await startOperation({ ...sale, endsOn: "2026-10-13" })).toMatchObject({ ok: true });
    expect(await startOperation({ ...sale, endsOn: "2026-10-12" })).toMatchObject({ ok: false, error: "La data di fine è già passata." });
    expect(await startOperation({ ...sale, endsOn: "2026-02-30" })).toMatchObject({ ok: false, error: "Data non valida." });
    expect(ops.startOperation).toHaveBeenCalledTimes(2);
  });

  it("refuses more products than an action takes, an empty list, and ids that are not ids", async () => {
    const many = Array.from({ length: MAX_OPERATION_PRODUCTS + 1 }, (_, i) => i + 1);
    expect(await previewOperation({ kind: "hide", target: ids(...many) })).toMatchObject({
      ok: false,
      error: "Sono 2001 prodotti: al massimo 2000 alla volta. Restringi con i filtri.",
    });
    expect(await previewOperation({ kind: "hide", target: ids() })).toMatchObject({ ok: false, error: "Nessun prodotto scelto." });
    expect(await previewOperation({ kind: "hide", target: ids(0) })).toMatchObject({ ok: false, error: "Richiesta non valida." });
    expect(ops.previewOperation).not.toHaveBeenCalled();
  });

  it("takes a list's query without its page, and a term's key only in its own shape", async () => {
    const res = await previewOperation({
      kind: "hide",
      target: { kind: "query", query: { taxonomy: "brand", termId: 7, offset: 40, limit: 40, sort: "name" } },
      termKey: "brand:7",
    });
    expect(res).toEqual({
      ok: true,
      data: { kind: "hide", target: { kind: "query", query: { taxonomy: "brand", termId: 7, sort: "name" } }, termKey: "brand:7" },
    });
    expect(await previewOperation({ kind: "hide", target: { kind: "query", query: { termId: 7 } } })).toMatchObject({ ok: false });
    expect(await previewOperation({ kind: "hide", target: ids(1), termKey: "tag:7" as never })).toMatchObject({ ok: false });
    // A whole term's action covers that whole term: not a few of its products, not a narrowed list, not another term.
    const whole = "Un'azione su tutta la categoria o il brand vale per tutti i suoi prodotti.";
    expect(await previewOperation({ kind: "hide", target: ids(1), termKey: "brand:7" })).toEqual({ ok: false, code: "invalid", error: whole });
    expect(
      await startOperation({ ...sale, target: { kind: "query", query: { taxonomy: "brand", termId: 7, q: "dunk" } }, termKey: "brand:7" }),
    ).toMatchObject({ ok: false, error: whole });
    expect(
      await startOperation({ kind: "unsale", target: { kind: "query", query: { taxonomy: "category", termId: 7 } }, termKey: "brand:7" }),
    ).toMatchObject({ ok: false, error: whole });
    expect(
      await startOperation({ kind: "unsale", target: { kind: "query", query: { taxonomy: "brand", termId: 7 } }, termKey: "brand:7" }),
    ).toMatchObject({ ok: true });
    expect(await previewOperation({ kind: "explode", target: ids(1) } as never)).toMatchObject({ ok: false, code: "invalid" });
  });

  it("checks ids, limits and terms before asking anything", async () => {
    expect(await loadOperation({ id: "not-a-uuid" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await undoOperation({ id: "1" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await undoOperation({ id: "8a7e1c9e-2b6f-4c1a-9d3e-5f2a1b0c4d6e" })).toMatchObject({ ok: true });
    expect(await listOperations({ limit: 101 })).toMatchObject({ ok: false });
    expect(await listOperations()).toEqual({ ok: true, data: 20 });
    expect(await loadTermActions({ taxonomy: "tag" as never, id: 1 })).toMatchObject({ ok: false });
    expect(await loadTermActions({ taxonomy: "brand", id: 7 })).toEqual({ ok: true, data: { taxonomy: "brand", id: 7 } });
  });
});
