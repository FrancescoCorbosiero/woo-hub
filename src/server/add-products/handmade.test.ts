import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandmadeInput } from "@/lib/handmade";

// The shop, the Hub's tables and the photo queue, faked: what is checked is what the executor asks of them.
vi.mock("@/lib/env", () => ({ env: {} }));
const shop = vi.hoisted(() => ({
  findProductsBySku: vi.fn(),
  createProduct: vi.fn(),
  batchVariations: vi.fn(),
  getAllVariations: vi.fn(),
}));
const hub = vi.hoisted(() => ({
  overrides: { global: {}, products: {}, variations: {} } as Record<string, unknown>,
  upsertSnapshotProducts: vi.fn(),
  queueMedia: vi.fn(),
  dropMedia: vi.fn(),
  setMediaProduct: vi.fn(),
  photosTaken: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/server/woo/client", () => ({
  getWooClient: () => shop,
  wooConfigured: () => true,
  wooSiteUrl: () => "https://shop.test",
}));
vi.mock("@/server/woo/taxonomy-cache", () => ({ withTaxonomyCache: <T>(client: T) => client }));
vi.mock("@/server/woo/site-guard", () => ({ assertSnapshotIsThisStore: async () => undefined }));
vi.mock("@/server/woo/publish", () => ({
  resolveTagliaId: async () => 7,
  createOrAdopt: async (client: typeof shop, _sku: string, body: Record<string, unknown>) => ({
    product: await client.createProduct(body),
    adopted: false,
  }),
}));
vi.mock("@/server/woo/identity", () => ({
  buildIdentityResolver: async () => ({ for: () => ({ brandId: 11 }), skipped: [] }),
}));
vi.mock("@/server/woo/media", () => ({ queueMedia: hub.queueMedia, dropMedia: hub.dropMedia, setMediaProduct: hub.setMediaProduct }));
vi.mock("@/server/wordpress/media", () => ({ photosTaken: hub.photosTaken }));
vi.mock("@/server/wordpress/seo", async (actual) => ({
  ...(await actual<typeof import("@/server/wordpress/seo")>()),
  seoPlugin: async () => "rankmath",
}));
vi.mock("@/server/collections/store", () => ({ demoMode: () => false }));
vi.mock("@/server/writer", () => ({ isWriter: () => true, NOT_WRITER: "not the writer" }));
vi.mock("@/server/config/repo", async () => {
  const { buildDefaultConfig } = await import("@/server/config/defaults");
  const config = buildDefaultConfig({ kicksDbApiKey: "", woo: { baseUrl: "", consumerKey: "", consumerSecret: "" }, marketToCurrency: { IT: "EUR" } });
  return { getActiveConfig: async () => config };
});
vi.mock("@/server/overrides/repo", () => ({
  updateOverrides: async (change: (current: never) => Record<string, unknown>) => {
    hub.overrides = change(hub.overrides as never);
    return hub.overrides;
  },
}));
vi.mock("@/server/store-json/repo", () => ({ upsertSnapshotProducts: hub.upsertSnapshotProducts }));
vi.mock("@/server/db/client", () => ({ db: { insert: () => ({ values: (row: unknown) => Promise.resolve(hub.audit(row)) }) } }));

import { createHandmadeProduct } from "./handmade";

const draft: HandmadeInput = {
  sku: "hm-borsa1",
  title: "Borsa in pelle",
  brand: "Artigiana",
  categoryIds: [4],
  description: "Fatta a mano.",
  photos: [{ id: 31, url: "https://shop.test/wp-content/uploads/a.jpg" }],
  sizes: [{ label: "Unica", price: 89.9, stock: 3 }],
  seo: { title: "Borsa in pelle artigianale", description: "", slug: "" },
  visible: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  hub.overrides = { global: {}, products: {}, variations: {} };
  for (const fn of [hub.upsertSnapshotProducts, hub.queueMedia, hub.dropMedia, hub.setMediaProduct]) fn.mockResolvedValue(undefined);
  shop.findProductsBySku.mockResolvedValue([]);
  shop.createProduct.mockImplementation(async (body: Record<string, unknown>) => ({
    id: 501,
    name: body.name,
    status: body.status,
    permalink: "https://shop.test/prodotto/borsa-in-pelle/",
  }));
  shop.batchVariations.mockImplementation(async (_id: number, batch: { create: unknown[] }) => ({
    create: batch.create.map((_, i) => ({ id: 900 + i })),
    update: [],
    delete: [],
  }));
});

