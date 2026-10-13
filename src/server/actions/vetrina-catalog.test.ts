import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the validation: the readers are stand-ins that answer what they were asked.
const reads = vi.hoisted(() => ({
  readOverview: vi.fn(),
  readPage: vi.fn(async (query: unknown) => query),
  readPlacement: vi.fn(),
  readTerm: vi.fn(async (taxonomy: string, id: number) => ({ taxonomy, id })),
  search: vi.fn(async (q: string) => q),
}));
vi.mock("@/server/vetrina/catalog", () => reads);
vi.mock("@/server/vetrina/service", () => ({
  attempt: async <T>(fn: () => Promise<T>) => ({ ok: true, data: await fn() }),
}));

import { loadCatalogPage, loadCatalogTerm, searchCatalog } from "./vetrina-catalog";

beforeEach(() => {
  for (const fn of Object.values(reads)) fn.mockClear();
});

describe("the catalog's server actions", () => {
  it("refuses a term without its taxonomy, rather than reading it as a category", async () => {
    expect(await loadCatalogPage({ termId: 1 })).toMatchObject({ ok: false, code: "invalid" });
    expect(reads.readPage).not.toHaveBeenCalled();
    expect(await loadCatalogPage({ taxonomy: "brand", termId: 1 })).toMatchObject({ ok: true });
  });

  it("caps a page at 100 products and a search at 100 characters", async () => {
    expect(await loadCatalogPage({ taxonomy: "category", termId: 1, limit: 101 })).toMatchObject({ ok: false, code: "invalid" });
    expect(await loadCatalogPage({ q: "x".repeat(101) })).toMatchObject({ ok: false, code: "invalid" });
    expect(await searchCatalog({ q: "x".repeat(101) })).toMatchObject({ ok: false, code: "invalid" });
    expect(reads.search).not.toHaveBeenCalled();
    expect(await searchCatalog({ q: "x".repeat(100) })).toMatchObject({ ok: true });
    expect(await loadCatalogPage({ taxonomy: "category", termId: 1, limit: 100 })).toMatchObject({
      ok: true,
      data: { taxonomy: "category", termId: 1, limit: 100 },
    });
  });

  it("knows only categories and brands, by a positive whole id", async () => {
    expect(await loadCatalogTerm({ taxonomy: "tag" as "category", id: 1 })).toMatchObject({ ok: false, code: "invalid" });
    expect(await loadCatalogTerm({ taxonomy: "category", id: 0 })).toMatchObject({ ok: false, code: "invalid" });
    expect(await loadCatalogTerm({ taxonomy: "category", id: 1.5 })).toMatchObject({ ok: false, code: "invalid" });
    expect(await loadCatalogTerm({ taxonomy: "brand", id: 7 })).toEqual({ ok: true, data: { taxonomy: "brand", id: 7 } });
  });

});
