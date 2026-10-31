import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationInput, OperationView } from "@/lib/vetrina/catalog-ops";

/**
 * Real-SQL tests of "Elimina": a product to the trash and out of the Hub —
 * its copy of the shop, the store index, the catalog (so Publish never offers
 * it again), its photos — and back with "Annulla", sizes and all; refused for
 * the supplier's feed's products. Against a stand-in store that trashes as
 * WooCommerce does: the product and its sizes, a restore through the API
 * bringing back the product alone. Opt-in, like the other DB suites:
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://…@localhost:…/… REDIS_URL=… npm test
 *
 * It empties vetrina_operations, store_index and the snapshot, and its own
 * rows of the catalog, the feed and the photo queue.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

interface FakeProduct {
  id: number;
  sku: string;
  name: string;
  type: "variable" | "simple";
  status: string;
  sizes: { id: number; status: string }[];
}

const store = vi.hoisted(() => ({
  products: new Map<number, unknown>(),
  /** Products the store refuses to delete (a 403, say). */
  refuse: new Set<number>(),
  client: null as unknown,
}));

vi.mock("@/server/collections/store", () => ({
  storeReady: () => true,
  demoMode: () => false,
  storeClient: async () => store.client,
}));

vi.mock("@/server/collections/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/collections/runner")>()),
  requestCheck: () => undefined,
}));

// A homepage without product sections: no section loses anything.
vi.mock("@/server/vetrina/service", async () => {
  const { VetrinaError } = await import("@/server/vetrina/source");
  return {
    attempt: async <T,>(fn: () => Promise<T>) => ({ ok: true, data: await fn() }),
    readHome: async () => ({ home: { blocks: [] }, collections: {}, locks: {}, source: "fixture" }),
    readRail: async () => {
      throw new VetrinaError("not_found", "Questa sezione non c'è più.", 404);
    },
    publishRail: async () => {
      throw new Error("no section to publish");
    },
  };
});

const load = async () => ({
  ...(await import("drizzle-orm")),
  ...(await import("@/server/db/client")),
  ...(await import("@/server/db/schema")),
  ...(await import("@/server/collections/repo")),
  ...(await import("@/server/collections/index-rows")),
  ...(await import("@/server/store-json/repo")),
  ...(await import("@/server/catalog/repo")),
  ...(await import("@/server/vetrina/catalog")),
  ...(await import("./service")),
  ...(await import("./runner")),
});

const products = () => store.products as Map<number, FakeProduct>;
const product = (id: number) => products().get(id)!;

function view(p: FakeProduct) {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    type: p.type,
    status: p.status,
    permalink: `https://shop/p/${p.id}`,
    categories: [],
    tags: [],
    brands: [],
    attributes: [],
    price: "120.00",
    on_sale: false,
    stock_status: "instock",
    date_created_gmt: "2026-01-01T00:00:00",
    date_modified_gmt: "2026-10-01T00:00:00",
    images: [],
    catalog_visibility: "visible",
    menu_order: 0,
    total_sales: "0",
  };
}

const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });

