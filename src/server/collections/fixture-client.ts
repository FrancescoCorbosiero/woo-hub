import "server-only";
import { DEMO_BRAND_PARENT, DEMO_TAGS, DEMO_TERM_IDS, DEMO_TERM_NAMES, type DemoProduct } from "@/server/vetrina/fixture-data";
import { demoShop } from "@/server/vetrina/fixture-source";
import type { ProductBatchRow, StoreTermKind, WooClient, WooIndexProduct } from "@/server/woo/client";
import { highestCollectionTermId } from "./repo";

/**
 * The automatic categories on the Vetrina's demo shop (VETRINA_SOURCE=fixture):
 * the few calls the runs make, answered from the demo shop's memory the way
 * WooCommerce answers them. A rule saved in demo mode really moves the demo
 * products, and the demo homepage's rails follow — no site involved, nothing
 * written anywhere, a restart puts everything back.
 *
 * The catalog's actions use it too: visibility, tags, categories and sales.
 * The demo's products are sold as one item (WooCommerce's "simple" type): a
 * sale is the product's own sale price, and the shelf price follows it.
 *
 * The taxonomy actions too: a category, a brand or a tag made, renamed,
 * moved or deleted the way WordPress takes it — a name taken under the same
 * parent refused, a term never under itself, a deleted term's sub-terms
 * moved up to its parent and its products let go of it.
 */

type Term = { id: number; name: string; slug: string; parent?: number; description?: string };

interface DemoTerms {
  categories: Term[];
  brands: Term[];
  tags: Term[];
  next: number;
}

// Terms created in demo mode live beside the demo shop, like its other edits.
const g = globalThis as { __vetrinaDemoTerms?: DemoTerms };

function terms(): DemoTerms {
  return (g.__vetrinaDemoTerms ??= {
    categories: Object.entries(DEMO_TERM_IDS)
      .filter(([slug]) => !(slug in DEMO_BRAND_PARENT))
      .map(([slug, id]) => ({ id, slug, name: DEMO_TERM_NAMES[slug] ?? slug, parent: 0 })),
    brands: Object.entries(DEMO_BRAND_PARENT).map(([slug, parent]) => ({
      id: DEMO_TERM_IDS[slug],
      slug,
      name: DEMO_TERM_NAMES[slug] ?? slug,
      parent: parent ? DEMO_TERM_IDS[parent] : 0,
    })),
    tags: DEMO_TAGS.map((t) => ({ ...t })),
    next: 900,
  });
}

/**
 * The id of a term created in demo mode. Above every category a rule is
 * saved on: the rules outlive a restart, the terms created on an earlier
 * demo shop do not, and a new category taking one of their ids would
 * collide with its rule (one rule per category).
 */
async function nextId(): Promise<number> {
  const t = terms();
  t.next = Math.max(t.next, (await highestCollectionTermId().catch(() => 0)) + 1);
  return t.next++;
}

function brands(): Term[] {
  return terms().brands;
}

/** The demo's list for a REST collection. */
const listOf = (kind: StoreTermKind): Term[] => terms()[kind];

/** WordPress's refusal of a write, with its status, as requestJson throws it. */
const refusal = (status: number, code: string, message: string) =>
  Object.assign(new Error(`${message} (${code}, HTTP ${status})`), { status, body: JSON.stringify({ code, message }) });

/** Under one parent, one name: WordPress compares names without case. */
function assertFree(list: Term[], name: string, parent: number, self = 0): void {
  const key = name.trim().toLowerCase();
  if (list.some((t) => t.id !== self && (t.parent ?? 0) === parent && t.name.trim().toLowerCase() === key)) {
    throw refusal(400, "term_exists", "A term with the name provided already exists with this parent.");
  }
}

/** A term and every term below it. */
function descendantsOf(list: Term[], id: number): Set<number> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of list) {
      if (!out.has(t.id) && out.has(t.parent ?? 0)) {
        out.add(t.id);
        grew = true;
      }
    }
  }
  return out;
}

/** The products holding a term (by its slug, as the demo keeps them). */
function holding(kind: StoreTermKind, slug: string): DemoProduct[] {
  return demoShop().products.filter(
    (p) => !p.trashed && (kind === "categories" ? p.categories.includes(slug) : kind === "tags" ? p.tags.includes(slug) : p.brand === slug),
  );
}

const slugify = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const gmt = (ms: number) => new Date(ms).toISOString().slice(0, 19);

const money = (n: number | null) => (n == null ? "" : n.toFixed(2));

/** Saved: its modified time moves, as WooCommerce's does. */
function touch(p: DemoProduct): void {
  p.modified = Math.max(Date.now(), p.modified + 1000);
}

