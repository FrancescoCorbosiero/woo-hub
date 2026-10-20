import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { orderIds } from "@/lib/vetrina/order";
import { FIELD_SPECS, fieldProblem } from "@/lib/vetrina/fields";
import { SECTION_FEATURES } from "@/lib/vetrina/sections";
import type {
  BlockRef,
  BlockWrite,
  FieldValues,
  HiddenItem,
  Homepage,
  LayoutWrite,
  LayoutWriteResult,
  ProductCard,
  RailDetail,
  RailFallback,
  RailHistoryState,
  RailSource,
  RailState,
  RailSummary,
  RailWrite,
  RailWriteResult,
} from "@/lib/vetrina/types";
import {
  DEMO_BLOCKS,
  DEMO_BRAND_PARENT,
  DEMO_TERM_IDS,
  DEMO_TERM_NAMES,
  demoProducts,
  type DemoProduct,
} from "./fixture-data";
import { VetrinaError, type VetrinaSource } from "./source";

/**
 * The demo shop (VETRINA_SOURCE=fixture): the same contract and the same rules
 * as golden-hive-blocks' wc-gh/v1 — membership with sub-brands, sold-out
 * products hidden, pins/exclusions/fallback, stale-write refusal, history,
 * and the page's sections themselves (added, taken away, put in another
 * order, pointed elsewhere, switched off) — held in memory. Nothing is written
 * anywhere; a restart resets it.
 */

const RAIL_BLOCK = "golden-hive/shortcode-wrapper";

/** A product section of the demo page: its shortcode (what it shows, its size, layout), order and fields. */
interface DemoRail {
  kind: "rail";
  name: string;
  /** The shortcode's attributes but the order: category / brand / tag / type, limit, columns… */
  atts: Record<string, string>;
  state: RailState;
  fields: FieldValues;
}

interface DemoStatic {
  kind: "static";
  name: string;
  title: string | null;
  items: number | null;
  labels: string[];
  /** Field edits over the block's own values. */
  fields: FieldValues;
}

type DemoItem = DemoRail | DemoStatic;

/** The page: blocks at the top level, and groups of blocks (the sections live in two). */
type DemoNode = { item: DemoItem } | { group: DemoItem[] };

export interface DemoState {
  products: DemoProduct[];
  byId: Map<number, DemoProduct>;
  page: DemoNode[];
  modified: number;
  history: Map<string, (RailState & { at: number })[]>;
}

// Shared across hot reloads and server bundles, like the scheduler's state.
const g = globalThis as { __vetrinaDemo?: DemoState };

/** The demo shop itself — the automatic categories act on it in demo mode. */
export function demoShop(): DemoState {
  return state();
}

