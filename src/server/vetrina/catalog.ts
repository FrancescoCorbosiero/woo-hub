import "server-only";
import { withAncestors, type TermParents } from "@core/collections";
import {
  CATALOG_PAGE_MAX,
  CATALOG_PAGE_SIZE,
  QUICK_VIEWS,
  isListed,
  type CatalogOverview,
  type CatalogPage,
  type CatalogProduct,
  type CatalogQuery,
  type CatalogSearch,
  type CatalogSort,
  type CatalogTaxonomy,
  type CatalogTerm,
  type CatalogTermDetail,
  type FacetCount,
  type ProductPlacement,
  type ProductSection,
  type QuickView,
  type SectionRef,
} from "@/lib/vetrina/catalog";
import type { RailCollection } from "@/lib/collections/types";
import type { Homepage } from "@/lib/vetrina/types";
import { skuKey } from "@/lib/skus";
import { decodeEntities, type IndexRow } from "@/server/collections/index-rows";
import { readIndexFacts, readIndexRowsById, type IndexFacts } from "@/server/collections/repo";
import { collectionsByTerm, freshen } from "@/server/collections/service";
import { demoMode, storeClient, storeReady } from "@/server/collections/store";
import { lockedPriceCounts } from "@/server/overrides/model";
import { getOverrides } from "@/server/overrides/repo";
import { readHome } from "./service";
import { VetrinaError } from "./source";

/**
 * The Vetrina's catalog, read side: the shop by category and brand, from the
 * store index, the store's two term trees, the automatic categories and the
 * homepage's sections.
 *
 * Every answer reads the light columns of the whole index once (10 000
 * products in a few tens of milliseconds) and does the rest in memory: counts
 * that take in sub-terms and count a product once, quick views, filters,
 * facets, search and sorting. Sorting is done here, not in SQL, because the
 * database sorts names byte by byte ("adidas" after "Nike", "Ébène" last);
 * the collator sorts them as a person would, "Jordan 4" before "Jordan 11".
 * Only the rows a page shows are then read whole.
 *
 * The helpers are pure and exported for the tests; the screens call the five
 * readers at the bottom, through server/actions/vetrina-catalog.ts.
 */

const collator = new Intl.Collator("it", { sensitivity: "base", numeric: true });

/** Deeper than any real tree: every walk stops here, so bad data cannot hang one. */
const MAX_DEPTH = 64;

/* ---------------------------------------------------------------- *
 * Term trees
 * ---------------------------------------------------------------- */

/** A term as the store lists it: names HTML-escaped, parent absent at the top level. */
export interface StoreTerm {
  id: number;
  name: string;
  slug: string;
  parent?: number;
}

export interface TreeTerm {
  id: number;
  /** Decoded: "Saldi & Outlet". */
  name: string;
  slug: string;
  /** 0 at the top level. */
  parent: number;
}

/** One taxonomy's terms, ready to walk up and down. */
export interface TermTree {
  terms: Map<number, TreeTerm>;
  parents: TermParents;
  /** Direct sub-terms by parent id (0 = the top level), each list by name. */
  children: Map<number, number[]>;
  /** Each term's name after its parents': "Saldi › Nike". */
  paths: Map<number, string>;
}

export interface CatalogTrees {
  category: TermTree;
  brand: TermTree;
}

/** A term's ancestors, from the top level down to its parent. */
export function ancestorIds(id: number, parents: TermParents): number[] {
  const out: number[] = [];
  const seen = new Set([id]);
  for (let p = parents.get(id) ?? 0; p > 0 && !seen.has(p) && out.length < MAX_DEPTH; p = parents.get(p) ?? 0) {
    seen.add(p);
    out.unshift(p);
  }
  return out;
}

