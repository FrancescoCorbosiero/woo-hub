import "server-only";
import { hubConfig } from "@/config";
import type { OperationInput, OperationKind, OperationPreview, TermKey } from "@/lib/vetrina/catalog-ops";
import { decodeEntities, type IndexRow } from "@/server/collections/index-rows";
import { collectionsByTerm } from "@/server/collections/service";
import { storeClient } from "@/server/collections/store";
import { followSaleRuleFor } from "@/server/overrides/model";
import { getOverrides } from "@/server/overrides/repo";
import { defaultCategoryIds, homepagePresence, withDescendants, type CatalogTrees } from "@/server/vetrina/catalog";
import { readRail } from "@/server/vetrina/service";
import { VetrinaError } from "@/server/vetrina/source";
import type { OperationLabelParams } from "@/server/db/schema";
import { mapLimit, parseTermKey, resolveTarget, rowsInOrder, termName, wholeTermAction } from "./context";
import { readSizes } from "./live";
import { assessMargin, marginChanges } from "./margin";
import {
  bump,
  labelParams,
  listAfter,
  otherTerms,
  pinList,
  planSale,
  planUnsale,
  productSkip,
  raisesPrice,
  reasonCounts,
  salePriceWords,
  sectionCounts,
  standingSale,
  visibilityAfter,
  type Reason,
} from "./plan";
import { termOperationRows, visibilityBeforeHide } from "./repo";
import { pinnable, railFill, sectionMembers } from "./sections";
import { heldByTermHides, heldTerms, hiddenOver, logSince, shopToday, standingTermHide, termSaleProducts } from "./standing";
import { words, type Words } from "./words";

/**
 * What an action would do, before it runs — from the store index, the fast
 * way: the products named, how many change, why the others stay as they
 * are, what the owner should know. A sale reads the sizes of only its first
 * products live (a sample). The run itself reads every product again.
 *
 * The same assessment gives a starting action its label and its refusals.
 */

/** Products a preview names, and a sale reads live. */
const SAMPLE = 20;
/** Live reads at once for a sale's sample. */
const LIVE_READS = 4;

export interface Assessment {
  preview: OperationPreview;
  /** The log's label, as data: rendered in the reader's language when shown. */
  label: OperationLabelParams;
  /** The whole term it is filed under. */
  termKey: TermKey | null;
  /** Products it acts on, as resolved now. */
  total: number;
  /** Why it cannot start; the preview says it first among its warnings. */
  refusal: string | null;
}

interface Ctx {
  ids: number[];
  rows: IndexRow[];
  missing: number[];
  trees: CatalogTrees;
  /** Read the store for the sample (a preview), or not (an action starting). */
  live: boolean;
  /** The owner's words, in his language. */
  w: Words;
}

type Sample = OperationPreview["sample"][number];

interface Parts {
  changes: number;
  untouched: Map<Reason, number>;
  sample: Sample[];
  warnings: string[];
  sampled?: number;
  /** Products gone from the shop, when not every one the index lacks. */
  gone?: number;
}

function preview(kind: OperationKind, ctx: Ctx, parts: Parts, refusal: string | null): OperationPreview {
  bump(parts.untouched, ctx.w.untouched.gone, parts.gone ?? ctx.missing.length);
  return {
    kind,
    changes: refusal ? 0 : Math.max(0, parts.changes),
    untouched: reasonCounts(parts.untouched),
    sample: parts.sample.slice(0, SAMPLE),
    warnings: refusal ? [refusal, ...parts.warnings.filter((w) => w !== refusal)] : parts.warnings,
    ...(parts.sampled != null ? { sampled: parts.sampled } : {}),
  };
}

const termNames = (list: { name: string }[], w: Words) => list.map((t) => decodeEntities(t.name)).join(", ") || w.state.noTerms;

/* ---------------------------------------------------------------- *
 * Hide and show
 * ---------------------------------------------------------------- */