/** The shop's day (YYYY-MM-DD), in the scheduler's time zone: a sale's last day is the shop's. */
function shopDay(at = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.SCHEDULER_TIMEZONE ?? "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * WooCommerce's scheduled sales, in the demo: a sale whose last day is over
 * ends — the sale price and its date go, the shelf price is the regular one
 * again, and the product reads as saved.
 */
function endSales(products: DemoProduct[]): void {
  let today: string | null = null;
  for (const p of products) {
    if (!p.saleTo) continue;
    today ??= shopDay();
    if (p.saleTo.slice(0, 10) >= today) continue;
    p.salePrice = null;
    p.saleTo = null;
    p.onSale = false;
    p.price = p.regularPrice;
    p.modified = Math.max(Date.now(), p.modified + 1000);
  }
}

/** The demo page's blocks, from the real page's leaf blocks: "8.1" is the second block of the group at 8. */
function initialPage(): DemoNode[] {
  const page: DemoNode[] = [];
  const groups = new Map<string, DemoItem[]>();
  for (const block of DEMO_BLOCKS) {
    const item: DemoItem =
      block.kind === "rail"
        ? {
            kind: "rail",
            name: block.name,
            atts: { ...block.atts },
            state: { pin: [], exclude: [], fallback: "menu_order" },
            fields: {
              eyebrow: block.eyebrow,
              title: block.title,
              backgroundColor: block.background,
              buttonText: block.button.text,
              buttonUrl: block.button.url,
              hidden: "",
            },
          }
        : { kind: "static", name: block.name, title: block.title, items: block.items, labels: block.labels, fields: {} };
    const [top, inner] = block.path.split(".");
    if (inner == null) {
      page.push({ item });
      continue;
    }
    let group = groups.get(top);
    if (!group) {
      group = [];
      groups.set(top, group);
      page.push({ group });
    }
    group.push(item);
  }
  return page;
}

function state(): DemoState {
  if (!g.__vetrinaDemo) {
    const products = demoProducts();
    const started = Date.now();
    // A restart puts the shop back as it always is — and every product reads
    // as saved now, so the store index (and the automatic categories) take
    // it over whatever a previous run left there.
    for (const p of products) p.modified = Math.max(p.modified, started);
    g.__vetrinaDemo = {
      products,
      byId: new Map(products.map((p) => [p.id, p])),
      page: initialPage(),
      modified: Date.parse("2026-09-30T08:00:00Z"),
      history: new Map(),
    };
  }
  endSales(g.__vetrinaDemo.products);
  return g.__vetrinaDemo;
}

const gmt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

/** Every block of the page in order, with its path: top-level blocks sit at even indexes (whitespace between), as parse_blocks() numbers them. */
function leaves(): { path: string; item: DemoItem; container: DemoItem[] | null }[] {
  return state().page.flatMap((node, i): { path: string; item: DemoItem; container: DemoItem[] | null }[] =>
    "item" in node
      ? [{ path: String(i * 2), item: node.item, container: null }]
      : node.group.map((item, j) => ({ path: `${i * 2}.${j}`, item, container: node.group })),
  );
}

/** What a rail shows, as its key names it: "category:saldi", "brand:adidas", "type:recent". */
function keyBaseOf(rail: DemoRail): string {
  const { category, brand, tag, type } = rail.atts;
  if (category) return `category:${category}`;
  if (brand) return `brand:${brand}`;
  if (tag) return `tag:${tag}`;
  return `type:${type ?? "recent"}`;
}

/** The page's rails in order, each with its key and path. */
function railLeaves(): { path: string; rail: DemoRail; key: string; container: DemoItem[] | null }[] {
  const seen = new Map<string, number>();
  return leaves().flatMap(({ path, item, container }) => {
    if (item.kind !== "rail") return [];
    const base = keyBaseOf(item);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return [{ path, rail: item, key: `${base}#${n}`, container }];
  });
}

/** What a rail falls back to when it names nothing: what [gh_product_rail] does (ghb_hub_default_fallback). */
function defaultFallback(rail: DemoRail): RailFallback {
  if (rail.atts.type === "best_selling") return "popularity";
  if (rail.atts.type === "top_rated") return "rating";
  return rail.atts.category || rail.atts.brand ? "menu_order" : "date";
}

/** A block's editable fields: a rail's own, a static block's under the edits made so far. */
function fieldsOf(item: DemoItem): FieldValues {
  const spec = FIELD_SPECS[item.name];
  if (!spec) return {};
  const own: FieldValues = item.kind === "rail" ? item.fields : { title: item.title ?? "", ...item.fields };
  return Object.fromEntries(Object.keys(spec).map((field) => [field, own[field] ?? ""]));
}

function limitOf(rail: DemoRail): number {
  return Number(rail.atts.limit ?? 12);
}

/** The block's fingerprint: everything a write could change — two equal sections have equal ones, as on the site. */
function hashOf(item: DemoItem): string {
  const parts = item.kind === "rail" ? [item.name, item.atts, item.state, fieldsOf(item)] : [item.name, fieldsOf(item)];
  return createHash("md5").update(JSON.stringify(parts)).digest("hex");
}

/** The plugin's checks, applied the same way (fields.ts mirrors them). */
function checkFields(blockName: string, fields: FieldValues): FieldValues {
  const clean: FieldValues = {};
  for (const [field, value] of Object.entries(fields)) {
    const problem = fieldProblem(blockName, field, value);
    if (problem) throw new VetrinaError("invalid", `Valore non valido per ${field} (${problem}).`, 400);
    clean[field] = value.trim();
  }
  return clean;
}

function inBrand(product: DemoProduct, brand: string): boolean {
  for (let b: string | null = product.brand; b; b = DEMO_BRAND_PARENT[b] ?? null) {
    if (b === brand) return true;
  }
  return false;
}

function members(rail: DemoRail): DemoProduct[] {
  const { category, brand, tag, type } = rail.atts;
  const products = state().products;
  if (category) return products.filter((p) => p.categories.includes(category));
  if (brand) return products.filter((p) => inBrand(p, brand));
  if (tag) return products.filter((p) => p.tags.includes(tag));
  return type === "sale" ? products.filter((p) => p.onSale) : products;
}

const byName = (a: DemoProduct, b: DemoProduct) => a.name.localeCompare(b.name, "it", { sensitivity: "base" });

function sortBy(fallback: RailFallback): (a: DemoProduct, b: DemoProduct) => number {
  switch (fallback) {
    case "date":
      return (a, b) => b.created.localeCompare(a.created) || b.id - a.id;
    case "popularity":
      return (a, b) => b.totalSales - a.totalSales || b.id - a.id;
    case "price":
      return (a, b) => a.price - b.price || a.id - b.id;
    case "price-desc":
      return (a, b) => b.price - a.price || b.id - a.id;
    case "rating":
      return (a, b) => b.id - a.id;
    case "menu_order":
    default:
      return (a, b) => a.menuOrder - b.menuOrder || byName(a, b);
  }
}

/** Shown in the shop's lists: WooCommerce leaves "hidden" and "search only" products out of them. */
const listed = (p: DemoProduct) => p.visibility !== "hidden" && p.visibility !== "search";

/** Visible members in automatic order — what ghb_hub_rail_visible_ids() returns. */
function visibleIds(rail: DemoRail, fallback: RailFallback): number[] {
  return members(rail)
    .filter((p) => p.inStock && listed(p))
    .sort(sortBy(fallback))
    .map((p) => p.id);
}

function card(p: DemoProduct): ProductCard {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    type: "simple",
    status: "publish",
    visibility: p.visibility,
    stockStatus: p.inStock ? "instock" : "outofstock",
    price: p.price,
    // One item, no sizes: a single price, on sale or not.
    priceMax: p.price,
    onSale: p.onSale,
    image: p.image,
    permalink: `https://demo.shop/prodotto/${p.id}`,
    editLink: `https://demo.shop/wp-admin/post.php?post=${p.id}&action=edit`,
    created: p.created,
  };
}

