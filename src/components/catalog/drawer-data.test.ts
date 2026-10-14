import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@core/config";
import type { CatalogEntry } from "@/server/catalog/repo";

/** A catalog row as an old or partial import left it: the product's data without its sizes. */
const entry = {
  sku: "DD1391-100",
  title: "Nike Dunk Low Panda",
  brand: "Nike",
  source: "kicksdb",
  image: "https://img/dunk.jpg",
  minAsk: null,
  addedAt: "2026-01-01T00:00:00Z",
  fetchedAt: "2026-01-01T00:00:00Z",
  product: { sku: "DD1391-100", title: "Nike Dunk Low Panda", brand: "Nike", stockxId: "sx-1", currency: "EUR" },
} as unknown as CatalogEntry;

vi.mock("@/server/catalog/repo", () => ({ getCatalogEntry: async () => entry }));
vi.mock("@/server/overrides/repo", () => ({ getOverrides: async () => null }));
vi.mock("@/server/sync/ledger", () => ({ openStoreEditsForSku: async () => new Map() }));
vi.mock("@/server/feeds/owner", () => ({ gsOwnedProducts: async () => new Map() }));
vi.mock("@/server/adapters/kicksdb", () => ({ kicksdbConfigured: () => true }));
vi.mock("@/server/store-json/repo", () => ({ getSnapshotProductsBySkus: async () => new Map() }));
vi.mock("@/server/pricing/store-terms", () => ({
  withStoreTermsChecked: async <T>(products: T[]) => ({ products, uncertain: new Set() }),
}));

const config = {
  pricingRules: [],
  source: { defaultDeliveryType: "standard", cacheTtlSeconds: 3600 },
} as unknown as AppConfig;

describe("the product drawer's data", () => {
  it("opens a catalog row whose data lacks its sizes, with none", async () => {
    const { loadDrawerData } = await import("./drawer-data");
    const data = await loadDrawerData("IT", "DD1391-100", config);
    expect(data).toMatchObject({ sku: "DD1391-100", title: "Nike Dunk Low Panda", variants: [], appliedRule: null });
  });
});
