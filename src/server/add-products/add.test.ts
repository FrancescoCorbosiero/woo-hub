import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceProduct } from "@core/core-spine";
import { KICKSDB_UNREACHABLE, NOT_ON_KICKSDB } from "@/lib/add-products";

vi.mock("@/lib/env", () => ({ env: {} }));
const io = vi.hoisted(() => ({
  gsFeedStatus: vi.fn(),
  joinCatalog: vi.fn(),
  publishProducts: vi.fn(),
  findBySku: vi.fn(),
}));
vi.mock("@/server/feeds/owner", () => ({ gsFeedStatus: io.gsFeedStatus }));
vi.mock("@/server/catalog/join", () => ({ joinCatalog: io.joinCatalog }));
vi.mock("@/server/woo/publish", () => ({ publishProducts: io.publishProducts }));
vi.mock("@/server/adapters/kicksdb", () => ({
  kicksdbConfigured: () => true,
  getSource: () => ({ findBySku: io.findBySku, getPricesBatch: vi.fn(), getProduct: vi.fn() }),
}));
vi.mock("@/server/woo/client", () => ({ wooConfigured: () => true }));
vi.mock("@/server/collections/store", () => ({ demoMode: () => false }));
vi.mock("@/server/writer", () => ({ isWriter: () => true, NOT_WRITER: "not the writer" }));
vi.mock("@/server/overrides/repo", () => ({ getOverrides: async () => null }));
vi.mock("@/server/config/repo", () => ({ getActiveConfig: async () => ({ source: { market: "IT" } }) }));

import { addProducts } from "./add";
import { forgetAnswers, remember } from "./kicks-memory";

const outcome = (skus: string[]) => ({
  auditId: "a1",
  identitySkipped: [],
  dryRun: false,
  status: "applied",
  products: skus.map((sku) => ({ sku, title: sku, action: "create", error: null })),
  created: skus.length,
  reimported: 0,
  completed: 0,
  variations: skus.length * 3,
  skipped: 0,
  failed: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  forgetAnswers();
  io.gsFeedStatus.mockResolvedValue({ owned: new Map([["FV5029-010", {}]]), delisted: new Set() });
  io.publishProducts.mockImplementation(async (skus: string[]) => outcome(skus));
});

describe("the one tap", () => {
  it("publishes the feed's codes straight away, and the rest once they joined the catalog", async () => {
    io.joinCatalog.mockResolvedValue({ resolved: new Map([["dd1391 100", "DD1391-100"]]), notFound: [], unreachable: [] });
    const result = await addProducts(["fv5029-010", "dd1391 100"], { dryRun: false });
    // The feed's code never goes near KicksDB.
    expect(io.joinCatalog).toHaveBeenCalledWith(["dd1391 100"], "IT", expect.anything());
    expect(io.publishProducts).toHaveBeenCalledWith(["FV5029-010", "DD1391-100"], { dryRun: false });
    expect(result.created).toBe(2);
  });

  it("brings back the codes KicksDB did not know, or did not answer, as reports the screen words", async () => {
    io.gsFeedStatus.mockResolvedValue({ owned: new Map(), delisted: new Set() });
    io.joinCatalog.mockResolvedValue({ resolved: new Map(), notFound: ["X-1"], unreachable: ["X-2"] });
    const result = await addProducts(["X-1", "X-2"], { dryRun: false });
    expect(io.publishProducts).not.toHaveBeenCalled();
    expect(result.products.map((p) => [p.sku, p.error])).toEqual([
      ["X-1", NOT_ON_KICKSDB],
      ["X-2", KICKSDB_UNREACHABLE],
    ]);
    expect(result.failed).toBe(2);
    expect(result.created).toBe(0);
  });

  it("joins the catalog with KicksDB's answer remembered from the look-up: no second call", async () => {
    io.gsFeedStatus.mockResolvedValue({ owned: new Map(), delisted: new Set() });
    const known = { sku: "B75806", title: "Samba" } as SourceProduct;
    remember("IT", "B75806", known);
    io.joinCatalog.mockImplementation(async (_asked: string[], market: string, source: { findBySku: (s: string, m: string) => Promise<unknown> }) => {
      expect(await source.findBySku("b75806", market)).toBe(known);
      return { resolved: new Map([["B75806", "B75806"]]), notFound: [], unreachable: [] };
    });
    await addProducts(["B75806"], { dryRun: false });
    expect(io.findBySku).not.toHaveBeenCalled();
  });
});