/** A term and every term below it, at any depth. */
export function withDescendants(id: number, children: ReadonlyMap<number, readonly number[]>): Set<number> {
  const out = new Set([id]);
  const queue = [id];
  while (queue.length > 0) {
    for (const child of children.get(queue.pop()!) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}

/** A taxonomy's listing as a tree: names decoded, sub-terms by name, every term's path. */
export function termTree(list: readonly StoreTerm[]): TermTree {
  const terms = new Map<number, TreeTerm>();
  for (const t of list) terms.set(t.id, { id: t.id, name: decodeEntities(t.name), slug: t.slug, parent: t.parent ?? 0 });
  // A parent the list does not hold would hide its child from every screen:
  // that child is read as top level.
  for (const t of terms.values()) {
    if (t.parent === t.id || !terms.has(t.parent)) t.parent = 0;
  }
  const parents = new Map([...terms.values()].map((t) => [t.id, t.parent]));
  const children = new Map<number, number[]>();
  for (const t of terms.values()) {
    const siblings = children.get(t.parent);
    if (siblings) siblings.push(t.id);
    else children.set(t.parent, [t.id]);
  }
  const nameOf = (id: number) => terms.get(id)!.name;
  for (const ids of children.values()) ids.sort((a, b) => collator.compare(nameOf(a), nameOf(b)) || a - b);
  const paths = new Map<number, string>();
  for (const id of terms.keys()) paths.set(id, [...ancestorIds(id, parents), id].map(nameOf).join(" › "));
  return { terms, parents, children, paths };
}

/* ---------------------------------------------------------------- *
 * Counting
 * ---------------------------------------------------------------- */

export interface TermCounts {
  count: number;
  soldOut: number;
  hidden: number;
  onSale: number;
}

const ZERO: TermCounts = { count: 0, soldOut: 0, hidden: 0, onSale: 0 };

const termsOf = (f: IndexFacts, taxonomy: CatalogTaxonomy) => (taxonomy === "category" ? f.categories : f.brands);
const isSoldOut = (f: IndexFacts) => f.stockStatus === "outofstock";
const otherTaxonomy = (taxonomy: CatalogTaxonomy): CatalogTaxonomy => (taxonomy === "category" ? "brand" : "category");

/**
 * Products per term, each term counting what its sub-terms hold too — once:
 * a product in "Nike Dunk" and in "Nike Air Force 1" is one product of "Nike".
 */
export function rollUp(facts: readonly IndexFacts[], taxonomy: CatalogTaxonomy, parents: TermParents): Map<number, TermCounts> {
  const out = new Map<number, TermCounts>();
  for (const f of facts) {
    const own = termsOf(f, taxonomy);
    if (own.length === 0) continue;
    for (const id of withAncestors(own, parents)) {
      let c = out.get(id);
      if (!c) out.set(id, (c = { ...ZERO }));
      c.count += 1;
      if (isSoldOut(f)) c.soldOut += 1;
      if (!isListed(f.visibility)) c.hidden += 1;
      if (f.onSale) c.onSale += 1;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- *
 * Quick views
 * ---------------------------------------------------------------- */

/** WooCommerce's default category ("Uncategorized"), as an English and an Italian shop name it. */
const DEFAULT_CATEGORY_SLUGS = new Set(["uncategorized", "senza-categoria"]);

/** The store's default category: a product that has only it has no category of its own. */
export function defaultCategoryIds(categories: TermTree): Set<number> {
  const out = new Set<number>();
  for (const t of categories.terms.values()) if (DEFAULT_CATEGORY_SLUGS.has(t.slug)) out.add(t.id);
  return out;
}

export function inView(view: QuickView, f: IndexFacts, defaultCategories: ReadonlySet<number>): boolean {
  switch (view) {
    case "soldout":
      return isSoldOut(f);
    case "onsale":
      return f.onSale;
    case "hidden":
      return !isListed(f.visibility);
    case "nophoto":
      return !f.hasImage;
    case "nocategory":
      return f.categories.every((id) => defaultCategories.has(id));
    case "unpublished":
      // Drafts, pending review, private — whatever the shop does not sell.
      return f.status !== "publish";
  }
}

/* ---------------------------------------------------------------- *
 * Text search
 * ---------------------------------------------------------------- */

/** Lower case, accents off, spaces squeezed: "Ébène  Runner" → "ebene runner". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const wordsOf = (q: string) => fold(q).split(" ").filter(Boolean);
const hasWords = (text: string, words: readonly string[]) => words.every((w) => text.includes(w));

/**
 * The products a search finds: every word of it in the name or the SKU, in
 * any order — "dunk panda" finds "Nike Dunk Low Panda".
 */
export function productMatcher(q: string): (f: IndexFacts) => boolean {
  const words = wordsOf(q);
  return (f) => hasWords(fold(`${f.name} ${f.sku}`), words);
}

const byName = (a: IndexFacts, b: IndexFacts) => collator.compare(a.name, b.name) || a.id - b.id;

/** What a search finds, best first: the exact SKU, then a SKU or a name starting with it, then the rest. */
export function rankProducts(facts: readonly IndexFacts[], q: string): IndexFacts[] {
  const needle = fold(q);
  const rank = (f: IndexFacts) => {
    const sku = fold(f.sku);
    if (sku === needle) return 0;
    return sku.startsWith(needle) || fold(f.name).startsWith(needle) ? 1 : 2;
  };
  return facts
    .filter(productMatcher(q))
    .map((f) => ({ f, rank: rank(f) }))
    .sort((a, b) => a.rank - b.rank || byName(a.f, b.f))
    .map(({ f }) => f);
}

/**
 * The terms a search finds, best first: a name starting with it, then a name
 * holding every word, then a term found by its parents' names ("saldi" finds
 * Saldi's sub-categories too).
 */
export function rankTerms(tree: TermTree, q: string): TreeTerm[] {
  const needle = fold(q);
  const words = wordsOf(q);
  const found: { term: TreeTerm; rank: number; path: string }[] = [];
  for (const term of tree.terms.values()) {
    const name = fold(term.name);
    const path = tree.paths.get(term.id) ?? term.name;
    const rank = name.startsWith(needle) ? 0 : hasWords(name, words) ? 1 : hasWords(fold(path), words) ? 2 : -1;
    if (rank >= 0) found.push({ term, rank, path });
  }
  return found
    .sort((a, b) => a.rank - b.rank || collator.compare(a.term.name, b.term.name) || collator.compare(a.path, b.path))
    .map(({ term }) => term);
}

/* ---------------------------------------------------------------- *
 * Sorting
 * ---------------------------------------------------------------- */

/** Unknown values after every known one, whichever the direction. */
function nullsLast(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a == null || b == null) return (a == null ? 1 : 0) - (b == null ? 1 : 0);
  return (a - b) * direction;
}

/** How each sort orders products. Ties go by name, then id: a page never reshuffles. */
export function compareFacts(sort: CatalogSort): (a: IndexFacts, b: IndexFacts) => number {
  switch (sort) {
    case "shop":
      return (a, b) => a.menuOrder - b.menuOrder || byName(a, b);
    case "newest":
      return (a, b) => nullsLast(a.created, b.created, -1) || b.id - a.id;
    case "bestselling":
      return (a, b) => b.totalSales - a.totalSales || byName(a, b);
    case "priceAsc":
      return (a, b) => nullsLast(a.price, b.price, 1) || byName(a, b);
    case "priceDesc":
      return (a, b) => nullsLast(a.price, b.price, -1) || byName(a, b);
    case "name":
      return byName;
  }
}

/* ---------------------------------------------------------------- *
 * A page of products
 * ---------------------------------------------------------------- */

const holdsAny = (f: IndexFacts, taxonomy: CatalogTaxonomy, ids: ReadonlySet<number>) =>
  termsOf(f, taxonomy).some((id) => ids.has(id));

/** What a page is about — a term (sub-terms included), a quick view, a search — all three when given. */
function baseFilter(query: CatalogQuery, trees: CatalogTrees): (f: IndexFacts) => boolean {
  const taxonomy = query.taxonomy ?? "category";
  const term = query.termId != null ? withDescendants(query.termId, trees[taxonomy].children) : null;
  const defaults = defaultCategoryIds(trees.category);
  const text = query.q?.trim() ? productMatcher(query.q) : null;
  return (f) =>
    (!term || holdsAny(f, taxonomy, term)) && (!query.view || inView(query.view, f, defaults)) && (!text || text(f));
}

/** The chips that narrow a page: stock, visibility, sale, a term of the other taxonomy. */
function narrowFilter(query: CatalogQuery, trees: CatalogTrees): (f: IndexFacts) => boolean {
  const other = otherTaxonomy(query.taxonomy ?? "category");
  const within = query.within != null ? withDescendants(query.within, trees[other].children) : null;
  return (f) =>
    // Back-orderable is buyable: "in stock" is everything not sold out.
    (!query.stock || isSoldOut(f) === (query.stock === "outofstock")) &&
    (!query.visibility || isListed(f.visibility) === (query.visibility === "visible")) &&
    (query.onSale == null || f.onSale === query.onSale) &&
    (!within || holdsAny(f, other, within));
}

/** These terms with their products, the fullest first; the empty ones left out. */
function facetList(counts: Map<number, TermCounts>, ids: Iterable<number>, tree: TermTree): FacetCount[] {
  const out: FacetCount[] = [];
  for (const id of ids) {
    const count = counts.get(id)?.count ?? 0;
    const term = tree.terms.get(id);
    if (count > 0 && term) out.push({ id, name: term.name, count });
  }
  return out.sort((a, b) => b.count - a.count || collator.compare(a.name, b.name) || a.id - b.id);
}

function facetsOf(base: readonly IndexFacts[], query: CatalogQuery, trees: CatalogTrees): CatalogPage["facets"] {
  const taxonomy = query.taxonomy ?? "category";
  const own = trees[taxonomy];
  const other = trees[otherTaxonomy(taxonomy)];
  const outofstock = base.filter(isSoldOut).length;
  return {
    instock: base.length - outofstock,
    outofstock,
    hidden: base.filter((f) => !isListed(f.visibility)).length,
    onSale: base.filter((f) => f.onSale).length,
    children:
      query.termId != null ? facetList(rollUp(base, taxonomy, own.parents), own.children.get(query.termId) ?? [], own) : [],
    // Rolled up like the counts, so a chip's number is what tapping it shows.
    within: facetList(rollUp(base, otherTaxonomy(taxonomy), other.parents), other.terms.keys(), other),
  };
}

export interface PageSelection {
  /** The page's products, in order. */
  ids: number[];
  total: number;
  offset: number;
  facets: CatalogPage["facets"];
}

const wholeOr = (value: number | undefined, fallback: number) =>
  value != null && Number.isFinite(value) ? Math.floor(value) : fallback;

/** Which products a query shows, in which order, and the counts around them — before any row is read. */
export function selectPage(facts: readonly IndexFacts[], query: CatalogQuery, trees: CatalogTrees): PageSelection {
  const base = facts.filter(baseFilter(query, trees));
  const matching = base.filter(narrowFilter(query, trees)).sort(compareFacts(query.sort ?? "shop"));
  const offset = Math.max(0, wholeOr(query.offset, 0));
  const limit = Math.min(CATALOG_PAGE_MAX, Math.max(1, wholeOr(query.limit, CATALOG_PAGE_SIZE)));
  return {
    ids: matching.slice(offset, offset + limit).map((f) => f.id),
    total: matching.length,
    offset,
    facets: facetsOf(base, query, trees),
  };
}

/* ---------------------------------------------------------------- *
 * The homepage's sections
 * ---------------------------------------------------------------- */

export interface HomepagePresence {
  /** By termKey(): the sections showing exactly that term. */
  terms: Map<string, SectionRef[]>;
  /** By product id: the sections showing it now, and where. */
  products: Map<number, ProductSection[]>;
}

export const termKey = (taxonomy: CatalogTaxonomy, id: number) => `${taxonomy}:${id}`;

const RAIL_TAXONOMIES = new Map<string, CatalogTaxonomy>([
  ["product_cat", "category"],
  ["product_brand", "brand"],
]);

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Where the homepage shows each term and each product. A term's sections are
 * the ones showing that term alone; a product's are every section showing it
 * now (a tag or hand-picked section included), at its place among what the
 * site renders.
 */
export function presenceOf(home: Homepage): HomepagePresence {
  const out: HomepagePresence = { terms: new Map(), products: new Map() };
  for (const block of home.blocks) {
    if (block.kind !== "rail") continue;
    const { rail } = block;
    const section: SectionRef = { key: rail.key, title: rail.title.trim() || rail.key };
    const taxonomy = rail.taxonomy ? RAIL_TAXONOMIES.get(rail.taxonomy) : undefined;
    if (taxonomy && rail.terms.length === 1) pushTo(out.terms, termKey(taxonomy, rail.terms[0].id), section);
    const pinned = new Set(rail.pin);
    let position = 0;
    for (const p of rail.products) {
      // A product gone from the shop takes no place on the page.
      if (p.missing) continue;
      position += 1;
      pushTo(out.products, p.id, { ...section, position, pinned: pinned.has(p.id) });
    }
  }
  return out;
}

/** The catalog asks on every screen; the homepage changes rarely, and costs a site request. */
const PRESENCE_TTL_MS = 60_000;
/**
 * The longest an answer waits for the homepage when nothing is remembered
 * yet. A slow or unreachable site must not hold the catalog's own data back:
 * past this the answer goes out without sections, and the read carries on
 * for the next one.
 */
const PRESENCE_WAIT_MS = 2_500;

const NO_PRESENCE: HomepagePresence = { terms: new Map(), products: new Map() };

interface PresenceCache {
  /** When the newest read started. */
  at: number;
  /** The newest read. A homepage that cannot be read settles as no sections, never as an error. */
  reading: Promise<HomepagePresence>;
  /** What the newest settled read found: answered while a newer read is on its way. */
  settled: HomepagePresence | null;
}

// One copy per process, like the scheduler's state: the server actions and
// the instrumentation bundle each get their own copy of this module.
const g = globalThis as { __vetrinaCatalogPresence?: PresenceCache };

function readPresence(previous: HomepagePresence | null): PresenceCache {
  const cache: PresenceCache = { at: Date.now(), reading: Promise.resolve(NO_PRESENCE), settled: previous };
  cache.reading = (async () => presenceOf((await readHome()).home))()
    .catch(() => NO_PRESENCE)
    .then((presence) => (cache.settled = presence));
  return cache;
}

async function atMost<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The homepage's sections by term and by product: read at most once a
 * minute, and once read, answered at once — a newer read only replaces them
 * when it is done. Best-effort, never an error.
 */
export async function homepagePresence(): Promise<HomepagePresence> {
  let cache = g.__vetrinaCatalogPresence;
  if (!cache || Date.now() - cache.at >= PRESENCE_TTL_MS) {
    cache = readPresence(cache?.settled ?? null);
    g.__vetrinaCatalogPresence = cache;
  }
  return cache.settled ?? atMost(cache.reading, PRESENCE_WAIT_MS, NO_PRESENCE);
}

/** Forget the sections (after a homepage publish): the next answer waits for the homepage as it is now. */
export function forgetHomepagePresence(): void {
  delete g.__vetrinaCatalogPresence;
}

/* ---------------------------------------------------------------- *
 * Reading
 * ---------------------------------------------------------------- */

interface CatalogContext extends CatalogTrees {
  /** The automatic categories, by category id. */
  collections: Record<number, RailCollection>;
  presence: HomepagePresence;
  demo: boolean;
}

/** Everything around the index an answer needs, read side by side. */
async function loadContext(): Promise<CatalogContext> {
  if (!storeReady()) {
    throw new VetrinaError(
      "not_configured",
      "Il collegamento al negozio non è configurato (WOO_BASE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET).",
    );
  }
  const client = await storeClient();
  const [categories, brands, collections, presence] = await Promise.all([
    client.listCategories(),
    // A shop without brands — or whose brands cannot be read — still has its categories.
    client.listBrands().catch(() => []),
    // Best-effort, like the homepage's: a Hub without the table still browses.
    collectionsByTerm().catch(() => ({})),
    homepagePresence(),
  ]);
  return { category: termTree(categories), brand: termTree(brands), collections, presence, demo: demoMode() };
}

/** Locked sizes per SKU: best-effort, like the homepage's padlocks. */
async function lockCounts(): Promise<Map<string, number>> {
  const overrides = await getOverrides().catch(() => null);
  return overrides ? lockedPriceCounts(overrides) : new Map();
}

function catalogTerm(taxonomy: CatalogTaxonomy, id: number, counts: Map<number, TermCounts>, ctx: CatalogContext): CatalogTerm {
  const tree = ctx[taxonomy];
  const term = tree.terms.get(id)!;
  const c = counts.get(id) ?? ZERO;
  return {
    taxonomy,
    id,
    name: term.name,
    slug: term.slug,
    parent: term.parent,
    path: tree.paths.get(id) ?? term.name,
    children: tree.children.get(id) ?? [],
    count: c.count,
    soldOut: c.soldOut,
    hidden: c.hidden,
    onSale: c.onSale,
    sections: ctx.presence.terms.get(termKey(taxonomy, id)) ?? [],
    automatic: taxonomy === "category" ? (ctx.collections[id] ?? null) : null,
  };
}

/** Every term of a taxonomy, in tree order ("Saldi", "Saldi › Nike", "Sneakers"). */
function catalogTerms(taxonomy: CatalogTaxonomy, facts: readonly IndexFacts[], ctx: CatalogContext): CatalogTerm[] {
  const tree = ctx[taxonomy];
  const counts = rollUp(facts, taxonomy, tree.parents);
  return [...tree.terms.keys()]
    .map((id) => catalogTerm(taxonomy, id, counts, ctx))
    .sort((a, b) => collator.compare(a.path, b.path) || a.id - b.id);
}

/** A term as a product carries it, named as the store names it now (the index may be minutes behind). */
const named = (t: { id: number; name: string }, tree: TermTree) => ({ id: t.id, name: tree.terms.get(t.id)?.name ?? t.name });

function catalogProduct(row: IndexRow, ctx: CatalogContext, locks: Map<string, number>): CatalogProduct {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    status: row.status,
    visibility: row.visibility,
    stockStatus: row.stockStatus,
    price: row.price,
    onSale: row.onSale,
    permalink: row.permalink,
    menuOrder: row.menuOrder,
    totalSales: row.totalSales,
    dateCreated: row.dateCreated,
    categories: row.categories.map((t) => named(t, ctx.category)),
    brands: row.brands.map((t) => named(t, ctx.brand)),
    tags: row.tags.map(({ id, name }) => ({ id, name })),
    hasImage: row.image !== "",
    locks: row.sku ? (locks.get(skuKey(row.sku)) ?? 0) : 0,
    sections: ctx.presence.products.get(row.id) ?? [],
  };
}

/** These products, whole, in this order (one gone from the index since is left out). */
async function catalogProducts(ids: number[], ctx: CatalogContext, locks: Map<string, number>): Promise<CatalogProduct[]> {
  const rows = new Map((await readIndexRowsById(ids)).map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const row = rows.get(id);
    return row ? [catalogProduct(row, ctx, locks)] : [];
  });
}

/** The catalog's home: every category and brand with its counts, and the quick views. */
export async function readOverview(): Promise<CatalogOverview> {
  const [facts, ctx] = await Promise.all([
    readIndexFacts(),
    loadContext(),
    // Opening the catalog brings the index up to date in the background (an
    // empty one is read whole); this answer shows the index as it is now.
    freshen().catch(() => undefined),
  ]);
  const defaults = defaultCategoryIds(ctx.category);
  return {
    categories: catalogTerms("category", facts, ctx),
    brands: catalogTerms("brand", facts, ctx),
    views: QUICK_VIEWS.map((view) => ({ view, count: facts.filter((f) => inView(view, f, defaults)).length })),
    indexProducts: facts.length,
    demo: ctx.demo,
  };
}

/** A category's or a brand's screen: the term, where it sits, its sub-terms. */
export async function readTerm(taxonomy: CatalogTaxonomy, id: number): Promise<CatalogTermDetail> {
  const [facts, ctx] = await Promise.all([readIndexFacts(), loadContext()]);
  const tree = ctx[taxonomy];
  if (!tree.terms.has(id)) {
    throw new VetrinaError(
      "not_found",
      taxonomy === "category" ? "Questa categoria non c'è più nel negozio." : "Questo brand non c'è più nel negozio.",
      404,
    );
  }
  const counts = rollUp(facts, taxonomy, tree.parents);
  return {
    term: catalogTerm(taxonomy, id, counts, ctx),
    ancestors: ancestorIds(id, tree.parents).map((a) => ({ id: a, name: tree.terms.get(a)!.name })),
    children: (tree.children.get(id) ?? []).map((child) => catalogTerm(taxonomy, child, counts, ctx)),
    demo: ctx.demo,
  };
}

/** A page of products: a term's, a quick view's or a search's, narrowed, sorted, with its facets. */
export async function readPage(query: CatalogQuery): Promise<CatalogPage> {
  const [facts, ctx, locks] = await Promise.all([readIndexFacts(), loadContext(), lockCounts()]);
  const page = selectPage(facts, query, ctx);
  return {
    products: await catalogProducts(page.ids, ctx, locks),
    total: page.total,
    offset: page.offset,
    facets: page.facets,
  };
}

const SEARCH_TERMS = 5;
const SEARCH_PRODUCTS = 20;

/** The search at the top of every catalog screen: categories, brands and products at once. */
export async function search(q: string): Promise<CatalogSearch> {
  if (!q.trim()) return { categories: [], brands: [], products: [], totalProducts: 0 };
  const [facts, ctx, locks] = await Promise.all([readIndexFacts(), loadContext(), lockCounts()]);
  const termsFound = (taxonomy: CatalogTaxonomy): CatalogTerm[] => {
    const found = rankTerms(ctx[taxonomy], q).slice(0, SEARCH_TERMS);
    if (found.length === 0) return [];
    const counts = rollUp(facts, taxonomy, ctx[taxonomy].parents);
    return found.map((t) => catalogTerm(taxonomy, t.id, counts, ctx));
  };
  const products = rankProducts(facts, q);
  const shown = products.slice(0, SEARCH_PRODUCTS).map((f) => f.id);
  return {
    categories: termsFound("category"),
    brands: termsFound("brand"),
    products: await catalogProducts(shown, ctx, locks),
    totalProducts: products.length,
  };
}

/** A product's place in the shop, for its sheet: categories (with their rule), brands, homepage sections. */
export async function readPlacement(id: number): Promise<ProductPlacement> {
  const [[row], ctx] = await Promise.all([readIndexRowsById([id]), loadContext()]);
  if (!row) {
    throw new VetrinaError(
      "not_found",
      "Questo prodotto non è nel catalogo: se è appena stato creato, compare tra pochi minuti.",
      404,
    );
  }
  const categories = row.categories.map((c) => {
    const { name } = named(c, ctx.category);
    return { id: c.id, name, path: ctx.category.paths.get(c.id) ?? name, automatic: ctx.collections[c.id] != null };
  });
  return {
    id: row.id,
    status: row.status,
    visibility: row.visibility,
    categories: categories.sort((a, b) => collator.compare(a.path, b.path) || a.id - b.id),
    brands: row.brands.map((b) => named(b, ctx.brand)),
    sections: ctx.presence.products.get(row.id) ?? [],
  };
}
