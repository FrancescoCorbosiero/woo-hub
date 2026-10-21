import "server-only";
import { blockConfig, hubConfig } from "@/config";
import { SWITCH_FIELD } from "@/lib/vetrina/fields";
import { defaultFallbackFor, keysAfterArrange, railSourceOf, sameSource, sourceKey } from "@/lib/vetrina/sections";
import type {
  BlockRef,
  FieldValues,
  RailFallback,
  RailSource,
  RailSummary,
  RailWriteResult,
} from "@/lib/vetrina/types";
import { homepagePresence, readCatalogTrees, type CatalogTrees } from "./catalog";
import { rowsInOrder } from "./operations/context";
import { sectionMembers } from "./operations/sections";
import { requirePower, sectionPowers, siteFeatures } from "./powers";
import { allowedFieldChanges, assertSectionLimit } from "./service";
import { getVetrinaSource, VetrinaError } from "./source";

/**
 * The homepage's sections themselves, from the Vetrina: what a section shows
 * (another category, brand or shop-wide list), a new section, one taken
 * away, their order on the page, a section switched off. Each is one write to
 * the page through golden-hive-blocks (a WordPress revision), refused when
 * the page changed since the screen read it, and each answers what its
 * "Annulla" needs.
 */

const RAIL_BLOCK = "golden-hive/shortcode-wrapper";
/** The rail layout a section taken away keeps for its way back. */
const LAYOUT_KEYS = ["columns", "columns_tablet", "columns_mobile", "ratio", "fit"] as const;

const refOf = (rail: Pick<RailSummary, "path" | "attrsHash">): BlockRef => ({ path: rail.path, attrsHash: rail.attrsHash });

function stale(): VetrinaError {
  return new VetrinaError("stale", "La homepage è stata modificata nel frattempo: ricarica.", 409);
}

/** The term a source names, in the store's trees; refused when the shop has none of that slug. */
function termOf(trees: CatalogTrees, source: Extract<RailSource, { taxonomy: string }>): { id: number; name: string } {
  for (const term of trees[source.taxonomy].terms.values()) {
    if (term.slug === source.slug) return { id: term.id, name: term.name };
  }
  throw new VetrinaError(
    "not_found",
    source.taxonomy === "category" ? "Questa categoria non c'è più nel negozio." : "Questo brand non c'è più nel negozio.",
    404,
  );
}

/** A section shaped like one showing `source`, for sectionMembers(). */
function railShowing(source: RailSource, trees: CatalogTrees): Pick<RailSummary, "taxonomy" | "terms" | "atts"> {
  if ("list" in source) return { taxonomy: null, terms: [], atts: { type: source.list } };
  const term = termOf(trees, source);
  return {
    taxonomy: source.taxonomy === "category" ? "product_cat" : "product_brand",
    terms: [{ id: term.id, slug: source.slug, name: term.name, count: 0, link: null }],
    atts: {},
  };
}