store.client = {
  async listCategories() {
    return [];
  },
  async listBrands() {
    return [];
  },
  // "any" status, as the index reads: everything but the trash.
  async getProductIndexPage(opts: { page: number; perPage: number; include?: number[] }) {
    let list = [...products().values()].filter((p) => p.status !== "trash");
    if (opts.include) list = list.filter((p) => opts.include!.includes(p.id));
    return { products: list.map(view), total: list.length, totalPages: 1 };
  },
  async getAllVariations(productId: number) {
    return structuredClone(products().get(productId)?.sizes ?? []);
  },
  // WooCommerce's DELETE without force: the product and its sizes to the trash.
  async deleteProduct(productId: number) {
    const p = products().get(productId);
    if (!p) throw httpError("Invalid ID.", 404);
    if (store.refuse.has(productId)) throw httpError("Sorry, you are not allowed to delete this resource.", 403);
    if (p.status === "trash") throw httpError("The product has already been deleted.", 410);
    p.status = "trash";
    for (const s of p.sizes) s.status = "trash";
  },
  async getProduct(productId: number) {
    const p = products().get(productId);
    return p ? view(p) : null;
  },
  // A status through the API: the product alone comes out of the trash.
  async updateProduct(productId: number, body: Record<string, unknown>) {
    const p = products().get(productId);
    if (!p) throw httpError("Invalid ID.", 404);
    if (typeof body.status === "string") p.status = body.status;
  },
  async batchVariations(productId: number, payload: { update?: { id: number; status?: string }[] }) {
    const p = products().get(productId)!;
    const update = (payload.update ?? []).map((row) => {
      const s = p.sizes.find((x) => x.id === row.id);
      if (!s) return { id: row.id, error: { code: "invalid", message: "Invalid ID." } };
      if (row.status) s.status = row.status;
      return { id: s.id };
    });
    return { create: [], update, delete: [] };
  },
};

function add(p: Partial<FakeProduct> & Pick<FakeProduct, "id" | "sku">): FakeProduct {
  const full: FakeProduct = { name: p.sku, type: "variable", status: "publish", sizes: [], ...p };
  products().set(full.id, full);
  return full;
}

const KICKS = "DEL-KICKS-1";
const SIMPLE = "DEL-SIMPLE-1";
const FEED = "DEL-FEED-1";
const SKUS = [KICKS, SIMPLE, FEED];

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

const ids = (...list: number[]) => ({ kind: "ids" as const, ids: list });

async function catalogSkus(): Promise<string[]> {
  const { db, catalogProducts, inArray } = await load();
  const rows = await db.select({ sku: catalogProducts.sku }).from(catalogProducts).where(inArray(catalogProducts.sku, SKUS));
  return rows.map((r) => r.sku).sort();
}

async function snapshotIds(): Promise<number[]> {
  const { getSnapshotProductsByIds } = await load();
  return (await getSnapshotProductsByIds([1, 2, 3])).map((p) => p.id).sort();
}

async function indexIds(): Promise<number[]> {
  const { db, storeIndex } = await load();
  return (await db.select({ id: storeIndex.productId }).from(storeIndex)).map((r) => r.id).sort();
}