function cards(ids: number[]): ProductCard[] {
  const byId = state().byId;
  return ids.map((id) => {
    const p = byId.get(id);
    return p ? card(p) : { ...card(state().products[0]), id, name: "", missing: true };
  });
}

function findRail(match: { path?: string; key?: string }) {
  const found = railLeaves().find((r) => (match.key ? r.key === match.key : r.path === match.path));
  if (!found) throw new VetrinaError("not_found", "Questo blocco non è una sezione prodotti.", 404);
  return found;
}

/** The shortcode's attributes as the plugin reports them: what it shows and its layout, then its order. */
function shortcodeAtts(rail: DemoRail, s: RailState = rail.state): Record<string, string> {
  const atts = { ...rail.atts };
  if (s.pin.length) atts.pin = s.pin.join(",");
  if (s.exclude.length) atts.exclude = s.exclude.join(",");
  if (s.fallback !== defaultFallback(rail)) atts.fallback = s.fallback;
  return atts;
}

function shortcode(rail: DemoRail, s: RailState = rail.state): string {
  return `[gh_product_rail ${Object.entries(shortcodeAtts(rail, s)).map(([k, v]) => `${k}="${v}"`).join(" ")}]`;
}

function summary(path: string, rail: DemoRail, key: string, withProducts: boolean): RailSummary {
  const s = rail.state;
  const limit = limitOf(rail);
  const fields = fieldsOf(rail);
  const rendered = orderIds(visibleIds(rail, s.fallback), s.pin, s.exclude).slice(0, limit);
  const slug = rail.atts.category ?? rail.atts.brand ?? null;
  return {
    key,
    path,
    attrsHash: hashOf(rail),
    title: fields.title,
    eyebrow: fields.eyebrow,
    background: fields.backgroundColor || "white",
    button: { text: fields.buttonText, url: fields.buttonUrl },
    limit,
    // As the plugin resolves them: a category or a brand; a tag or a shop-wide list names no term.
    taxonomy: rail.atts.category ? "product_cat" : rail.atts.brand ? "product_brand" : null,
    terms: slug
      ? [{ id: DEMO_TERM_IDS[slug] ?? 1, slug, name: DEMO_TERM_NAMES[slug] ?? slug, count: members(rail).length, link: null }]
      : [],
    pin: s.pin,
    exclude: s.exclude,
    fallback: s.fallback,
    fallbackDefault: defaultFallback(rail),
    editable: true,
    fields,
    atts: shortcodeAtts(rail),
    switchedOff: fields.hidden === "yes",
    products: withProducts ? cards(rendered) : [],
  };
}