/** A whole term's products: the other categories and brands they show in, by name. */
function elsewhere(todo: IndexRow[], key: TermKey, trees: CatalogTrees, w: Words): string | null {
  const own = parseTermKey(key);
  if (!own) return null;
  const subtree = withDescendants(own.id, trees[own.taxonomy].children);
  const defaults = defaultCategoryIds(trees.category);
  const names = new Map<string, string>();
  for (const t of trees.category.terms.values()) {
    if (defaults.has(t.id) || (own.taxonomy === "category" && subtree.has(t.id))) continue;
    names.set(`category:${t.id}`, t.name);
  }
  for (const t of trees.brand.terms.values()) {
    if (own.taxonomy === "brand" && subtree.has(t.id)) continue;
    names.set(`brand:${t.id}`, t.name);
  }
  const other = otherTerms(
    todo.map((r) => ({ terms: [...r.categories.map((c) => `category:${c.id}`), ...r.brands.map((b) => `brand:${b.id}`)] })),
    names,
  );
  return other.count > 0 ? w.warning.alsoElsewhere(other.count, other.names, other.total) : null;
}

async function assessVisibility(ctx: Ctx, input: Extract<OperationInput, { kind: "hide" | "show" }>): Promise<Assessment> {
  const { kind } = input;
  const { w } = ctx;
  // The product sheet's switch: each back as it was before its hide.
  const was = input.kind === "show" && input.restore ? await visibilityBeforeHide(ctx.rows.map((r) => r.id)) : new Map<number, string>();
  const afterOf = (r: IndexRow) => visibilityAfter(kind, r.visibility || "visible", was.get(r.id));
  const toChange = ctx.rows.filter((r) => afterOf(r) != null);
  const untouched = new Map<Reason, number>();
  bump(untouched, kind === "hide" ? w.untouched.alreadyHidden : w.untouched.alreadyVisible, ctx.rows.length - toChange.length);
  // A term panel's "Mostra i N nascosti": what another hidden category or brand holds stays for its own "Mostra".
  const held = input.kind === "show" && input.keepHeld ? await heldByTermHides(toChange.map((r) => r.id)) : new Map();
  const todo = held.size > 0 ? toChange.filter((r) => !held.has(r.id)) : toChange;
  if (held.size > 0) {
    const names = heldTerms(held, ctx.trees).map((t) => t.term);
    bump(untouched, (count) => w.untouched.held(count, names), held.size);
  }
  const sample = todo.slice(0, SAMPLE).map((r) => ({
    id: r.id,
    name: r.name,
    before: w.state.visibility(r.visibility || "visible"),
    after: w.state.visibility(afterOf(r)!),
  }));
  const warnings: string[] = [];
  let refusal: string | null = null;
  let term: string | null = null;
  const termKey = input.kind === "hide" ? (input.termKey ?? null) : null;
  if (termKey) {
    term = termName(ctx.trees, termKey);
    // "Mostra" undoes the standing hide: a second one would leave nothing to undo exactly.
    if (await standingTermHide(termKey)) refusal = w.error.alreadyHidden(term);
    const also = elsewhere(todo, termKey, ctx.trees, w);
    if (also) warnings.push(also);
  }
  if (kind === "hide") {
    const sections = sectionCounts(
      todo.map((r) => r.id),
      (await homepagePresence()).products,
    );
    if (sections.length > 0) warnings.push(w.warning.sectionsLose(sections));
  }
  return {
    preview: preview(kind, ctx, { changes: todo.length, untouched, sample, warnings }, refusal),
    label: labelParams(input, { count: todo.length, term }),
    termKey,
    total: ctx.ids.length,
    refusal,
  };
}

/* ---------------------------------------------------------------- *
 * Sale and its end
 * ---------------------------------------------------------------- */