describe("a product made by hand", () => {
  it("is made on the shop, owned by the shop, and known to the Hub's copy at once", async () => {
    const outcome = await createHandmadeProduct(draft, "owner");
    expect(outcome).toMatchObject({
      ok: true,
      productId: 501,
      sku: "HM-BORSA1",
      status: "publish",
      permalink: "https://shop.test/prodotto/borsa-in-pelle/",
      editUrl: "https://shop.test/wp-admin/post.php?post=501&action=edit",
      sizes: 1,
      photosQueued: 0,
      failedSizes: [],
    });
    // Looked up live before anything is made.
    expect(shop.findProductsBySku).toHaveBeenCalledWith("HM-BORSA1");
    expect(shop.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        sku: "HM-BORSA1",
        status: "publish",
        images: [{ id: 31 }],
        brands: [{ id: 11 }],
        categories: [{ id: 4 }],
        meta_data: [{ key: "rank_math_title", value: "Borsa in pelle artigianale" }],
      }),
    );
    expect(shop.batchVariations).toHaveBeenCalledWith(501, {
      create: [expect.objectContaining({ sku: "HM-BORSA1-UNICA", regular_price: "89.90", stock_quantity: 3, manage_stock: true })],
    });
    // The shop owns it: the feed and the syncs leave it alone.
    expect(hub.overrides).toMatchObject({ products: { "HM-BORSA1": { owner: "store" } } });
    expect(hub.upsertSnapshotProducts).toHaveBeenCalledWith([
      expect.objectContaining({ id: 501, sku: "HM-BORSA1", variations: [expect.objectContaining({ id: 900, sku: "HM-BORSA1-UNICA" })] }),
    ]);
    // The uploaded photo is the product's now: no longer removable from the form.
    expect(hub.photosTaken).toHaveBeenCalledWith([31]);
    expect(hub.audit).toHaveBeenCalledWith(expect.objectContaining({ status: "applied", result: expect.objectContaining({ kind: "handmade", by: "owner" }) }));
  });

  it("is refused when the shop has a product with its code: nothing is made", async () => {
    shop.findProductsBySku.mockResolvedValue([{ id: 12, name: "Borsa vecchia" }]);
    const outcome = await createHandmadeProduct(draft);
    expect(outcome).toEqual({
      ok: false,
      code: "skuTaken",
      productId: 12,
      title: "Borsa vecchia",
      editUrl: "https://shop.test/wp-admin/post.php?post=12&action=edit",
    });
    expect(shop.createProduct).not.toHaveBeenCalled();
    expect(hub.overrides).toEqual({ global: {}, products: {}, variations: {} });
  });

  it("names what is wrong, and makes nothing", async () => {
    const outcome = await createHandmadeProduct({ ...draft, title: "", sizes: [] });
    expect(outcome).toEqual({ ok: false, code: "invalid", invalid: ["title", "sizes"] });
    expect(shop.findProductsBySku).not.toHaveBeenCalled();
  });

  it("files linked photos before the create, and stays hidden until the first arrives", async () => {
    const outcome = await createHandmadeProduct({ ...draft, photos: [{ url: "https://cdn.test/borsa.jpg" }] });
    expect(outcome).toMatchObject({ ok: true, status: "draft", permalink: null, photosQueued: 1 });
    expect(hub.queueMedia).toHaveBeenCalledWith({
      sku: "HM-BORSA1",
      storeProductId: null,
      title: "Borsa in pelle",
      urls: ["https://cdn.test/borsa.jpg"],
      publish: true,
    });
    expect(hub.queueMedia.mock.invocationCallOrder[0]).toBeLessThan(shop.createProduct.mock.invocationCallOrder[0]);
    expect(hub.setMediaProduct).toHaveBeenCalledWith("HM-BORSA1", 501);
  });

  it("says which sizes WooCommerce refused: the product exists without them", async () => {
    shop.batchVariations.mockResolvedValue({ create: [{ id: 900 }, { error: { message: "invalid" } }], update: [], delete: [] });
    const outcome = await createHandmadeProduct({
      ...draft,
      sizes: [
        { label: "M", price: 40, stock: 1 },
        { label: "L", price: 40, stock: 1 },
      ],
    });
    expect(outcome).toMatchObject({ ok: true, sizes: 1, failedSizes: ["L"] });
    expect(hub.audit).toHaveBeenCalledWith(expect.objectContaining({ status: "partial" }));
  });
});