function hiddenReason(rail: DemoRail, id: number, s: RailState): HiddenItem["reason"] {
  const p = state().byId.get(id);
  if (!p) return "missing";
  if (s.exclude.includes(id)) return "excluded";
  if (!members(rail).some((m) => m.id === id)) return "not_in_section";
  if (!p.inStock) return "outofstock";
  if (!listed(p)) return "hidden";
  return "unknown";
}

/** The page as the editor read it, or a refusal: someone (another phone, a test) wrote since. */
function checkPage(expectedModifiedGmt: string): void {
  if (expectedModifiedGmt !== gmt(state().modified)) {
    throw new VetrinaError("stale", "La homepage è stata modificata nel frattempo: ricarica.", 409);
  }
}

/** A section of the page as the Hub read it: where it is and what it was then. */
function railAt(ref: BlockRef) {
  const found = railLeaves().find((r) => r.path === ref.path);
  if (!found) throw new VetrinaError("stale", "La sezione non è più in quella posizione: ricarica.", 409);
  if (hashOf(found.rail) !== ref.attrsHash) {
    throw new VetrinaError("stale", "La sezione è stata modificata nel frattempo: ricarica.", 409);
  }
  return found;
}

/** A source as shortcode attributes, checked against the demo shop's terms as the plugin checks the real ones. */
function sourceAtts(source: RailSource): Record<string, string> {
  if ("list" in source) return { type: source.list };
  const known = source.taxonomy === "category" ? DEMO_TERM_IDS[source.slug] != null && DEMO_BRAND_PARENT[source.slug] === undefined : DEMO_BRAND_PARENT[source.slug] !== undefined;
  if (!known) {
    throw new VetrinaError("invalid", `Non trovo «${source.slug}» ${source.taxonomy === "category" ? "tra le categorie" : "tra i brand"} del negozio.`, 400);
  }
  return { [source.taxonomy]: source.slug };
}

/** The rail pointed at a new source: the old one goes, the layout stays (ghb_hub_set_rail_source). */
function withSource(atts: Record<string, string>, source: RailSource): Record<string, string> {
  const out: Record<string, string> = {};
  let placed = false;
  for (const [key, value] of Object.entries(atts)) {
    if (["category", "brand", "tag", "ids", "type"].includes(key)) {
      if (!placed) Object.assign(out, sourceAtts(source));
      placed = true;
      continue;
    }
    out[key] = value;
  }
  return placed ? out : { ...sourceAtts(source), ...out };
}