/** A link's path, for comparing links written in different forms ("/x/", "https://shop/x"). */
function linkPath(url: string): string {
  try {
    return new URL(url, "https://site.invalid").pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/* ---------------------------------------------------------------- *
 * The refusals a write and its preview share
 * ---------------------------------------------------------------- */

/** A shop-wide list the Vetrina may pick (hub.config.ts's vetrina.lists). */
export function assertListAllowed(source: RailSource): void {
  if ("list" in source && !hubConfig.vetrina.lists.includes(source.list)) {
    throw new VetrinaError("invalid", "Questa lista non si può scegliere dalla Vetrina.", 400);
  }
}

/** Pointing a section at what it shows already changes nothing. */
export function assertNewSource(rail: Pick<RailSummary, "taxonomy" | "terms" | "atts">, source: RailSource): void {
  if (sameSource(railSourceOf(rail), source)) throw new VetrinaError("invalid", "La sezione mostra già questo.", 400);
}

/**
 * The section a removal takes away, and its place: refused when it is not
 * on the page, when no write could put it back (a fixed list, a tag), or
 * when it is the homepage's last section.
 */
export function removalOf(rails: readonly RailSummary[], key: string): { index: number; rail: RailSummary } {
  const index = rails.findIndex((r) => r.key === key);
  if (index < 0) throw new VetrinaError("not_found", "Sezione non trovata: forse è stata tolta dalla homepage.", 404);
  const rail = rails[index];
  if (!railSourceOf(rail)) throw new VetrinaError("invalid", "Questa sezione si toglie dall'editor di WordPress.", 400);
  if (rails.length <= 1) {
    throw new VetrinaError("invalid", "È l'ultima sezione di prodotti della homepage: si toglie dall'editor di WordPress.", 422);
  }
  return { index, rail };
}

/* ---------------------------------------------------------------- *
 * What a section shows
 * ---------------------------------------------------------------- */

export interface SourceChange {
  /** The pinned products the new source holds too: they keep their places. */
  keptPins: number[];
  /** Pinned products it does not hold: they go back to being nothing special. */
  droppedPins: number;
  keptHidden: number[];
  droppedHidden: number;
  /** The other sections already showing that. */
  alsoIn: string[];
  /** The section's button pointed at what it showed: it moves to the new page. */
  buttonFollows: boolean;
  /** The automatic order after the pins, once it shows the new source. */
  fallback: RailFallback;
}

/**
 * What pointing a section at `source` would do, before it is done: which of
 * its pinned and hidden products stay (the ones the new source holds, per
 * the store index), where else that shows, whether its button follows. When
 * the index cannot be read, nothing is kept: a section pointed elsewhere
 * starts clean rather than with pins it cannot show.
 */
export async function previewSectionSource(key: string, source: RailSource): Promise<SourceChange> {
  const vetrina = await getVetrinaSource();
  const rail = await vetrina.rail(key, { count: 1 });
  return sourceChange(rail, source);
}

/** previewSectionSource() for a section already read. */
export async function sourceChange(rail: Omit<RailSummary, "products">, source: RailSource): Promise<SourceChange> {
  const before = railSourceOf(rail);
  let members = new Set<number>();
  let presenceKey: string | null = null;
  try {
    const trees = await readCatalogTrees();
    const shown = railShowing(source, trees);
    if (shown.terms[0]) presenceKey = `${"list" in source ? "" : source.taxonomy}:${shown.terms[0].id}`;
    const { rows } = await rowsInOrder([...rail.pin, ...rail.exclude]);
    members = sectionMembers(shown, rows, trees);
  } catch (e) {
    if (e instanceof VetrinaError && e.code === "not_found") throw e;
  }
  const alsoIn = presenceKey
    ? ((await homepagePresence().catch(() => null))?.terms.get(presenceKey) ?? [])
        .filter((section) => section.key !== rail.key)
        .map((section) => section.title)
    : [];
  const keptPins = rail.pin.filter((id) => members.has(id));
  const keptHidden = rail.exclude.filter((id) => members.has(id));
  // A link to the old category or brand's page follows it; any other link is the owner's own.
  const oldLink = rail.terms.length === 1 ? rail.terms[0].link : null;
  const url = rail.button.url.trim();
  const buttonFollows =
    before != null &&
    !("list" in before) &&
    url !== "" &&
    (oldLink ? linkPath(oldLink) === linkPath(url) : linkPath(url).endsWith(`/${before.slug}`));
  // An automatic order the owner chose stays; the old source's default gives way to the new one's.
  const fallback = rail.fallback !== rail.fallbackDefault ? rail.fallback : defaultFallbackFor(source);
  return {
    keptPins,
    droppedPins: rail.pin.length - keptPins.length,
    keptHidden,
    droppedHidden: rail.exclude.length - keptHidden.length,
    alsoIn,
    buttonFollows,
    fallback,
  };
}

export interface SourceInput {
  key: string;
  expectedModifiedGmt: string;
  expectedAttrsHash: string;
  source: RailSource;
  /** Texts changed with it (a new title). */
  fields?: FieldValues;
  /** "Annulla": the section's pins, hidden products and order exactly as they were. */
  restore?: { pin: number[]; exclude: number[]; fallback: RailFallback };
}

export interface SourceResult {
  /** The section's key now: a new source is a new key. */
  key: string;
  /** Its button's new link, when it followed. */
  buttonUrl: string | null;
  modifiedGmt: string;
  attrsHash: string;
}

/** Point a section at another category, brand or shop-wide list — one write, like a publish. */
export async function changeSectionSource(input: SourceInput): Promise<SourceResult> {
  requirePower("source", await siteFeatures());
  const vetrina = await getVetrinaSource();
  const rail = await vetrina.rail(input.key, { count: 1 });
  if (rail.modifiedGmt !== input.expectedModifiedGmt || rail.attrsHash !== input.expectedAttrsHash) throw stale();
  // Putting a section back ("Annulla") takes what it had, whatever the lists allow now.
  if (!input.restore) {
    assertNewSource(rail, input.source);
    assertListAllowed(input.source);
  }
  const order = input.restore ?? (await sourceChange(rail, input.source));
  const pin = "keptPins" in order ? order.keptPins : order.pin;
  const exclude = "keptHidden" in order ? order.keptHidden : order.exclude;
  const allowed = blockConfig(RAIL_BLOCK).edit;
  const fields = allowedFieldChanges(RAIL_BLOCK, allowed.fields, rail.fields, input.fields ?? {});
  const result: RailWriteResult = await vetrina.writeRail({
    pageId: rail.pageId,
    path: rail.path,
    blockName: RAIL_BLOCK,
    expectedModifiedGmt: rail.modifiedGmt,
    expectedAttrsHash: rail.attrsHash,
    source: input.source,
    pin: pin.slice(0, hubConfig.vetrina.maxPins),
    exclude,
    fallback: order.fallback,
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
  });
  return {
    key: result.key ?? `${sourceKey(input.source)}#0`,
    buttonUrl: result.buttonUrl,
    modifiedGmt: result.modifiedGmt,
    attrsHash: result.attrsHash,
  };
}

/* ---------------------------------------------------------------- *
 * A new section, one taken away
 * ---------------------------------------------------------------- */

export interface AddSectionInput {
  /** The section it goes next to, as the screen read it. */
  anchorKey: string;
  place: "after" | "before";
  /** The page as the screen read it. */
  expectedModifiedGmt: string;
  source: RailSource;
  /** Its texts: title, eyebrow… (and, putting one back, its switch). */
  fields: FieldValues;
  /** How many products it shows; by default as many as the section beside it. */
  limit?: number;
  /** Putting back a section taken away: its pins, hidden products, order and layout as they were. */
  restore?: { pin: number[]; exclude: number[]; fallback: RailFallback; layout: Record<string, string> };
}

/** A section added to the homepage, next to another: its key on the page. */
export async function addSection(input: AddSectionInput): Promise<{ key: string | null; modifiedGmt: string }> {
  const features = await siteFeatures();
  requirePower(input.restore ? "remove" : "add", features);
  const vetrina = await getVetrinaSource();
  const anchor = await vetrina.rail(input.anchorKey, { count: 1 });
  if (anchor.modifiedGmt !== input.expectedModifiedGmt) throw stale();
  if (!input.restore) assertListAllowed(input.source);
  const limit = input.limit ?? anchor.limit;
  assertSectionLimit(limit, input.restore != null);
  // The texts the owner may write, checked as an edit checks them — from blank, as a new block is.
  const blank: FieldValues = Object.fromEntries(Object.keys(anchor.fields).map((field) => [field, ""]));
  const fields = allowedFieldChanges(
    RAIL_BLOCK,
    blockConfig(RAIL_BLOCK).edit.fields,
    { ...blank, backgroundColor: "white" },
    input.fields,
    sectionPowers(features).switchOff,
  );
  const result = await vetrina.writeLayout({
    pageId: anchor.pageId,
    expectedModifiedGmt: anchor.modifiedGmt,
    action: "insert",
    anchor: refOf(anchor),
    place: input.place,
    rail: {
      source: input.source,
      limit,
      ...(input.restore
        ? { pin: input.restore.pin, exclude: input.restore.exclude, fallback: input.restore.fallback, layout: input.restore.layout }
        : {}),
    },
    fields,
  });
  return { key: result.key, modifiedGmt: result.modifiedGmt };
}

export interface RemoveSectionInput {
  key: string;
  expectedModifiedGmt: string;
}

/**
 * A section taken off the homepage — never the last one, nor one whose
 * content a write cannot name again (a fixed list, a tag): its "Annulla"
 * puts it back, next to the same neighbour, with its texts, pins, hidden
 * products, order and layout. The answer is that way back.
 */
export async function removeSection(
  input: RemoveSectionInput,
): Promise<{ restore: AddSectionInput; neighbour: { key: string; attrsHash: string } }> {
  requirePower("remove", await siteFeatures());
  const vetrina = await getVetrinaSource();
  const home = await vetrina.homepage();
  if (home.modifiedGmt !== input.expectedModifiedGmt) throw stale();
  const rails = home.blocks.flatMap((b) => (b.kind === "rail" ? [b.rail] : []));
  const { index, rail } = removalOf(rails, input.key);
  const source = railSourceOf(rail)!;
  // The way back: next to the section above it (or, the first, the one below), as that one is called once this is gone.
  const neighbour = index > 0 ? rails[index - 1] : rails[index + 1];
  const renamed = keysAfterArrange(rails.filter((r) => r !== rail).map((r) => r.key));
  const result = await vetrina.writeLayout({
    pageId: home.pageId,
    expectedModifiedGmt: home.modifiedGmt,
    action: "remove",
    target: refOf(rail),
  });
  const layout = Object.fromEntries(LAYOUT_KEYS.flatMap((k) => (rail.atts[k] != null ? [[k, rail.atts[k]]] : [])));
  const fields = Object.fromEntries(Object.entries(rail.fields).filter(([field, value]) => value !== "" || field === SWITCH_FIELD));
  return {
    // The section it goes back next to, as it is called once this one is gone — and its fingerprint, to find it later.
    neighbour: { key: renamed.get(neighbour.key) ?? neighbour.key, attrsHash: neighbour.attrsHash },
    restore: {
      anchorKey: renamed.get(neighbour.key) ?? neighbour.key,
      place: index > 0 ? "after" : "before",
      expectedModifiedGmt: result.modifiedGmt,
      source,
      fields,
      limit: rail.limit,
      restore: { pin: rail.pin, exclude: rail.exclude, fallback: rail.fallback, layout },
    },
  };
}

/* ---------------------------------------------------------------- *
 * Their order, a section switched off
 * ---------------------------------------------------------------- */

export interface ArrangeInput {
  /** Every section's key, in its new order. */
  keys: string[];
  expectedModifiedGmt: string;
}

/**
 * The sections in a new order: each section's place on the page stays where
 * it is, and takes the section that goes there now. Answers each key as it
 * becomes (two sections showing the same thing swap their "#n").
 */
export async function arrangeSections(input: ArrangeInput): Promise<{ keys: Record<string, string>; modifiedGmt: string }> {
  requirePower("move", await siteFeatures());
  const vetrina = await getVetrinaSource();
  const home = await vetrina.homepage();
  if (home.modifiedGmt !== input.expectedModifiedGmt) throw stale();
  const rails = new Map(home.blocks.flatMap((b) => (b.kind === "rail" ? [[b.rail.key, b.rail] as const] : [])));
  if (input.keys.length !== rails.size || new Set(input.keys).size !== rails.size || input.keys.some((k) => !rails.has(k))) {
    throw new VetrinaError("stale", "Le sezioni della homepage sono cambiate nel frattempo: ricarica.", 409);
  }
  const result = await vetrina.writeLayout({
    pageId: home.pageId,
    expectedModifiedGmt: home.modifiedGmt,
    action: "arrange",
    order: input.keys.map((key) => refOf(rails.get(key)!)),
  });
  return { keys: Object.fromEntries(keysAfterArrange(input.keys)), modifiedGmt: result.modifiedGmt };
}

export interface SwitchInput {
  key: string;
  /** On: shown on the site again; off: on the page, showing nothing. */
  on: boolean;
  expectedModifiedGmt: string;
  expectedAttrsHash: string;
}

/** A section switched off, or on again — straight to the site, as a block's texts are. */
export async function switchSection(input: SwitchInput): Promise<RailWriteResult> {
  requirePower("switchOff", await siteFeatures());
  const vetrina = await getVetrinaSource();
  const rail = await vetrina.rail(input.key, { count: 1 });
  if (rail.modifiedGmt !== input.expectedModifiedGmt || rail.attrsHash !== input.expectedAttrsHash) throw stale();
  return vetrina.writeBlock({
    pageId: rail.pageId,
    path: rail.path,
    blockName: RAIL_BLOCK,
    expectedModifiedGmt: rail.modifiedGmt,
    expectedAttrsHash: rail.attrsHash,
    fields: { [SWITCH_FIELD]: input.on ? "" : "yes" },
  });
}