/**
 * A write of the fields the catalog's actions send, as WooCommerce takes
 * them: an empty sale price ends the sale, and the shelf price follows. The
 * regular price is never among them — nothing here writes it.
 */
function applyFields(p: DemoProduct, body: Record<string, unknown>): void {
  if (typeof body.catalog_visibility === "string") p.visibility = body.catalog_visibility;
  if (typeof body.menu_order === "number") p.menuOrder = body.menu_order;
  if ("sale_price" in body) {
    const sale = Number.parseFloat(String(body.sale_price ?? ""));
    p.salePrice = Number.isFinite(sale) && sale > 0 && sale < p.regularPrice ? Math.round(sale * 100) / 100 : null;
  }
  if ("date_on_sale_to" in body) p.saleTo = typeof body.date_on_sale_to === "string" && body.date_on_sale_to ? body.date_on_sale_to : null;
  if (p.salePrice == null) p.saleTo = null;
  p.onSale = p.salePrice != null;
  p.price = p.salePrice ?? p.regularPrice;
}

/** The product as WooCommerce's products/{id} answers it, as far as the actions read it. */
function full(p: DemoProduct): Record<string, unknown> {
  return {
    ...view(p),
    regular_price: money(p.regularPrice),
    sale_price: money(p.salePrice),
    date_on_sale_from: null,
    date_on_sale_to: p.saleTo,
  };
}

function view(p: DemoProduct): WooIndexProduct {
  const { categories, tags } = terms();
  const brand = brands().find((b) => b.slug === p.brand);
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    type: "simple",
    status: p.trashed ? "trash" : "publish",
    permalink: `https://demo.shop/prodotto/${p.id}`,
    categories: p.categories.flatMap((slug) => categories.filter((c) => c.slug === slug)),
    tags: p.tags.flatMap((slug) => tags.filter((t) => t.slug === slug)),
    brands: brand ? [{ id: brand.id, slug: brand.slug, name: brand.name }] : [],
    attributes: [],
    price: String(p.price),
    on_sale: p.onSale,
    stock_status: p.inStock ? "instock" : "outofstock",
    date_created_gmt: p.created.slice(0, 19),
    date_modified_gmt: gmt(p.modified),
    images: p.image ? [{ src: p.image }] : [],
    catalog_visibility: p.visibility,
    menu_order: p.menuOrder,
    total_sales: p.totalSales,
  };
}