/** Where a button pointing at the old source goes now (ghb_hub_followed_button): the new source's page. */
function followedButton(url: string, before: Record<string, string>, source: RailSource): string | null {
  const old = before.category ?? before.brand;
  if (!url.trim() || !old || !url.replace(/\/+$/, "").endsWith(`/${old}`)) return null;
  if ("list" in source) {
    const orderby: Partial<Record<string, string>> = { recent: "date", best_selling: "popularity", top_rated: "rating" };
    return orderby[source.list] ? `/negozio/?orderby=${orderby[source.list]}` : "/negozio/";
  }
  return source.taxonomy === "category" ? `/product-category/${source.slug}/` : `/marchio/${source.slug}/`;
}

/** Everything golden-hive-blocks 5.15.0 reports: the demo does it all. */
const DEMO_FEATURES = [
  "homepage",
  "rail",
  "rail-visible",
  "products",
  "block-write",
  "history",
  "rail-limit",
  "block-fields",
  ...Object.values(SECTION_FEATURES),
];

function cleanIds(ids: number[] | undefined): number[] {
  return [...new Set((ids ?? []).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100);
}

export function fixtureSource(): VetrinaSource {
  return {
    kind: "fixture",

    async capabilities() {
      return {
        version: "demo",
        api: 1,
        features: DEMO_FEATURES,
        fallbacks: ["menu_order", "date", "popularity", "price", "price-desc", "rating"],
        maxIds: 100,
        hideOutOfStock: true,
        frontPageId: 1,
        siteUrl: "https://demo.shop/",
        fields: FIELD_SPECS,
      };
    },

    async homepage(): Promise<Homepage> {
      const keys = new Map(railLeaves().map((r) => [r.path, r.key]));
      return {
        pageId: 1,
        title: "Home",
        link: "https://demo.shop/",
        editLink: "https://demo.shop/wp-admin/post.php?post=1&action=edit",
        modifiedGmt: gmt(state().modified),
        features: DEMO_FEATURES,
        blocks: leaves().map(({ path, item }) =>
          item.kind === "rail"
            ? { path, name: item.name, kind: "rail" as const, rail: summary(path, item, keys.get(path)!, true) }
            : {
                path,
                name: item.name,
                kind: "static" as const,
                summary: { title: fieldsOf(item).title || item.title, items: item.items, labels: item.labels },
                ...(FIELD_SPECS[item.name] ? { fields: fieldsOf(item), attrsHash: hashOf(item) } : {}),
              },
        ),
      };
    },

    async rail(railKey, opts = {}): Promise<RailDetail> {
      const { path, rail, key } = findRail({ key: railKey });
      const s = rail.state;
      const fallback = opts.fallback ?? s.fallback;
      const visible = visibleIds(rail, fallback);
      const ordered = orderIds(visible, s.pin, s.exclude);
      const offset = opts.offset ?? 0;
      const count = opts.count ?? 60;
      const pinned = new Set(s.pin);
      const visibleSet = new Set(visible);
      const hiddenIds = [
        ...s.exclude.filter((id) => visibleSet.has(id)),
        ...s.pin.filter((id) => !visibleSet.has(id) && !s.exclude.includes(id)),
      ];
      const { products: _unused, ...base } = summary(path, rail, key, false);
      return {
        ...base,
        pageId: 1,
        pageLink: "https://demo.shop/",
        modifiedGmt: gmt(state().modified),
        hideOutOfStock: true,
        total: ordered.length,
        offset,
        visible,
        previewFallback: fallback,
        items: cards(ordered.slice(offset, offset + count)).map((c, i) => ({
          ...c,
          position: offset + i + 1,
          pinned: pinned.has(c.id),
        })),
        hidden: cards(hiddenIds).map((c) => ({ ...c, reason: hiddenReason(rail, c.id, s), pinned: pinned.has(c.id) })),
      };
    },

    async products(ids) {
      return cards(ids.slice(0, 100));
    },

    async writeRail(input: RailWrite): Promise<RailWriteResult> {
      const st = state();
      const { rail, key } = findRail({ path: input.path });
      checkPage(input.expectedModifiedGmt);
      if (input.expectedAttrsHash !== hashOf(rail)) {
        throw new VetrinaError("stale", "La sezione è stata modificata nel frattempo: ricarica.", 409);
      }
      if (input.limit != null && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)) {
        throw new VetrinaError("invalid", "Numero di prodotti non valido (da 1 a 100).", 400);
      }
      const atts = input.source ? withSource(rail.atts, input.source) : { ...rail.atts };
      if (input.limit != null) atts.limit = String(input.limit);
      const fields = { ...fieldsOf(rail), ...checkFields(rail.name, input.fields ?? {}) };
      const followed =
        input.source && input.fields?.buttonUrl === undefined ? followedButton(fields.buttonUrl, rail.atts, input.source) : null;
      if (followed) fields.buttonUrl = followed;
      const next: RailState = { pin: cleanIds(input.pin), exclude: cleanIds(input.exclude), fallback: input.fallback };
      const after: DemoRail = { ...rail, atts, state: next, fields };
      const before = shortcode(rail);
      const changed = hashOf(after) !== hashOf(rail);
      if (!input.dryRun && changed) {
        const orderChanged = shortcode(after) !== before;
        const previous = rail.state;
        Object.assign(rail, { atts, state: next, fields });
        const newKey = findRail({ path: input.path }).key;
        if (orderChanged) {
          // Like the plugin's history: one entry per change of order, found by the rail's key — a
          // section pointed elsewhere starts a history of its own.
          const log = st.history.get(newKey) ?? (newKey === key ? [{ ...previous, at: st.modified }] : []);
          log.unshift({ ...next, at: st.modified + 60_000 });
          st.history.set(newKey, log.slice(0, 30));
        }
        st.modified += 60_000;
      }
      const now = findRail({ path: input.path });
      return {
        dryRun: input.dryRun ?? false,
        changed,
        before,
        after: shortcode(after),
        modifiedGmt: gmt(st.modified),
        attrsHash: hashOf(now.rail),
        rendered: orderIds(visibleIds(now.rail, now.rail.state.fallback), now.rail.state.pin, now.rail.state.exclude).slice(0, limitOf(now.rail)),
        fields: fieldsOf(now.rail),
        key: now.key,
        buttonUrl: followed,
      };
    },

    async writeBlock(input: BlockWrite): Promise<RailWriteResult> {
      const st = state();
      const leaf = leaves().find((l) => l.path === input.path && l.item.name === input.blockName);
      if (!leaf || !FIELD_SPECS[leaf.item.name]) {
        throw new VetrinaError("not_found", "Questo blocco non ha campi modificabili dalla Vetrina.", 422);
      }
      const item = leaf.item;
      checkPage(input.expectedModifiedGmt);
      if (input.expectedAttrsHash !== hashOf(item)) {
        throw new VetrinaError("stale", "La homepage è stata modificata nel frattempo: ricarica.", 409);
      }
      const current = fieldsOf(item);
      const next = { ...current, ...checkFields(item.name, input.fields) };
      const changed = JSON.stringify(next) !== JSON.stringify(current);
      if (!input.dryRun && changed) {
        item.fields = next;
        st.modified += 60_000;
      }
      const rail = item.kind === "rail" ? findRail({ path: input.path }) : null;
      return {
        dryRun: input.dryRun ?? false,
        changed,
        before: rail ? shortcode(rail.rail) : "",
        after: rail ? shortcode(rail.rail) : "",
        modifiedGmt: gmt(st.modified),
        attrsHash: hashOf(item),
        rendered: [],
        fields: fieldsOf(item),
        key: rail?.key ?? null,
        buttonUrl: null,
      };
    },

    async writeLayout(input: LayoutWrite): Promise<LayoutWriteResult> {
      const st = state();
      checkPage(input.expectedModifiedGmt);
      let added: DemoRail | null = null;

      if (input.action === "insert") {
        const anchor = railAt(input.anchor);
        const layout = Object.fromEntries(
          ["columns", "columns_tablet", "columns_mobile", "ratio", "fit"].flatMap((k) => {
            const value = input.rail.layout?.[k] ?? anchor.rail.atts[k];
            return value != null ? [[k, value]] : [];
          }),
        );
        const limit = input.rail.limit ?? limitOf(anchor.rail);
        added = {
          kind: "rail",
          name: RAIL_BLOCK,
          atts: { ...sourceAtts(input.rail.source), limit: String(Math.max(1, Math.min(100, limit))), ...layout },
          state: { pin: cleanIds(input.rail.pin), exclude: cleanIds(input.rail.exclude), fallback: input.rail.fallback ?? "menu_order" },
          fields: {},
        };
        added.state.fallback = input.rail.fallback ?? defaultFallback(added);
        const blank: FieldValues = { eyebrow: "", title: "", backgroundColor: "white", buttonText: "", buttonUrl: "", hidden: "" };
        added.fields = { ...blank, ...checkFields(RAIL_BLOCK, input.fields) };
        if (railLeaves().some((r) => hashOf(r.rail) === hashOf(added!))) {
          throw new VetrinaError("invalid", "Nella homepage c'è già una sezione identica: cambia il titolo o cosa mostra.", 422);
        }
        const siblings = anchor.container ?? null;
        if (!input.dryRun) {
          if (siblings) siblings.splice(siblings.indexOf(anchor.rail) + (input.place === "before" ? 0 : 1), 0, added);
          else {
            const at = st.page.findIndex((n) => "item" in n && n.item === anchor.rail);
            st.page.splice(at + (input.place === "before" ? 0 : 1), 0, { item: added });
          }
        }
      } else if (input.action === "remove") {
        const target = railAt(input.target);
        if (railLeaves().length <= 1) {
          throw new VetrinaError("invalid", "È l'ultima sezione di prodotti della homepage: si toglie dall'editor di WordPress.", 422);
        }
        if (!input.dryRun) {
          if (target.container) target.container.splice(target.container.indexOf(target.rail), 1);
          else st.page = st.page.filter((n) => !("item" in n && n.item === target.rail));
        }
      } else {
        const rails = railLeaves();
        if (input.order.length !== rails.length) {
          throw new VetrinaError("stale", "Le sezioni della homepage sono cambiate nel frattempo: ricarica.", 409);
        }
        const wanted = input.order.map((ref) => railAt(ref).rail);
        if (new Set(wanted).size !== wanted.length) throw new VetrinaError("invalid", "Ogni sezione va messa una volta sola.", 400);
        if (!input.dryRun) {
          // Each section's place stays where it is; each place takes the section that goes there now.
          // The places are found first: a section put in one may still be in another.
          const places = rails.map((slot) =>
            slot.container
              ? { list: slot.container, index: slot.container.indexOf(slot.rail) }
              : { list: null, index: st.page.findIndex((n) => "item" in n && n.item === slot.rail) },
          );
          places.forEach((place, i) => {
            if (place.list) place.list[place.index] = wanted[i];
            else st.page[place.index] = { item: wanted[i] };
          });
        }
      }

      if (!input.dryRun) st.modified += 60_000;
      const now = added ? railLeaves().find((r) => r.rail === added) : null;
      return {
        dryRun: input.dryRun ?? false,
        changed: true,
        modifiedGmt: gmt(st.modified),
        key: now?.key ?? null,
        path: now?.path ?? null,
      };
    },

    async history(key): Promise<RailHistoryState[]> {
      return (state().history.get(key) ?? []).map((s, i) => ({
        pin: s.pin,
        exclude: s.exclude,
        fallback: s.fallback,
        revisionId: 1000 - i,
        dateGmt: gmt(s.at),
        author: "Demo",
      }));
    },
  };
}