async function assessSale(ctx: Ctx, input: Extract<OperationInput, { kind: "sale" | "unsale" }>): Promise<Assessment> {
  const { w } = ctx;
  const termKey = input.termKey ?? null;
  const term = termKey ? termName(ctx.trees, termKey) : null;
  // A sale's end only concerns what is on sale; the index says which (the run reads every size again).
  const candidates = input.kind === "sale" ? ctx.rows : ctx.rows.filter((r) => r.onSale);
  const termRows = termKey ? await termOperationRows(termKey, await logSince()) : [];
  // A new sale on the whole term replaces the term's own: the products on it are not on a sale of their own.
  const termSale = input.kind === "sale" && termKey && ctx.live ? await termSaleProducts(termRows) : new Set<number>();
  // "Cambia lo sconto" at the percent and rounding the term's sale already has: only its last day moves, and its
  // label says so (as the sheet's button does). A new rounding moves prices: that is a new discount.
  const standing = input.kind === "sale" && termKey ? standingSale(termRows, shopToday()) : null;
  const endsOnly =
    input.kind === "sale" &&
    standing?.input.kind === "sale" &&
    standing.input.percent === input.percent &&
    standing.input.rounding === input.rounding &&
    (standing.input.endsOn ?? null) !== (input.endsOn ?? null);
  const untouched = new Map<Reason, number>();
  bump(untouched, w.untouched.noSale, ctx.rows.length - candidates.length);
  const sample: Sample[] = [];
  let changes = candidates.length;
  let sampled: number | undefined;
  // Of the products read live, those this sale puts UP: their own sale is deeper.
  let raised = 0;
  if (ctx.live && candidates.length > 0) {
    const client = await storeClient();
    const first = candidates.slice(0, SAMPLE);
    const read = await mapLimit(first, LIVE_READS, (r) => readSizes(client, r));
    sampled = first.length;
    first.forEach((row, i) => {
      const sizes = read[i];
      if (!sizes) {
        changes -= 1;
        bump(untouched, w.untouched.gone);
        return;
      }
      const plans = input.kind === "sale" ? planSale(sizes.sizes, input) : planUnsale(sizes.sizes);
      const skip = productSkip(plans);
      if (skip) {
        changes -= 1;
        bump(untouched, w.untouched[skip]);
        return;
      }
      if (input.kind === "sale" && !termSale.has(row.id) && raisesPrice(sizes.sizes, plans)) raised += 1;
      sample.push({ id: row.id, name: row.name, ...salePriceWords(sizes.sizes, plans, w) });
    });
  }
  const warnings: string[] = [];
  if (input.kind === "sale") {
    // A sale replaces whatever sale a product had: one with a deeper discount gets dearer.
    if (raised > 0) warnings.push(w.warning.deeperSale(raised));
    // WooCommerce ends a dated sale whole, on its day: a product's own earlier sale ends with it.
    const ownSale = input.endsOn ? candidates.filter((r) => r.onSale && !termSale.has(r.id)).length : 0;
    if (ownSale > 0) warnings.push(w.warning.ownSaleEnds(ownSale));
    // The one price warning: where the Hub reprices discounted items, the
    // regular price keeps following the market during the sale.
    const overrides = await getOverrides();
    const repriced = candidates.filter((r) => r.sku && !followSaleRuleFor(overrides, r.sku)).length;
    if (repriced > 0) warnings.push(w.warning.repricing(repriced));
  }
  const sections = sectionCounts(
    candidates.map((r) => r.id),
    (await homepagePresence()).products,
  );
  if (sections.length > 0) warnings.push(w.warning.sectionsShow(sections));
  return {
    preview: preview(input.kind, ctx, { changes, untouched, sample, warnings, sampled }, null),
    label: labelParams(input, { count: candidates.length, term, endsOnly }),
    termKey,
    total: ctx.ids.length,
    refusal: null,
  };
}

/* ---------------------------------------------------------------- *
 * Tags and categories
 * ---------------------------------------------------------------- */

const sameName = (a: string, b: string) => decodeEntities(a).trim().toLowerCase() === b.trim().toLowerCase();

/** The tag an action names: one on the store (by id, or by name), or a new one to create. */
export async function findTag(tag: { id?: number; name: string }): Promise<{ id: number | null; name: string }> {
  const tags = await (await storeClient()).listTags();
  if (tag.id) {
    const found = tags.find((t) => t.id === tag.id);
    if (!found) throw new VetrinaError("not_found", words().error.tagGone, 404);
    return { id: found.id, name: decodeEntities(found.name) };
  }
  const found = tags.find((t) => sameName(t.name, tag.name));
  return found ? { id: found.id, name: decodeEntities(found.name) } : { id: null, name: tag.name.trim() };
}

