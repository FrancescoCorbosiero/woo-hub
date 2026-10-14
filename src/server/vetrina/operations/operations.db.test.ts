import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationInput, OperationView } from "@/lib/vetrina/catalog-ops";

/**
 * Real-SQL tests of the catalog's actions — every kind, its undo, the queue
 * and a restart — against a stand-in store and a stand-in homepage.
 * Opt-in: they need a THROWAWAY Postgres with the migrations applied, and
 * they empty vetrina_operations, store_index, smart_collections,
 * store_overrides and the snapshot. Run with
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://…@localhost:…/… REDIS_URL=… npx vitest run --no-file-parallelism <this file>
 *
 * Imports are dynamic because the db client validates the environment on load.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

interface FakeSize {
  id: number;
  regular_price: string;
  sale_price: string;
  date_on_sale_from: string | null;
  date_on_sale_to: string | null;
}

interface FakeProduct {
  id: number;
  sku: string;
  name: string;
  type: "variable" | "simple";
  categories: number[];
  tags: number[];
  brands: number[];
  visibility: string;
  /** A simple product's own prices; a variable one's sizes. */
  own: FakeSize;
  sizes: FakeSize[];
  modified: number;
}

type Term = { id: number; name: string; slug: string; parent?: number };

const gmt = (ms: number) => new Date(ms).toISOString().slice(0, 19);
const DEFAULT_CATEGORY = 15;

/** The store, as far as the actions can tell — and a log of every write, in order. */
const store = vi.hoisted(() => ({
  products: new Map<number, unknown>(),
  categories: [] as { id: number; name: string; slug: string; parent?: number }[],
  brands: [] as { id: number; name: string; slug: string; parent?: number }[],
  tags: [] as { id: number; name: string; slug: string }[],
  /** Every write, in order: what it touched, and the body. */
  writes: [] as { what: string; id: number; body: Record<string, unknown> }[],
  refuse: new Set<number>(),
  /** Products whose sizes' batch fails whole, as a product trashed meanwhile does (a 404). */
  gone: new Set<number>(),
  /** Slows every batch: a second action has every chance to slip in between. */
  delayMs: 0,
  clock: Date.parse("2026-10-13T08:00:00Z"),
  nextTerm: 900,
  client: null as unknown,
}));

/** The homepage, as far as "Metti in homepage" can tell: product sections with pins, hidden ones and a fingerprint. */
const home = vi.hoisted(() => ({
  rails: new Map<
    string,
    { key: string; title: string; taxonomy: string; term: { id: number; name: string; slug: string }; pin: number[]; exclude: number[]; hash: number }
  >(),
  modified: "2026-10-13 08:00:00",
  collections: {} as Record<number, unknown>,
}));

const checks = vi.hoisted(() => ({ requested: 0 }));

vi.mock("@/server/collections/store", () => ({
  storeReady: () => true,
  demoMode: () => false,
  storeClient: async () => store.client,
}));

vi.mock("@/server/collections/runner", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/collections/runner")>();
  // The automatic categories catching up is their own business (runner.db.test.ts): here, only that it is asked.
  return { ...real, requestCheck: () => void (checks.requested += 1) };
});