/** A stand-in for WooClient, as far as the automatic categories use one. */
export function fixtureClient(): WooClient {
  const client = {
    async getProductIndexPage(opts: { page: number; perPage: number; modifiedAfter?: Date; include?: number[] }) {
      // Any status but the trash, as WooCommerce's "any" reads.
      let list = demoShop().products.filter((p) => !p.trashed);
      if (opts.include) list = list.filter((p) => opts.include!.includes(p.id));
      else if (opts.modifiedAfter) {
        const after = opts.modifiedAfter.getTime();
        list = list.filter((p) => p.modified > after).sort((a, b) => a.modified - b.modified);
      }
      const page = list.slice((opts.page - 1) * opts.perPage, opts.page * opts.perPage);
      return { products: page.map(view), total: list.length, totalPages: Math.ceil(list.length / opts.perPage) };
    },

    async batchUpdateProducts(updates: ({ id: number } & Record<string, unknown>)[]): Promise<ProductBatchRow[]> {
      const shop = demoShop();
      const { categories, tags } = terms();
      return updates.map((u) => {
        const p = shop.byId.get(u.id);
        if (!p) return { id: u.id, product: null, error: "Invalid ID." };
        const ids = (field: string) => ((u[field] as { id: number }[] | undefined) ?? []).map((t) => t.id);
        if (u.categories) p.categories = ids("categories").flatMap((id) => categories.filter((c) => c.id === id).map((c) => c.slug));
        if (u.tags) p.tags = ids("tags").flatMap((id) => tags.filter((t) => t.id === id).map((t) => t.slug));
        // A demo product has one brand: the first one written.
        if (u.brands) p.brand = brands().find((b) => b.id === ids("brands")[0])?.slug ?? "";
        applyFields(p, u);
        touch(p);
        return { id: p.id, product: view(p), error: null };
      });
    },

    async getProduct(id: number) {
      const p = demoShop().byId.get(id);
      return p ? full(p) : null;
    },

    // This exact SKU, in any status but the trash, as WooCommerce's status=any reads ("Annulla" of "Elimina" asks).
    async findProductsBySku(sku: string) {
      return demoShop()
        .products.filter((p) => !p.trashed && p.sku === sku)
        .map(full);
    },

    async updateProduct(id: number, body: Record<string, unknown>) {
      const p = demoShop().byId.get(id);
      if (!p) throw Object.assign(new Error("Invalid ID."), { status: 404 });
      // Out of the trash with a status, as WordPress takes one back ("Annulla" of "Elimina").
      if (typeof body.status === "string") p.trashed = body.status === "trash";
      applyFields(p, body);
      touch(p);
    },

    // "Elimina": to the trash, as WooCommerce's DELETE without force does; a second time it answers 410.
    async deleteProduct(id: number) {
      const p = demoShop().byId.get(id);
      if (!p) throw Object.assign(new Error("Invalid ID."), { status: 404 });
      if (p.trashed) throw Object.assign(new Error("The product has already been deleted."), { status: 410 });
      p.trashed = true;
      touch(p);
    },

    // The demo storefront follows the shop's own order.
    async getDefaultCatalogOrderby() {
      return "menu_order";
    },

    // No product of the demo has sizes.
    async getAllVariations() {
      return [];
    },
    async batchVariations() {
      return { create: [], update: [], delete: [] };
    },

    async listCategories() {
      return terms().categories;
    },
    async listBrands() {
      return brands();
    },
    async listTags() {
      return terms().tags;
    },
    async createTag(name: string) {
      const id = await nextId();
      const tag = { id, name, slug: slugify(name) || `tag-${id}` };
      terms().tags.push(tag);
      return tag;
    },
    async createCategory(name: string, parent?: number) {
      const id = await nextId();
      const category = { id, name, slug: slugify(name) || `categoria-${id}`, parent: parent ?? 0 };
      terms().categories.push(category);
      return category;
    },

    async getStoreTerm(kind: StoreTermKind, id: number) {
      const term = listOf(kind).find((t) => t.id === id);
      if (!term) throw refusal(404, "woocommerce_rest_term_invalid", "Resource does not exist.");
      return { ...term, description: term.description ?? "", count: holding(kind, term.slug).length };
    },

    async createStoreTerm(kind: StoreTermKind, body: { name: string; parent?: number; slug?: string; description?: string }) {
      const list = listOf(kind);
      const parent = kind === "tags" ? 0 : (body.parent ?? 0);
      if (parent && !list.some((t) => t.id === parent)) throw refusal(400, "rest_term_invalid", "Parent term does not exist.");
      assertFree(list, body.name, parent);
      const id = await nextId();
      // The slug asked for when it is free (a term made again by "Annulla"), else one from the name, made unique.
      const base = (body.slug && !list.some((t) => t.slug === body.slug) ? body.slug : slugify(body.name)) || `termine-${id}`;
      let slug = base;
      for (let n = 2; list.some((t) => t.slug === slug); n++) slug = `${base}-${n}`;
      const term: Term = { id, name: body.name.trim(), slug, parent, description: body.description ?? "" };
      list.push(term);
      return { ...term, count: 0 };
    },

    async updateStoreTerm(kind: StoreTermKind, id: number, body: { name?: string; parent?: number }) {
      const list = listOf(kind);
      const term = list.find((t) => t.id === id);
      if (!term) throw refusal(404, "woocommerce_rest_term_invalid", "Resource does not exist.");
      const parent = body.parent ?? term.parent ?? 0;
      if (parent && !list.some((t) => t.id === parent)) throw refusal(400, "rest_term_invalid", "Parent term does not exist.");
      if (descendantsOf(list, id).has(parent)) throw refusal(400, "invalid_term_parent", "A term cannot be its own ancestor.");
      assertFree(list, body.name ?? term.name, parent, id);
      if (body.name != null) term.name = body.name.trim();
      if (kind !== "tags") term.parent = parent;
      return { ...term, count: holding(kind, term.slug).length };
    },

    async deleteStoreTerm(kind: StoreTermKind, id: number) {
      const list = listOf(kind);
      const at = list.findIndex((t) => t.id === id);
      if (at < 0) throw refusal(404, "woocommerce_rest_term_invalid", "Resource does not exist.");
      const [gone] = list.splice(at, 1);
      // Its sub-terms move up to its parent; its products let go of it.
      for (const t of list) if ((t.parent ?? 0) === id) t.parent = gone.parent ?? 0;
      for (const p of holding(kind, gone.slug)) {
        if (kind === "categories") p.categories = p.categories.filter((slug) => slug !== gone.slug);
        else if (kind === "tags") p.tags = p.tags.filter((slug) => slug !== gone.slug);
        else p.brand = "";
        touch(p);
      }
    },

    async productIdsInTerm(kind: StoreTermKind, id: number) {
      const term = listOf(kind).find((t) => t.id === id);
      return term ? holding(kind, term.slug).map((p) => p.id) : [];
    },
  };
  return client as unknown as WooClient;
}