async function assessTags(ctx: Ctx, input: Extract<OperationInput, { kind: "tag" | "untag" }>): Promise<Assessment> {
  const { w } = ctx;
  const tag = input.kind === "tag" ? await findTag(input.tag) : await findTag({ id: input.tagId, name: "" });
  const has = (r: IndexRow) => tag.id != null && r.tags.some((t) => t.id === tag.id);
  const todo = ctx.rows.filter((r) => (input.kind === "tag" ? !has(r) : has(r)));
  const untouched = new Map<Reason, number>();
  bump(untouched, input.kind === "tag" ? w.untouched.hasTag : w.untouched.noTag, ctx.rows.length - todo.length);
  const sample = todo.slice(0, SAMPLE).map((r) => ({
    id: r.id,
    name: r.name,
    before: termNames(r.tags, w),
    after: termNames(input.kind === "tag" ? [...r.tags, { name: tag.name }] : r.tags.filter((t) => t.id !== tag.id), w),
  }));
  const warnings = input.kind === "tag" && tag.id == null ? [w.warning.newTag(tag.name)] : [];
  return {
    preview: preview(input.kind, ctx, { changes: todo.length, untouched, sample, warnings }, null),
    label: labelParams(input, { count: todo.length, tag: tag.name }),
    termKey: null,
    total: ctx.ids.length,
    refusal: null,
  };
}

async function assessCategories(
  ctx: Ctx,
  input: Extract<OperationInput, { kind: "categorize" | "uncategorize" }>,
): Promise<Assessment> {
  const { w } = ctx;
  const category = ctx.trees.category.terms.get(input.categoryId);
  if (!category) throw new VetrinaError("not_found", w.error.categoryGone, 404);
  const name = category.name;
  // Never best-effort: writing into an automatic category would fight its rule.
  const automatic = (await collectionsByTerm())[input.categoryId] != null;
  const has = (r: IndexRow) => r.categories.some((c) => c.id === input.categoryId);
  const todo = ctx.rows.filter((r) => (input.kind === "categorize" ? !has(r) : has(r)));
  const untouched = new Map<Reason, number>();
  const warnings: string[] = [];
  let refusal: string | null = null;
  if (automatic) {
    refusal = w.error.automatic(name);
    bump(untouched, w.untouched.automatic, ctx.rows.length);
  } else {
    bump(untouched, input.kind === "categorize" ? w.untouched.inCategory : w.untouched.notInCategory, ctx.rows.length - todo.length);
  }
  if (input.kind === "uncategorize" && !automatic) {
    const defaults = defaultCategoryIds(ctx.trees.category);
    const left = todo.filter((r) => r.categories.every((c) => c.id === input.categoryId || defaults.has(c.id))).length;
    if (left > 0) warnings.push(w.warning.noCategoryLeft(left));
  }
  // A margin set on a category follows its products: a move under another one changes their price.
  if (!automatic && todo.length > 0) {
    const moved = await marginChanges(
      todo
        .filter((r) => r.sku)
        .map((r) => {
          const brands = r.brands.map((b) => b.id);
          const before = r.categories.map((c) => c.id);
          const change = input.kind === "categorize" ? { add: input.categoryId } : { remove: input.categoryId };
          return { sku: r.sku, before: { categories: before, brands }, after: { categories: listAfter(before, change) ?? before, brands } };
        }),
    );
    if (moved.length > 0) warnings.push(w.warning.marginMoves(moved.length));
  }
  // A hidden category's products are hidden everywhere: those put into it join them.
  if (input.kind === "categorize" && !automatic && todo.length > 0) {
    const hidden = await hiddenOver("category", input.categoryId, ctx.trees);
    if (hidden) warnings.push(w.warning.intoHidden(todo.length, hidden));
  }
  const sample = todo.slice(0, SAMPLE).map((r) => {
    const after = listAfter(
      r.categories.map((c) => c.id),
      input.kind === "categorize" ? { add: input.categoryId } : { remove: input.categoryId },
    ) ?? [];
    const named = (ids: number[]) => ids.map((id) => ({ name: ctx.trees.category.terms.get(id)?.name ?? "" })).filter((t) => t.name);
    return { id: r.id, name: r.name, before: termNames(named(r.categories.map((c) => c.id)), w), after: termNames(named(after), w) };
  });
  return {
    preview: preview(input.kind, ctx, { changes: todo.length, untouched, sample: refusal ? [] : sample, warnings }, refusal),
    label: labelParams(input, { count: todo.length, category: name }),
    termKey: null,
    total: ctx.ids.length,
    refusal,
  };
}