vi.mock("@/server/vetrina/service", async () => {
  const { VetrinaError } = await import("@/server/vetrina/source");
  const members = (rail: { taxonomy: string; term: { id: number } }) =>
    [...(store.products.values() as Iterable<FakeProduct>)]
      .filter((p) => (rail.taxonomy === "product_cat" ? p.categories : p.brands).includes(rail.term.id))
      .map((p) => p.id);
  const summary = (key: string) => {
    const r = home.rails.get(key)!;
    const visible = members(r).filter((id) => (store.products.get(id) as FakeProduct).visibility !== "hidden");
    return {
      key: r.key,
      path: "8.0",
      attrsHash: `hash-${r.hash}`,
      title: r.title,
      taxonomy: r.taxonomy,
      terms: [{ ...r.term, count: members(r).length, link: null }],
      pin: [...r.pin],
      exclude: [...r.exclude],
      fallback: "menu_order",
      editable: true,
      fields: {},
      visible,
      products: visible.map((id) => ({ id, name: (store.products.get(id) as FakeProduct).name })),
    };
  };
  return {
    attempt: async <T,>(fn: () => Promise<T>) => ({ ok: true, data: await fn() }),
    readHome: async () => ({
      home: { blocks: [...home.rails.keys()].map((key) => ({ kind: "rail", path: "8.0", name: "x", rail: summary(key) })) },
      collections: home.collections,
      locks: {},
      source: "fixture",
    }),
    readRail: async (key: string) => {
      if (!home.rails.has(key)) throw new VetrinaError("not_found", "Questa sezione non c'è più.", 404);
      const rail = { ...summary(key), modifiedGmt: home.modified, items: [], hidden: [], total: 0, offset: 0 };
      const term = home.rails.get(key)!.term.id;
      return { rail, collection: rail.taxonomy === "product_cat" ? (home.collections[term] ?? null) : null, locks: {}, source: "fixture" };
    },
    publishRail: async (input: { key: string; expectedModifiedGmt: string; expectedAttrsHash: string; pin: number[]; exclude: number[] }) => {
      const r = home.rails.get(input.key)!;
      if (input.expectedModifiedGmt !== home.modified || input.expectedAttrsHash !== `hash-${r.hash}`) {
        throw new VetrinaError("stale", "La homepage è stata modificata nel frattempo: ricarica la sezione.", 409);
      }
      r.pin = [...input.pin];
      r.exclude = [...input.exclude];
      r.hash += 1;
      return { dryRun: false, changed: true, before: "", after: "", modifiedGmt: home.modified, attrsHash: `hash-${r.hash}`, rendered: [], fields: {} };
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
  ...(await import("@/server/overrides/repo")),
  ...(await import("@/server/overrides/model")),
  ...(await import("@/server/vetrina/catalog")),
  ...(await import("./service")),
  ...(await import("./runner")),
  ...(await import("./repo")),
});

/* ---------------------------------------------------------------- *
 * The stand-in store
 * ---------------------------------------------------------------- */

const products = () => store.products as Map<number, FakeProduct>;
const product = (id: number) => products().get(id)!;
const termOf = (list: Term[], id: number) => {
  const t = list.find((x) => x.id === id)!;
  return { id: t.id, name: t.name, slug: t.slug };
};

const cents = (s: string) => (s ? Math.round(Number.parseFloat(s) * 100) : null);
const shelf = (s: FakeSize) => cents(s.sale_price) ?? cents(s.regular_price);

function view(p: FakeProduct) {
  const sizes = p.type === "variable" ? p.sizes : [p.own];
  const prices = sizes.map(shelf).filter((c): c is number => c != null);
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    type: p.type,
    status: "publish",
    permalink: `https://shop/p/${p.id}`,
    categories: p.categories.map((id) => termOf(store.categories, id)),
    tags: p.tags.map((id) => termOf(store.tags, id)),
    brands: p.brands.map((id) => termOf(store.brands, id)),
    attributes: [],
    price: prices.length ? (Math.min(...prices) / 100).toFixed(2) : "",
    on_sale: sizes.some((s) => cents(s.sale_price) != null),
    stock_status: "instock",
    date_created_gmt: gmt(Date.parse("2026-01-01T00:00:00Z")),
    date_modified_gmt: gmt(p.modified),
    images: [],
    catalog_visibility: p.visibility,
    menu_order: 0,
    total_sales: "0",
  };
}

const pause = () => new Promise((resolve) => setTimeout(resolve, store.delayMs));

function saved(p: FakeProduct) {
  store.clock += 1000;
  p.modified = store.clock;
}

function applySale(size: FakeSize, body: Record<string, unknown>) {
  if ("sale_price" in body) size.sale_price = String(body.sale_price ?? "");
  if ("date_on_sale_from" in body) size.date_on_sale_from = (body.date_on_sale_from as string) || null;
  if ("date_on_sale_to" in body) size.date_on_sale_to = (body.date_on_sale_to as string) || null;
  if ("regular_price" in body) size.regular_price = String(body.regular_price);
}

store.client = {
  async getProductIndexPage(opts: { page: number; perPage: number; include?: number[] }) {
    let list = [...products().values()];
    if (opts.include) list = list.filter((p) => opts.include!.includes(p.id));
    const page = list.slice((opts.page - 1) * opts.perPage, opts.page * opts.perPage);
    return { products: page.map(view), total: list.length, totalPages: 1 };
  },
  async batchUpdateProducts(updates: ({ id: number } & Record<string, unknown>)[]) {
    await pause();
    return updates.map((u) => {
      store.writes.push({ what: "product", id: u.id, body: u });
      const p = products().get(u.id);
      if (!p || store.refuse.has(u.id)) return { id: u.id, product: null, error: "Refused by the store." };
      if (typeof u.catalog_visibility === "string") p.visibility = u.catalog_visibility;
      if (u.tags) p.tags = (u.tags as { id: number }[]).map((t) => t.id);
      if (u.categories) {
        p.categories = (u.categories as { id: number }[]).map((c) => c.id);
        // WooCommerce: a product left without categories goes into the default one.
        if (p.categories.length === 0) p.categories = [DEFAULT_CATEGORY];
      }
      // A product sold as one item takes its sale on itself.
      if (p.type === "simple") applySale(p.own, u);
      saved(p);
      return { id: p.id, product: view(p), error: null };
    });
  },
  async getAllVariations(productId: number) {
    return structuredClone(products().get(productId)?.sizes ?? []);
  },
  async batchVariations(productId: number, payload: { update?: Record<string, unknown>[] }) {
    await pause();
    if (store.gone.has(productId)) throw Object.assign(new Error("Invalid ID."), { status: 404 });
    const p = products().get(productId)!;
    const update = (payload.update ?? []).map((row) => {
      store.writes.push({ what: "size", id: row.id as number, body: row });
      const size = p.sizes.find((s) => s.id === row.id);
      if (!size || store.refuse.has(row.id as number)) return { id: row.id as number, error: { code: "invalid", message: "refused" } };
      applySale(size, row);
      return { id: size.id };
    });
    saved(p);
    return { create: [], update, delete: [] };
  },
  async getProduct(productId: number) {
    const p = products().get(productId);
    return p ? { ...view(p), ...structuredClone(p.own), id: p.id } : null;
  },
  async updateProduct(productId: number, body: Record<string, unknown>) {
    await pause();
    store.writes.push({ what: "product", id: productId, body });
    if (store.refuse.has(productId)) throw Object.assign(new Error("Invalid sale price."), { status: 400 });
    const p = products().get(productId)!;
    applySale(p.own, body);
    saved(p);
  },
  async listCategories() {
    return store.categories;
  },
  async listBrands() {
    return store.brands;
  },
  async listTags() {
    return store.tags;
  },
  async createTag(name: string) {
    const tag = { id: store.nextTerm++, name, slug: name.toLowerCase() };
    store.tags.push(tag);
    return tag;
  },
};

const size = (id: number, regular: string, sale = ""): FakeSize => ({
  id,
  regular_price: regular,
  sale_price: sale,
  date_on_sale_from: null,
  date_on_sale_to: null,
});

function add(p: Partial<FakeProduct> & Pick<FakeProduct, "id">): FakeProduct {
  const full: FakeProduct = {
    sku: `SKU-${p.id}`,
    name: `Product ${p.id}`,
    type: "variable",
    categories: [10],
    tags: [],
    brands: [100],
    visibility: "visible",
    own: size(p.id, ""),
    sizes: [],
    modified: Date.parse("2026-10-01T00:00:00Z"),
    ...p,
  };
  products().set(full.id, full);
  return full;
}

/* ---------------------------------------------------------------- *
 * Helpers
 * ---------------------------------------------------------------- */

async function indexStore() {
  const { upsertIndexRows, toIndexRow } = await load();
  await upsertIndexRows([...products().values()].map((p) => toIndexRow(view(p) as never)));
}

/** Start an action and wait until the queue is done with it. */
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
const brand = (termId: number) => ({ kind: "query" as const, query: { taxonomy: "brand" as const, termId } });
/** A sample's prices as the tests write them: Intl puts a non-breaking space before "€". */
const plainSample = (preview: { sample: { id: number; before: string; after: string }[] }, id: number) => {
  const s = preview.sample.find((x) => x.id === id);
  return s && { before: s.before.replace(/\u00a0/g, " "), after: s.after.replace(/\u00a0/g, " ") };
};
const category = (termId: number) => ({ kind: "query" as const, query: { taxonomy: "category" as const, termId } });
const regularWrites = () => store.writes.filter((w) => "regular_price" in w.body);

describe.skipIf(!enabled)("the catalog's actions (real SQL, stand-in store)", () => {
  beforeEach(async () => {
    const { db, vetrinaOperations, storeIndex, smartCollections, storeOverrides, storeSnapshot, forgetHomepagePresence } = await load();
    await db.delete(vetrinaOperations);
    await db.delete(storeIndex);
    await db.delete(smartCollections);
    await db.delete(storeOverrides);
    await db.delete(storeSnapshot);
    delete (globalThis as { __vetrinaOperations?: unknown }).__vetrinaOperations;
    forgetHomepagePresence();
    products().clear();
    store.categories = [
      { id: 10, name: "Sneakers", slug: "sneakers", parent: 0 },
      { id: 11, name: "Saldi", slug: "saldi", parent: 0 },
      { id: 12, name: "Novità", slug: "novita", parent: 0 },
      { id: DEFAULT_CATEGORY, name: "Senza categoria", slug: "senza-categoria", parent: 0 },
      { id: 20, name: "Outlet", slug: "outlet", parent: 0 },
    ];
    store.brands = [
      { id: 100, name: "Nike", slug: "nike", parent: 0 },
      { id: 101, name: "Nike Dunk", slug: "nike-dunk", parent: 100 },
      { id: 200, name: "Adidas", slug: "adidas", parent: 0 },
    ];
    store.tags = [{ id: 7, name: "saldi", slug: "saldi" }];
    store.writes = [];
    store.refuse.clear();
    store.gone.clear();
    store.delayMs = 0;
    checks.requested = 0;
    home.rails.clear();
    home.collections = {};

    add({ id: 1, name: "Air Max", sizes: [size(11, "129.00"), size(12, "139.00")] });
    add({ id: 2, name: "Dunk Low", categories: [10, 11], brands: [101], sizes: [size(21, "99.00", "89.00"), size(22, "")] });
    add({ id: 3, name: "Samba", type: "simple", brands: [200], own: size(3, "59.90") });
    add({ id: 4, name: "Gazelle", brands: [200], visibility: "hidden", sizes: [size(41, "200.00")] });
    add({ id: 5, name: "Calze", type: "simple", categories: [11], own: size(5, "9.99") });
    await indexStore();
  });

  it("hides a whole category, says where else it disappears, refuses a second hide, and «Mostra» puts back exactly what it hid", async () => {
    const { previewOperation, loadTermActions, startOperation, readIndexRowsById, listItems } = await load();
    home.rails.set("category:saldi#0", {
      key: "category:saldi#0",
      title: "SALDI",
      taxonomy: "product_cat",
      term: { id: 11, name: "Saldi", slug: "saldi" },
      pin: [],
      exclude: [],
      hash: 1,
    });
    const input: OperationInput = { kind: "hide", target: category(10), termKey: "category:10" };

    const preview = await previewOperation(input);
    expect(preview.changes).toBe(3);
    // Said for one: "già nascosto", not "già nascosti".
    expect(preview.untouched).toEqual([{ reason: "già nascosto", count: 1 }]);
    expect(preview.sample.map((s) => [s.name, s.before, s.after])).toContainEqual(["Air Max", "Visibile", "Nascosto"]);
    expect(preview.warnings.join(" ")).toContain("3 sono anche in");
    expect(preview.warnings.join(" ")).toContain("Nike");
    expect(preview.warnings.join(" ")).toContain("SALDI (1)");

    const op = await run(input);
    expect(op).toMatchObject({ status: "done", changed: 3, failed: 0, label: "3 prodotti nascosti · Sneakers", undoable: true });
    expect([1, 2, 3, 4].map((id) => product(id).visibility)).toEqual(["hidden", "hidden", "hidden", "hidden"]);
    expect((await readIndexRowsById([1])).map((r) => r.visibility)).toEqual(["hidden"]);
    expect((await listItems(op.id)).map((i) => [i.productId, i.before, i.after])).toEqual([
      [1, "visible", "hidden"],
      [2, "visible", "hidden"],
      [3, "visible", "hidden"],
    ]);

    const state = await loadTermActions("category", 10);
    expect(state.hiddenBy?.id).toBe(op.id);
    await expect(startOperation(input)).rejects.toThrow("già nascosti: per rimetterli in vista usa «Mostra»");
    expect((await previewOperation(input)).warnings[0]).toContain("usa «Mostra»");

    // Someone made Dunk Low "search only" in WordPress meanwhile: that newer word stands.
    product(2).visibility = "search";
    const shown = await undo(op.id);
    expect(shown).toMatchObject({ status: "undone", undoable: false, undo: { restored: 2, kept: 1, failed: 0 } });
    expect([1, 2, 3, 4].map((id) => product(id).visibility)).toEqual(["visible", "search", "visible", "hidden"]);
    expect((await loadTermActions("category", 10)).hiddenBy).toBeNull();
  });

  it("puts a category on sale size by size, never writing a regular price, and its undo leaves a price changed since", async () => {
    const { previewOperation, loadTermActions, saveSnapshot, getSnapshotProductsByIds, saveOverrides, emptyOverrides, withProductSaleRule, readIndexRowsById } =
      await load();
    await saveSnapshot({ products: [{ id: 1, sku: "SKU-1", name: "Air Max", variations: structuredClone(product(1).sizes) }] } as never, "rest");
    await saveOverrides(withProductSaleRule(emptyOverrides(), "SKU-3", false));
    const input: OperationInput = {
      kind: "sale",
      target: category(10),
      percent: 20,
      rounding: "charm",
      endsOn: "2099-12-31",
      termKey: "category:10",
    };

    const preview = await previewOperation(input);
    expect(preview).toMatchObject({ changes: 4, sampled: 4 });
    expect(plainSample(preview, 1)).toEqual({ before: "da 129,00 €", after: "da 102,99 €" });
    expect(plainSample(preview, 3)).toEqual({ before: "59,90 €", after: "46,99 €" });
    expect(preview.warnings).toContainEqual(expect.stringContaining("Per 1 prodotto l'Hub ricalcola il prezzo anche in saldo"));

    const op = await run(input);
    expect(op).toMatchObject({ status: "done", changed: 4, label: "Saldo −20% · Sneakers" });
    // A rule can read a sale (on sale, a price): the automatic categories follow at once.
    expect(checks.requested).toBe(1);
    // The product sold as one item took its sale through the products' batch.
    expect(store.writes.find((w) => w.id === 3)).toMatchObject({ what: "product", body: { sale_price: "46.99" } });
    expect(product(1).sizes.map((s) => [s.sale_price, s.date_on_sale_to])).toEqual([
      ["102.99", "2099-12-31T23:59:59"],
      ["110.99", "2099-12-31T23:59:59"],
    ]);
    // A size without a regular price is skipped; the regular prices are as they were.
    expect(product(2).sizes.map((s) => [s.regular_price, s.sale_price])).toEqual([
      ["99.00", "78.99"],
      ["", ""],
    ]);
    expect(product(3).own.sale_price).toBe("46.99");
    expect(regularWrites()).toEqual([]);
    // The snapshot learns the sale (the price engine leaves a size on sale alone); the index too.
    const [snap] = await getSnapshotProductsByIds([1]);
    expect(snap.variations.map((v) => v.sale_price)).toEqual(["102.99", "110.99"]);
    expect((await readIndexRowsById([1])).map((r) => [r.onSale, r.price])).toEqual([[true, 102.99]]);
    expect((await loadTermActions("category", 10)).sale).toMatchObject({ percent: 20, endsOn: "2099-12-31" });

    // The owner re-priced one size by hand since: that one stays.
    product(1).sizes[1].sale_price = "120.00";
    const undone = await undo(op.id);
    expect(undone.undo).toMatchObject({ kept: 1, failed: 0 });
    expect(checks.requested).toBe(2);
    expect(product(1).sizes.map((s) => s.sale_price)).toEqual(["", "120.00"]);
    expect(product(2).sizes[0]).toMatchObject({ sale_price: "89.00", date_on_sale_to: null });
    expect(product(3).own.sale_price).toBe("");
    expect(regularWrites()).toEqual([]);
    expect((await getSnapshotProductsByIds([1]))[0].variations.map((v) => v.sale_price)).toEqual(["", "110.99"]);
    expect((await loadTermActions("category", 10)).sale).toBeNull();
  });

  it("ends a sale only where there is one, and «Annulla» puts it back", async () => {
    const { previewOperation } = await load();
    product(1).sizes[0].sale_price = "100.00";
    product(1).sizes[0].date_on_sale_to = "2099-01-31T23:59:59";
    await indexStore();
    const input: OperationInput = { kind: "unsale", target: ids(1, 2, 3) };
    const preview = await previewOperation(input);
    expect(preview.changes).toBe(2);
    expect(preview.untouched).toContainEqual({ reason: "non è in saldo", count: 1 });
    expect(plainSample(preview, 2)).toEqual({ before: "89,00 €", after: "99,00 €" });

    const op = await run(input);
    expect(op).toMatchObject({ status: "done", changed: 2, label: "Saldo tolto · 2 prodotti" });
    expect(product(1).sizes[0]).toMatchObject({ sale_price: "", date_on_sale_to: null });
    expect(product(2).sizes[0].sale_price).toBe("");

    const undone = await undo(op.id);
    expect(undone.undo).toEqual({ restored: 2, kept: 0, failed: 0 });
    expect(product(1).sizes[0]).toMatchObject({ sale_price: "100.00", date_on_sale_to: "2099-01-31T23:59:59" });
    expect(product(2).sizes[0].sale_price).toBe("89.00");
    expect(regularWrites()).toEqual([]);
  });

  it("tags with a new tag, lets the automatic categories follow, and its undo keeps a tag added since", async () => {
    const { previewOperation, readIndexRowsById } = await load();
    const input: OperationInput = { kind: "tag", target: ids(1, 3), tag: { name: "estate" } };
    const preview = await previewOperation(input);
    expect(preview.changes).toBe(2);
    expect(preview.warnings).toEqual(["Il tag «estate» non c'è ancora: lo creo."]);

    const op = await run(input);
    const estate = store.tags.find((t) => t.name === "estate")!;
    expect(op).toMatchObject({ status: "done", changed: 2, label: "Tag «estate» a 2 prodotti" });
    expect(product(1).tags).toEqual([estate.id]);
    expect((await readIndexRowsById([3]))[0].tags.map((t) => t.name)).toEqual(["estate"]);
    expect(checks.requested).toBe(1);

    // Tag "saldi" added to Air Max since: it stays when "estate" goes.
    product(1).tags.push(7);
    await undo(op.id);
    expect(product(1).tags).toEqual([7]);
    expect(product(3).tags).toEqual([]);

    const untag = await run({ kind: "untag", target: ids(1, 3), tagId: 7 });
    expect(untag).toMatchObject({ changed: 1, label: "Tag «saldi» tolto da 1 prodotto" });
    expect(product(1).tags).toEqual([]);
  });

  it("adds and removes a manual category, warns of products left without one, and refuses an automatic category", async () => {
    const { previewOperation, startOperation, insertCollection, listItems } = await load();
    const add20 = await run({ kind: "categorize", target: ids(1, 3), categoryId: 20 });
    expect(add20).toMatchObject({ changed: 2, label: "Categoria «Outlet» a 2 prodotti" });
    expect(product(1).categories).toEqual([10, 20]);

    const remove: OperationInput = { kind: "uncategorize", target: ids(5), categoryId: 11 };
    expect((await previewOperation(remove)).warnings).toEqual([
      "1 resta senza categoria: WooCommerce lo mette in quella predefinita.",
    ]);
    const removed = await run(remove);
    expect(product(5).categories).toEqual([DEFAULT_CATEGORY]);
    // The item keeps what the store shows, so the undo takes the default category away again.
    expect((await listItems(removed.id))[0]).toMatchObject({ before: [11], after: [DEFAULT_CATEGORY] });
    await undo(removed.id);
    expect(product(5).categories).toEqual([11]);

    await insertCollection({ termId: 12, name: "Novità", match: "all", conditions: [], enabled: true });
    const automatic: OperationInput = { kind: "categorize", target: ids(1), categoryId: 12 };
    const refused = await previewOperation(automatic);
    expect(refused).toMatchObject({ changes: 0, warnings: ["«Novità» è automatica: i suoi prodotti li decide la regola."] });
    await expect(startOperation(automatic)).rejects.toThrow("è automatica");
    expect(product(1).categories).toEqual([10, 20]);
  });

  it("pins into a manual category's section — adding the category first — and its undo puts the section and the categories back", async () => {
    const { previewOperation, listItems, getOperation } = await load();
    home.rails.set("category:saldi#0", {
      key: "category:saldi#0",
      title: "SALDI",
      taxonomy: "product_cat",
      term: { id: 11, name: "Saldi", slug: "saldi" },
      pin: [5],
      exclude: [2],
      hash: 1,
    });
    const input: OperationInput = { kind: "pin", target: ids(3, 1, 2), sectionKey: "category:saldi#0" };
    const preview = await previewOperation(input);
    expect(preview.changes).toBe(3);
    expect(preview.warnings).toEqual([
      "2 prodotti non sono in «Saldi»: li aggiungo, così si vede nella sezione.",
      "1 era nascosto da questa sezione: torna a vedersi.",
    ]);
    expect(preview.sample.map((s) => s.after)).toEqual(["In «Saldi», poi fissato", "In «Saldi», poi fissato", "#3 fissato"]);

    const op = await run(input);
    expect(op).toMatchObject({ status: "done", changed: 3, label: "3 prodotti fissati in SALDI" });
    const rail = home.rails.get("category:saldi#0")!;
    expect(rail).toMatchObject({ pin: [3, 1, 2, 5], exclude: [] });
    expect(product(3).categories).toEqual([10, 11]);
    expect((await listItems(op.id)).map((i) => i.productId).sort()).toEqual([1, 3]);
    expect((await getOperation(op.id))?.section).toMatchObject({ before: { pin: [5], exclude: [2] }, attrsHash: "hash-2" });

    const undone = await undo(op.id);
    expect(undone.status).toBe("undone");
    expect(rail).toMatchObject({ pin: [5], exclude: [2] });
    expect(product(3).categories).toEqual([10]);
    expect(product(1).categories).toEqual([10]);
  });

  it("pins only a brand section's own products, and refuses to undo over a section changed since", async () => {
    const { previewOperation, undoOperation } = await load();
    home.rails.set("brand:adidas#0", {
      key: "brand:adidas#0",
      title: "ADIDAS",
      taxonomy: "product_brand",
      term: { id: 200, name: "Adidas", slug: "adidas" },
      pin: [],
      exclude: [],
      hash: 1,
    });
    const input: OperationInput = { kind: "pin", target: ids(1, 3), sectionKey: "brand:adidas#0" };
    expect((await previewOperation(input)).untouched).toEqual([{ reason: "non è in questa sezione", count: 1 }]);
    const op = await run(input);
    expect(op).toMatchObject({ changed: 1, label: "1 prodotto fissato in ADIDAS" });
    expect(home.rails.get("brand:adidas#0")!.pin).toEqual([3]);
    expect(product(1).brands).toEqual([100]);

    // The owner reordered the section in its editor since.
    home.rails.get("brand:adidas#0")!.hash += 1;
    await expect(undoOperation(op.id)).rejects.toThrow("La sezione «ADIDAS» è cambiata dopo");
  });

  it("runs one action at a time, in the order asked", async () => {
    const { startOperation, idle, loadOperation } = await load();
    for (let id = 30; id < 90; id++) add({ id, sizes: [size(id * 10, "100.00")] });
    await indexStore();
    store.delayMs = 20;
    const everything = ids(...[...products().keys()]);
    const hide = await startOperation({ kind: "hide", target: everything });
    const tag = await startOperation({ kind: "tag", target: everything, tag: { id: 7, name: "saldi" } });
    expect(tag.queued).toBe(true);
    await idle();
    const order = store.writes.map((w) => ("catalog_visibility" in w.body ? "hide" : "tag"));
    expect(order.indexOf("tag")).toBeGreaterThan(order.lastIndexOf("hide"));
    expect(order.filter((o) => o === "hide").length).toBeGreaterThan(25);
    expect(await loadOperation(hide.id)).toMatchObject({ status: "done", changed: 64, progress: { done: 65, total: 65 } });
    expect(await loadOperation(tag.id)).toMatchObject({ status: "done", queued: false });
  });

  it("marks what a restart cut off as interrupted, and lets its changes be undone", async () => {
    const { db, vetrinaOperations, listOperations, addItems, undoOperation, idle, loadOperation } = await load();
    // Cut off right after its write was sent: nothing counted yet, but the value is filed.
    const [cut] = await db
      .insert(vetrinaOperations)
      .values({ kind: "hide", input: { kind: "hide", target: ids(1) }, label: "1 prodotto nascosto", status: "running", total: 1, done: 0, changed: 0 })
      .returning();
    await addItems(cut.id, [{ productId: 1, field: "visibility", before: "visible", after: "hidden" }]);
    product(1).visibility = "hidden";
    // A new process: nothing of the old one's queue survives.
    delete (globalThis as { __vetrinaOperations?: unknown }).__vetrinaOperations;

    const [listed] = await listOperations(10);
    expect(listed).toMatchObject({
      id: cut.id,
      status: "failed",
      changed: 1,
      error: "Interrotta: il server si è riavviato prima della fine.",
      undoable: true,
    });
    await undoOperation(cut.id);
    await idle();
    expect(await loadOperation(cut.id)).toMatchObject({ status: "undone" });
    expect(product(1).visibility).toBe("visible");
  });

  it("counts what the store refuses, and files only what it took", async () => {
    const { listItems } = await load();
    store.refuse.add(3);
    const hide = await run({ kind: "hide", target: ids(1, 3) });
    expect(hide).toMatchObject({ status: "done", changed: 1, failed: 1 });
    expect((await listItems(hide.id)).map((i) => i.productId)).toEqual([1]);

    // One size of Air Max refused: the product counts as changed and as refused; only the size taken is filed.
    store.refuse.add(12);
    const sale = await run({ kind: "sale", target: ids(1, 3), percent: 10, rounding: "exact", endsOn: null });
    expect(sale).toMatchObject({ status: "done", changed: 1, failed: 2 });
    expect((await listItems(sale.id)).map((i) => [i.productId, i.variationId])).toEqual([[1, 11]]);
    expect(product(1).sizes.map((s) => s.sale_price)).toEqual(["116.10", ""]);
  });

  it("keeps 30 days of log — and a whole term's hide for as long as it stands", async () => {
    const { db, vetrinaOperations, trimOperations, listOperations } = await load();
    const old = new Date(Date.now() - 40 * 86_400_000);
    const row = (label: string, extra: Record<string, unknown>) => ({
      kind: "hide" as const,
      input: { kind: "hide" as const, target: ids(1) },
      label,
      status: "done" as const,
      changed: 1,
      createdAt: old,
      ...extra,
    });
    await db.insert(vetrinaOperations).values([
      row("old tag", { kind: "tag", input: { kind: "tag", target: ids(1), tag: { name: "x" } } }),
      row("standing", { termKey: "brand:100" }),
      row("shown again", { termKey: "brand:200", status: "undone", undoneAt: old }),
      row("never stood", { termKey: "category:10", status: "failed", changed: 0 }),
      row("recent", { createdAt: new Date() }),
      // A whole term's sale with no end stays as long as it stands: the term's screen reads it.
      row("term sale", {
        kind: "sale",
        input: { kind: "sale", target: category(10), percent: 20, rounding: "charm", endsOn: null, termKey: "category:10" },
        termKey: "category:10",
        createdAt: new Date(old.getTime() + 1000),
      }),
    ]);
    expect(await trimOperations()).toBe(3);
    expect((await listOperations(10)).map((o) => [o.label, o.undoable])).toEqual([
      ["recent", true],
      ["term sale", false],
      ["standing", true],
    ]);
  });

  it("never shows a product another hidden term still holds: undoing one hide leaves it to the other's «Mostra»", async () => {
    const { loadTermActions, listItems } = await load();
    // Air Max (1) and Dunk Low (2) are Sneakers and Nike: one hide of each.
    const sneakers = await run({ kind: "hide", target: category(10), termKey: "category:10" });
    expect(sneakers.changed).toBe(3);
    const nike = await run({ kind: "hide", target: brand(100), termKey: "brand:100" });
    // Already hidden by the first: only Calze (5) is the Nike hide's own.
    expect((await listItems(nike.id)).map((i) => i.productId)).toEqual([5]);

    // "Mostra" on Sneakers: Samba (3) comes back; Air Max and Dunk Low stay hidden — Nike still is.
    const shown = await undo(sneakers.id);
    expect(shown.undo).toEqual({ restored: 1, kept: 0, failed: 0, held: 2 });
    expect([1, 2, 3, 4, 5].map((id) => product(id).visibility)).toEqual(["hidden", "hidden", "visible", "hidden", "hidden"]);
    expect((await loadTermActions("brand", 100)).hiddenBy?.id).toBe(nike.id);
    // The Nike hide holds them now, as they were before either hide.
    expect((await listItems(nike.id)).map((i) => [i.productId, i.before]).sort()).toEqual([
      [1, "visible"],
      [2, "visible"],
      [5, "visible"],
    ]);

    // "Mostra" on Nike: everything either hide hid is back; Gazelle (4), hidden before both, stays hidden.
    expect((await undo(nike.id)).undo).toMatchObject({ restored: 3, kept: 0 });
    expect([1, 2, 3, 4, 5].map((id) => product(id).visibility)).toEqual(["visible", "visible", "visible", "hidden", "visible"]);
  });

  it("offers «Mostra» only for what is hidden one by one: what another hidden term holds is that term's to show", async () => {
    const { loadTermActions, previewOperation } = await load();
    // Sneakers hidden, then Nike; "Mostra" on Sneakers leaves Air Max (1) and Dunk Low (2) to Nike's hide.
    const sneakers = await run({ kind: "hide", target: category(10), termKey: "category:10" });
    const nike = await run({ kind: "hide", target: brand(100), termKey: "brand:100" });
    await undo(sneakers.id);

    // Sneakers: 3 hidden, but only Gazelle (4) one by one; Nike holds the other 2.
    const state = await loadTermActions("category", 10);
    expect(state.hiddenBy).toBeNull();
    expect(state.counts).toMatchObject({ count: 4, hidden: 3, held: [{ term: "Nike", count: 2 }] });
    // Nike's own screen holds nothing of another's: its hide is its own.
    expect((await loadTermActions("brand", 100)).counts?.held).toEqual([]);

    // The panel's "Mostra i nascosti" shows Gazelle and says why the other two stay.
    const hidden = { kind: "query" as const, query: { taxonomy: "category" as const, termId: 10, visibility: "hidden" as const } };
    const input: OperationInput = { kind: "show", target: hidden, keepHeld: true };
    const preview = await previewOperation(input);
    expect(preview.changes).toBe(1);
    expect(preview.untouched).toEqual([{ reason: "restano nascosti da «Nike»", count: 2 }]);
    const shown = await run(input);
    expect(shown).toMatchObject({ status: "done", changed: 1 });
    expect([1, 2, 3, 4, 5].map((id) => product(id).visibility)).toEqual(["hidden", "hidden", "visible", "visible", "hidden"]);
    expect((await loadTermActions("brand", 100)).hiddenBy?.id).toBe(nike.id);
    // A plain "Mostra" (a selection's) is the owner's own word: it shows them all.
    expect((await previewOperation({ kind: "show", target: hidden })).changes).toBe(2);
  });

  it("a change of the term's discount does not take the term's own sale for the products' own", async () => {
    const { previewOperation, loadTermActions } = await load();
    const input: OperationInput = {
      kind: "sale",
      target: category(10),
      percent: 20,
      rounding: "charm",
      endsOn: "2099-12-31",
      termKey: "category:10",
    };
    // Dunk Low (2) was on a sale of its own; the term's sale took its place.
    expect((await previewOperation(input)).warnings).toContain(
      "1 è già in saldo per conto suo: alla fine di questo saldo perde anche quello sconto e torna a prezzo pieno.",
    );
    await run(input);
    // A product on a sale of its own joins Sneakers after the term's sale.
    add({ id: 6, name: "Forum", categories: [10], sizes: [size(61, "100.00", "70.00")] });
    await indexStore();

    // "Cambia lo sconto", at the same percent or another: only Forum is on a sale of its own.
    for (const percent of [20, 30]) {
      const warnings = (await previewOperation({ ...input, percent } as OperationInput)).warnings;
      expect(warnings).toContain(
        "1 è già in saldo per conto suo: alla fine di questo saldo perde anche quello sconto e torna a prezzo pieno.",
      );
    }
    // A smaller discount puts the term's own prices up, as asked: only Forum's own deeper sale is worth saying.
    expect((await previewOperation({ ...input, percent: 10 } as OperationInput)).warnings).toContain(
      "1 ha già uno sconto più forte: con questo saldo il suo prezzo sale.",
    );
    // The panel counts the same way: 5 on sale, 1 of them on its own.
    expect((await loadTermActions("category", 10)).counts).toMatchObject({ count: 5, ownSale: 1 });
  });

  it("reads a term as visible again once its hidden products were shown another way", async () => {
    const { loadTermActions, previewOperation } = await load();
    const hide = await run({ kind: "hide", target: category(10), termKey: "category:10" });
    expect((await loadTermActions("category", 10)).hiddenBy?.id).toBe(hide.id);
    // The owner shows them from a selection instead of the term's switch.
    await run({ kind: "show", target: ids(1, 2, 3) });
    const state = await loadTermActions("category", 10);
    expect(state.hiddenBy).toBeNull();
    // Its counts, read with it: 4 products, Gazelle still hidden (by no other hide), Dunk Low on a sale of its own.
    expect(state.counts).toEqual({ count: 4, hidden: 1, held: [], ownSale: 1 });
    // And it can be hidden again.
    const again = await previewOperation({ kind: "hide", target: category(10), termKey: "category:10" });
    expect(again.changes).toBe(3);
    expect(again.warnings.join(" ")).not.toContain("usa «Mostra»");
  });

  it("warns when a sale puts a deeper discount up, and when its end takes a product's own sale with it", async () => {
    const { previewOperation, loadTermActions } = await load();
    // Dunk Low (2) is already 10% off: 5% off would put it up; with an end date, its own sale ends then too.
    const input: OperationInput = {
      kind: "sale",
      target: category(10),
      percent: 5,
      rounding: "exact",
      endsOn: "2099-12-31",
      termKey: "category:10",
    };
    const preview = await previewOperation(input);
    expect(preview.warnings).toContain("1 ha già uno sconto più forte: con questo saldo il suo prezzo sale.");
    expect(preview.warnings).toContain(
      "1 è già in saldo per conto suo: alla fine di questo saldo perde anche quello sconto e torna a prezzo pieno.",
    );
    expect((await previewOperation({ ...input, endsOn: null } as OperationInput)).warnings.join(" ")).not.toContain("alla fine");

    // "Cambia lo sconto": the newer sale says which one it replaced, and how it was rounded.
    await run({ ...input, percent: 20, rounding: "charm", endsOn: null } as OperationInput);
    await run(input);
    expect((await loadTermActions("category", 10)).sale).toMatchObject({ percent: 5, rounding: "exact", replaces: 20 });
  });

  it("counts a refusal of one product's sizes and goes on with the others", async () => {
    store.gone.add(1);
    const sale = await run({ kind: "sale", target: ids(1, 2), percent: 10, rounding: "exact", endsOn: null });
    expect(sale).toMatchObject({ status: "done", changed: 1, failed: 1 });
    expect(product(2).sizes[0].sale_price).toBe("89.10");
  });

  it("refuses a pin that places nothing, and writes no section for one that moves nothing", async () => {
    const { previewOperation, startOperation } = await load();
    home.rails.set("brand:adidas#0", {
      key: "brand:adidas#0",
      title: "ADIDAS",
      taxonomy: "product_brand",
      term: { id: 200, name: "Adidas", slug: "adidas" },
      pin: [3],
      exclude: [],
      hash: 1,
    });
    const nike: OperationInput = { kind: "pin", target: ids(1), sectionKey: "brand:adidas#0" };
    expect((await previewOperation(nike)).warnings[0]).toBe("Nessuno di questi prodotti può stare in ADIDAS.");
    await expect(startOperation(nike)).rejects.toThrow("Nessuno di questi prodotti può stare in ADIDAS.");
    // Samba is pinned there first already: done, and the homepage untouched.
    const same = await run({ kind: "pin", target: ids(3), sectionKey: "brand:adidas#0" });
    expect(same.status).toBe("done");
    expect(home.rails.get("brand:adidas#0")!.hash).toBe(1);
  });

  it("speaks the owner's language: a label kept as data reads in English for an English request", async () => {
    const { inLanguage } = await import("./words");
    const op = await run({ kind: "hide", target: ids(1, 3) });
    expect(op.label).toBe("2 prodotti nascosti");
    const { loadOperation } = await load();
    expect((await inLanguage("en", () => loadOperation(op.id))).label).toBe("2 products hidden");
  });

  it("refuses more products than an action takes, and an empty one", async () => {
    const { previewOperation, startOperation } = await load();
    const many = ids(...Array.from({ length: 2001 }, (_, i) => i + 1));
    await expect(previewOperation({ kind: "hide", target: many })).rejects.toThrow("Sono 2001 prodotti: al massimo 2000 alla volta");
    await expect(startOperation({ kind: "hide", target: category(12) })).rejects.toThrow("Nessun prodotto scelto.");
  });
});