describe.skipIf(!enabled)("Elimina (real SQL, stand-in store)", () => {
  beforeEach(async () => {
    const { db, vetrinaOperations, storeIndex, catalogProducts, feedItems, mediaJobs, inArray, saveSnapshot, upsertIndexRows, toIndexRow, forgetHomepagePresence } =
      await load();
    await db.delete(vetrinaOperations);
    await db.delete(storeIndex);
    await db.delete(catalogProducts).where(inArray(catalogProducts.sku, SKUS));
    await db.delete(feedItems).where(inArray(feedItems.sku, SKUS));
    await db.delete(mediaJobs).where(inArray(mediaJobs.sku, SKUS));
    delete (globalThis as { __vetrinaOperations?: unknown }).__vetrinaOperations;
    forgetHomepagePresence();
    products().clear();
    store.refuse.clear();

    // A KicksDB product with a size switched off, one sold as one item, and one of the supplier's feed.
    add({ id: 1, sku: KICKS, sizes: [{ id: 11, status: "publish" }, { id: 12, status: "private" }] });
    add({ id: 2, sku: SIMPLE, type: "simple" });
    add({ id: 3, sku: FEED, sizes: [{ id: 31, status: "publish" }] });
    await upsertIndexRows([...products().values()].map((p) => toIndexRow(view(p) as never)));
    await saveSnapshot(
      { products: [...products().values()].map((p) => ({ id: p.id, sku: p.sku, name: p.name, variations: [] })) } as never,
      "rest",
    );
    const row = (sku: string, source: string) => ({ market: "IT", sku, source, stockxId: `sx-${sku}`, title: sku, data: { sku, title: sku, variants: [] } as never });
    await db.insert(catalogProducts).values([row(KICKS, "kicksdb"), row(SIMPLE, "kicksdb"), row(FEED, "goldensneakers")]);
    await db.insert(feedItems).values({
      feed: "goldensneakers",
      sku: FEED,
      euNorm: "42",
      sizeLabel: "42",
      quantity: 3,
      active: true,
      presentedPrice: 120,
      offerPrice: 80,
      productName: FEED,
      brandName: "B",
    });
    // A photo still on its way: landing, it would put the product back on sale.
    await db.insert(mediaJobs).values({ sku: KICKS, storeProductId: 1, title: KICKS, images: [], publish: true });
  });

  it("trashes the product and the Hub forgets it; Annulla brings it back, sizes and all", async () => {
    const { db, mediaJobs, eq } = await load();
    const done = await run({ kind: "delete", target: ids(1, 2) });
    expect(done).toMatchObject({ status: "done", changed: 2, failed: 0, label: "2 prodotti eliminati", undoable: true });

    // Gone from the shop, sizes with it…
    expect(product(1).status).toBe("trash");
    expect(product(1).sizes.map((s) => s.status)).toEqual(["trash", "trash"]);
    // …and from the Hub: its copy, the Vetrina's lists, the catalog Publish lists from, the photo queue.
    expect(await snapshotIds()).toEqual([3]);
    expect(await indexIds()).toEqual([3]);
    expect(await catalogSkus()).toEqual([FEED]);
    const [job] = await db.select().from(mediaJobs).where(eq(mediaJobs.sku, KICKS));
    expect(job.status).toBe("cancelled");

    const undone = await undo(done.id);
    expect(undone.undo).toMatchObject({ restored: 2, kept: 0, failed: 0 });
    // Out of the trash with its status, each size with its own (the one switched off stays off).
    expect(product(1).status).toBe("publish");
    expect(product(1).sizes.map((s) => s.status)).toEqual(["publish", "private"]);
    expect(product(2).status).toBe("publish");
    expect(await catalogSkus()).toEqual([FEED, KICKS, SIMPLE].sort());
    expect(await snapshotIds()).toEqual([1, 2, 3]);
    expect(await indexIds()).toEqual([1, 2, 3]);
  });

  it("refuses the supplier's feed's products: the feed would put them back", async () => {
    const { previewOperation } = await load();
    const only = await previewOperation({ kind: "delete", target: ids(3) });
    expect(only.changes).toBe(0);
    expect(only.warnings[0]).toMatch(/arriva dal feed GoldenSneakers/);

    const mixed = await previewOperation({ kind: "delete", target: ids(1, 3) });
    expect(mixed.changes).toBe(1);
    expect(mixed.untouched).toEqual([{ reason: "arriva dal feed GoldenSneakers, che lo rimetterebbe", count: 1 }]);
    expect(mixed.sample.map((s) => s.after)).toEqual(["Eliminato"]);

    const done = await run({ kind: "delete", target: ids(1, 3) });
    expect(done.changed).toBe(1);
    expect(product(3).status).toBe("publish");
    expect(await catalogSkus()).toEqual([FEED, SIMPLE].sort());
  });

  it("a product emptied from the trash since cannot come back: left, and said", async () => {
    const done = await run({ kind: "delete", target: ids(1) });
    products().delete(1);
    const undone = await undo(done.id);
    expect(undone.undo).toMatchObject({ restored: 0, kept: 1, failed: 0 });
    expect(await catalogSkus()).toEqual([FEED, SIMPLE].sort());
  });

  it("a product the store will not delete stays — in the shop and in the Hub", async () => {
    store.refuse.add(1);
    const done = await run({ kind: "delete", target: ids(1, 2) });
    expect(done).toMatchObject({ changed: 1, failed: 1 });
    expect(product(1).status).toBe("publish");
    expect(await catalogSkus()).toEqual([FEED, KICKS].sort());
    expect(await snapshotIds()).toEqual([1, 3]);
  });
});