/* ---------------------------------------------------------------- *
 * A place on the homepage
 * ---------------------------------------------------------------- */

async function assessPin(ctx: Ctx, input: Extract<OperationInput, { kind: "pin" }>): Promise<Assessment> {
  const { w } = ctx;
  const { rail } = await readRail(input.sectionKey);
  const title = rail.title.trim() || rail.key;
  const { fill, term } = await railFill(rail);
  const max = hubConfig.vetrina.maxPins;
  const members = sectionMembers(rail, ctx.rows, ctx.trees);
  for (const id of rail.visible) members.add(id);
  const known = new Set(ctx.rows.map((r) => r.id));
  const targets = ctx.ids.filter((id) => known.has(id) || members.has(id));
  // A manual category's section takes a product by adding it to the category; any other only shows its own.
  const candidates = targets.filter((id) => members.has(id) || fill === "category");
  const plan = pinList(candidates, rail.pin, max);
  // Nothing to pin there: refused, rather than a new homepage revision that changes nothing.
  const refusal = !pinnable(rail) ? w.error.notPinnable : plan.placed.length === 0 ? w.error.nothingToPin(title) : null;
  const untouched = new Map<Reason, number>();
  bump(untouched, w.untouched.notInSection, targets.length - candidates.length);
  bump(untouched, (count) => w.untouched.overMax(count, max), plan.overflow.length);
  const warnings: string[] = [];
  const added = plan.placed.filter((id) => !members.has(id));
  if (added.length > 0 && term) {
    warnings.push(w.warning.categoryAdded(added.length, term.name));
    const hidden = await hiddenOver("category", term.id, ctx.trees);
    if (hidden) warnings.push(w.warning.intoHidden(added.length, hidden));
  }
  const shownAgain = plan.placed.filter((id) => rail.exclude.includes(id)).length;
  if (shownAgain > 0) warnings.push(w.warning.shownAgain(shownAgain));
  if (plan.dropped.length > 0) warnings.push(w.warning.dropped(plan.dropped.length, max));
  const names = new Map<number, string>([...rail.items.map((i) => [i.id, i.name] as const), ...ctx.rows.map((r) => [r.id, r.name] as const)]);
  const positions = new Map(rail.items.map((i) => [i.id, i.position]));
  const sample = plan.placed.slice(0, SAMPLE).map((id, i) => {
    const pinnedAt = rail.pin.indexOf(id);
    const before =
      pinnedAt >= 0
        ? w.state.pinned(pinnedAt + 1)
        : positions.has(id)
          ? w.state.shown(positions.get(id)!)
          : w.state.notShown;
    return {
      id,
      name: names.get(id) ?? `#${id}`,
      before,
      after: added.includes(id) && term ? w.state.addedTo(term.name) : w.state.pinned(i + 1),
    };
  });
  return {
    preview: preview("pin", ctx, { changes: plan.placed.length, untouched, sample, warnings, gone: ctx.ids.length - targets.length }, refusal),
    label: labelParams(input, { count: plan.placed.length, section: title }),
    termKey: null,
    total: ctx.ids.length,
    refusal,
  };
}

/* ---------------------------------------------------------------- *
 * Entry
 * ---------------------------------------------------------------- */

/**
 * Resolve the target and assess the action over it. `live`: read a sale's
 * sample from the store, price a margin's products. A margin has no target:
 * it is its whole term's (margin.ts).
 */
export async function assess(input: OperationInput, opts: { live: boolean }): Promise<Assessment> {
  if (input.kind === "margin") return assessMargin(input, opts);
  const target = await resolveTarget(input.target, { wholeTerm: wholeTermAction(input) });
  const { rows, missing } = await rowsInOrder(target.ids);
  const ctx: Ctx = { ids: target.ids, rows, missing, trees: target.trees, live: opts.live, w: words() };
  switch (input.kind) {
    case "hide":
    case "show":
      return assessVisibility(ctx, input);
    case "sale":
    case "unsale":
      return assessSale(ctx, input);
    case "tag":
    case "untag":
      return assessTags(ctx, input);
    case "categorize":
    case "uncategorize":
      return assessCategories(ctx, input);
    case "pin":
      return assessPin(ctx, input);
  }
}
