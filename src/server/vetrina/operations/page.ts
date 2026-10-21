import "server-only";
import { blockConfig, hubConfig } from "@/config";
import { getDictionary, type Dictionary } from "@/i18n/dictionary";
import type { OperationPreview, OperationVia } from "@/lib/vetrina/catalog-ops";
import type { OperationPageRecord, PageActionInput, PageActionKind, PageExpected, SectionRef } from "@/lib/vetrina/page-ops";
import { findSection, fingerprints, fingerprintsIn, movedCount, movedKeys, orderBack, refOf } from "@/lib/vetrina/page-plan";
import { railSourceOf } from "@/lib/vetrina/sections";
import type { Homepage, RailSource, RailSummary, RailWriteResult } from "@/lib/vetrina/types";
import { decodeEntities } from "@/server/collections/index-rows";
import type { OperationLabelParams, VetrinaOperationRow } from "@/server/db/schema";
import { forgetHomepagePresence, readCatalogTrees } from "@/server/vetrina/catalog";
import {
  addSection,
  arrangeSections,
  assertListAllowed,
  assertNewSource,
  changeSectionSource,
  removalOf,
  removeSection,
  sourceChange,
  switchSection,
  type SourceResult,
} from "@/server/vetrina/layout";
import { requirePower, sectionPowers, siteFeatures } from "@/server/vetrina/powers";
import { allowedFieldChanges, assertPins, assertSectionLimit, publishBlock, publishRail } from "@/server/vetrina/service";
import { getVetrinaSource, VetrinaError } from "@/server/vetrina/source";
import { messageOf } from "./live";
import { labelText, sameIds } from "./plan";
import * as repo from "./repo";
import { logSince } from "./standing";
import { currentLanguage, words } from "./words";

/**
 * The homepage's own actions — a section switched off or on, moved, added,
 * taken away, pointed elsewhere, published from its editor; a block's
 * texts — filed in the catalog's log with the same "Annulla"
 * (lib/vetrina/page-ops.ts). Each is one write to the page, through the
 * same functions the screens always used (layout.ts, service.ts), so the
 * plugin's checks and the config's limits are the same.
 *
 * An action is assessed first — read the page, refuse what the write would
 * refuse, say what it would do — then written, then filed with its way back.
 * The write does not wait for the log: a database that cannot file it
 * leaves the page written, with no line (and no "Annulla") in the log.
 *
 * "Annulla" finds the section again by its fingerprint wherever it is now
 * (page-plan.ts) and writes the way back over the page as it is — refused
 * when the section changed since, as the catalog's undo leaves alone what
 * someone changed after it.
 */

const RAIL_BLOCK = "golden-hive/shortcode-wrapper";

/** What each action's write answers, for the screen that asked. */
interface Results {
  sectionSwitch: RailWriteResult;
  sectionMove: { keys: Record<string, string>; modifiedGmt: string };
  sectionsArrange: { keys: Record<string, string>; modifiedGmt: string };
  sectionAdd: { key: string | null; modifiedGmt: string };
  sectionRemove: { modifiedGmt: string };
  sectionSource: SourceResult;
  sectionEdit: RailWriteResult;
  blockEdit: RailWriteResult;
}
export type PageResult<K extends PageActionKind> = Results[K];

interface Written<K extends PageActionKind> {
  /** Its way back; null when there is none (a section showing a fixed list, a new one the site did not name). */
  record: OperationPageRecord | null;
  /** The section's key after the write (a new section's, a renamed one's); null when none. */
  sectionKey: string | null;
  result: PageResult<K>;
}

/** An action read against the page as it is: refused already, or ready to write. */
export interface PageAssessment<K extends PageActionKind = PageActionKind> {
  label: OperationLabelParams;
  preview: OperationPreview;
  write: () => Promise<Written<K>>;
}

type Input<K extends PageActionKind> = Extract<PageActionInput, { kind: K }>;

/* ---------------------------------------------------------------- *
 * Reading the page
 * ---------------------------------------------------------------- */

const railsOf = (home: Homepage): RailSummary[] => home.blocks.flatMap((b) => (b.kind === "rail" ? [b.rail] : []));
const titleOf = (rail: { key: string; title: string }) => rail.title.trim() || rail.key;
const dictionary = (): Dictionary => getDictionary(currentLanguage());

/** The screen's read, presented back: refused when the page — or the section — changed since. */
function checkExpected(expected: PageExpected | undefined, now: { modifiedGmt: string; attrsHash?: string }): void {
  if (!expected) return;
  const sectionMoved = expected.attrsHash != null && now.attrsHash != null && expected.attrsHash !== now.attrsHash;
  if (expected.modifiedGmt !== now.modifiedGmt || sectionMoved) throw new VetrinaError("stale", words().page.stale, 409);
}

/** What a source shows, by name: the category or brand ("Nike"), the list ("Più venduti"). */
async function sourceName(source: RailSource): Promise<string> {
  if ("list" in source) return dictionary().vetrinaCatalog.sections.pick.lists[source.list]?.title ?? source.list;
  try {
    const trees = await readCatalogTrees();
    for (const term of trees[source.taxonomy].terms.values()) {
      if (term.slug === source.slug) return decodeEntities(term.name);
    }
  } catch {
    // The store index not read: the slug names it.
  }
  return source.slug;
}

/** What a section shows now, by name — "a fixed list of products" when no source names it. */
function railShows(rail: Pick<RailSummary, "taxonomy" | "terms" | "atts">): string {
  const source = railSourceOf(rail);
  const d = dictionary();
  if (!source) {
    const fixed = d.vetrinaCatalog.sections.shows.fixed;
    return fixed.charAt(0).toLowerCase() + fixed.slice(1);
  }
  if ("list" in source) return d.vetrinaCatalog.sections.pick.lists[source.list]?.title ?? source.list;
  return decodeEntities(rail.terms[0]?.name ?? source.slug);
}

/** A block's name as the home screen shows it ("Banner principale"). */
function blockLabel(name: string): string {
  const blocks = dictionary().vetrina.blocks;
  return blockConfig(name).label ?? blocks[name] ?? blocks.other;
}

const fieldNames = (fields: readonly string[]) => {
  const labels = dictionary().vetrina.section.fields;
  return fields.map((field) => labels[field] ?? field);
};

function preview(kind: PageActionKind, lines: string[], warnings: string[] = []): OperationPreview {
  return { kind, changes: 1, untouched: [], sample: [], warnings, page: { lines } };
}

/* ---------------------------------------------------------------- *
 * Assessing each action
 * ---------------------------------------------------------------- */

async function assessSwitch(input: Input<"sectionSwitch">): Promise<PageAssessment<"sectionSwitch">> {
  const w = words();
  requirePower("switchOff", await siteFeatures());
  const rail = await (await getVetrinaSource()).rail(input.key, { count: 1 });
  checkExpected(input.expected, rail);
  const title = titleOf(rail);
  if (rail.switchedOff !== input.on) throw new VetrinaError("invalid", input.on ? w.page.alreadyOn(title) : w.page.alreadyOff(title), 400);
  return {
    label: { kind: input.kind, count: 1, section: title, on: input.on },
    preview: preview(input.kind, [input.on ? w.page.switchOn(title) : w.page.switchOff(title)]),
    write: async () => {
      const result = await switchSection({
        key: rail.key,
        on: input.on,
        expectedModifiedGmt: input.expected?.modifiedGmt ?? rail.modifiedGmt,
        expectedAttrsHash: input.expected?.attrsHash ?? rail.attrsHash,
      });
      return {
        record: { kind: "sectionSwitch", section: refOf({ key: rail.key, attrsHash: result.attrsHash, title }), wasOn: !input.on },
        sectionKey: rail.key,
        result,
      };
    },
  };
}

async function assessMove(input: Input<"sectionMove" | "sectionsArrange">): Promise<PageAssessment<"sectionMove" | "sectionsArrange">> {
  const w = words();
  requirePower("move", await siteFeatures());
  const home = await (await getVetrinaSource()).homepage();
  checkExpected(input.expected, home);
  const rails = railsOf(home);
  const keys = rails.map((r) => r.key);
  let target: string[];
  let label: OperationLabelParams;
  let line: string;
  if (input.kind === "sectionMove") {
    const from = keys.indexOf(input.key);
    if (from < 0) throw new VetrinaError("not_found", w.page.notFound, 404);
    const title = titleOf(rails[from]);
    target = movedKeys(keys, input.key, input.position);
    const to = target.indexOf(input.key);
    if (to === from) throw new VetrinaError("invalid", w.page.samePlace(title, from + 1), 400);
    label = { kind: input.kind, count: 1, section: title, position: to + 1 };
    line = w.page.moved(title, from + 1, to + 1);
  } else {
    target = input.keys;
    if (target.length !== keys.length || new Set(target).size !== keys.length || target.some((key) => !keys.includes(key))) {
      throw new VetrinaError("stale", w.page.stale, 409);
    }
    const moved = movedCount(keys, target);
    if (moved === 0) throw new VetrinaError("invalid", w.page.sameSequence, 400);
    const byKey = new Map(rails.map((r) => [r.key, r]));
    label = { kind: input.kind, count: moved };
    line = w.page.order(target.map((key) => titleOf(byKey.get(key)!)));
  }
  const order = { before: fingerprints(rails), after: fingerprintsIn(rails, target)! };
  return {
    label,
    preview: preview(input.kind, [line]),
    write: async () => {
      const result = await arrangeSections({ keys: target, expectedModifiedGmt: input.expected?.modifiedGmt ?? home.modifiedGmt });
      return {
        record: { kind: input.kind, order },
        sectionKey: input.kind === "sectionMove" ? (result.keys[input.key] ?? input.key) : null,
        result,
      };
    },
  };
}

async function assessAdd(input: Input<"sectionAdd">): Promise<PageAssessment<"sectionAdd">> {
  const w = words();
  requirePower("add", await siteFeatures());
  const source = await getVetrinaSource();
  const anchor = await source.rail(input.anchorKey, { count: 1 });
  checkExpected(input.expected, { modifiedGmt: anchor.modifiedGmt });
  assertListAllowed(input.source);
  const limit = input.limit ?? anchor.limit;
  assertSectionLimit(limit);
  const shows = await sourceName(input.source);
  const title = input.fields.title?.trim() || shows;
  return {
    label: { kind: input.kind, count: 1, section: title },
    preview: preview(input.kind, [w.page.add(title, shows, limit), w.page.addPlace(input.place, titleOf(anchor))]),
    write: async () => {
      const result = await addSection({
        anchorKey: input.anchorKey,
        place: input.place,
        expectedModifiedGmt: input.expected?.modifiedGmt ?? anchor.modifiedGmt,
        source: input.source,
        fields: input.fields,
        limit: input.limit,
      });
      // Its fingerprint, as the site wrote it: what "Annulla" takes away.
      const added = result.key ? await source.rail(result.key, { count: 1 }).catch(() => null) : null;
      return {
        record: added ? { kind: "sectionAdd", section: refOf({ key: added.key, attrsHash: added.attrsHash, title }) } : null,
        sectionKey: result.key,
        result,
      };
    },
  };
}

async function assessRemove(input: Input<"sectionRemove">): Promise<PageAssessment<"sectionRemove">> {
  const w = words();
  requirePower("remove", await siteFeatures());
  const home = await (await getVetrinaSource()).homepage();
  checkExpected(input.expected, home);
  const rails = railsOf(home);
  const { rail } = removalOf(rails, input.key);
  const title = titleOf(rail);
  return {
    label: { kind: input.kind, count: 1, section: title },
    preview: preview(input.kind, [w.page.remove(title)]),
    write: async () => {
      const { restore, neighbour } = await removeSection({
        key: input.key,
        expectedModifiedGmt: input.expected?.modifiedGmt ?? home.modifiedGmt,
      });
      const beside = rails.find((r) => r.attrsHash === neighbour.attrsHash);
      return {
        record: {
          kind: "sectionRemove",
          title,
          restore: {
            anchorKey: restore.anchorKey,
            place: restore.place,
            source: restore.source,
            fields: restore.fields,
            limit: restore.limit ?? rail.limit,
            restore: restore.restore ?? { pin: rail.pin, exclude: rail.exclude, fallback: rail.fallback, layout: {} },
          },
          neighbour: { key: neighbour.key, attrsHash: neighbour.attrsHash, title: beside ? titleOf(beside) : neighbour.key },
        },
        sectionKey: null,
        result: { modifiedGmt: restore.expectedModifiedGmt },
      };
    },
  };
}

async function assessSource(input: Input<"sectionSource">): Promise<PageAssessment<"sectionSource">> {
  const w = words();
  requirePower("source", await siteFeatures());
  const rail = await (await getVetrinaSource()).rail(input.key, { count: 1 });
  checkExpected(input.expected, rail);
  assertNewSource(rail, input.source);
  assertListAllowed(input.source);
  const change = await sourceChange(rail, input.source);
  const title = titleOf(rail);
  const to = await sourceName(input.source);
  const lines = [w.page.source(title, railShows(rail), to)];
  if (change.keptPins.length > 0) lines.push(w.page.keptPins(change.keptPins.length));
  if (change.droppedPins > 0) lines.push(w.page.droppedPins(change.droppedPins));
  if (change.buttonFollows) lines.push(w.page.buttonFollows);
  const before = railSourceOf(rail);
  return {
    label: { kind: input.kind, count: 1, section: title, shows: to },
    preview: preview(input.kind, lines, change.alsoIn.length > 0 ? [w.page.alsoIn(change.alsoIn)] : []),
    write: async () => {
      const result = await changeSectionSource({
        key: rail.key,
        expectedModifiedGmt: input.expected?.modifiedGmt ?? rail.modifiedGmt,
        expectedAttrsHash: input.expected?.attrsHash ?? rail.attrsHash,
        source: input.source,
        fields: input.fields,
      });
      const titleAfter = input.fields?.title?.trim() || title;
      return {
        // What a write cannot name again (a fixed list, tags) has no way back.
        record: before
          ? {
              kind: "sectionSource",
              section: refOf({ key: result.key, attrsHash: result.attrsHash, title: titleAfter }),
              before: {
                source: before,
                title: rail.title,
                buttonUrl: rail.button.url,
                pin: rail.pin,
                exclude: rail.exclude,
                fallback: rail.fallback,
              },
            }
          : null,
        sectionKey: result.key,
        result,
      };
    },
  };
}

async function assessEdit(input: Input<"sectionEdit">): Promise<PageAssessment<"sectionEdit">> {
  const w = words();
  const rail = await (await getVetrinaSource()).rail(input.key, { count: 1 });
  checkExpected(input.expected, rail);
  // What the config lets the owner change, as publishRail() decides it: the rest stays as it is.
  const allowed = blockConfig(RAIL_BLOCK).edit;
  const pin = allowed.pins && input.pin ? input.pin : rail.pin;
  assertPins(pin);
  const exclude = allowed.exclude && input.exclude ? input.exclude : rail.exclude;
  const fallback =
    allowed.fallback && input.fallback && hubConfig.vetrina.fallbacks.includes(input.fallback) ? input.fallback : rail.fallback;
  const features = await siteFeatures().catch(() => []);
  const fields = allowedFieldChanges(RAIL_BLOCK, allowed.fields, rail.fields, input.fields ?? {}, sectionPowers(features).switchOff);
  const sizeable = allowed.limit && Object.keys(rail.fields).length > 0;
  const limit = sizeable && input.limit != null ? input.limit : rail.limit;
  if (limit !== rail.limit) assertSectionLimit(limit);

  const lines: string[] = [];
  if (!sameIds(pin, rail.pin)) lines.push(w.page.pins(pin.length));
  if (!sameIds(exclude, rail.exclude)) lines.push(w.page.hidden(exclude.length));
  if (fallback !== rail.fallback) lines.push(w.page.fallback(dictionary().vetrina.editor.fallbacks[fallback] ?? fallback));
  const changed = Object.keys(fields);
  if (changed.length > 0) lines.push(w.page.fields(fieldNames(changed)));
  if (limit !== rail.limit) lines.push(w.page.limit(limit));
  if (lines.length === 0) throw new VetrinaError("invalid", w.page.unchanged, 400);

  const title = titleOf(rail);
  return {
    label: { kind: input.kind, count: 1, section: title },
    preview: preview(input.kind, lines),
    write: async () => {
      const result = await publishRail({
        key: rail.key,
        expectedModifiedGmt: input.expected?.modifiedGmt ?? rail.modifiedGmt,
        expectedAttrsHash: input.expected?.attrsHash ?? rail.attrsHash,
        pin,
        exclude,
        fallback,
        fields: input.fields,
        limit: input.limit,
      });
      const key = result.key ?? rail.key;
      return {
        record: {
          kind: "sectionEdit",
          section: refOf({ key, attrsHash: result.attrsHash, title: fields.title?.trim() || title }),
          before: {
            pin: rail.pin,
            exclude: rail.exclude,
            fallback: rail.fallback,
            fields: Object.fromEntries(changed.map((field) => [field, rail.fields[field] ?? ""])),
            limit: rail.limit,
          },
        },
        sectionKey: key,
        result,
      };
    },
  };
}

async function assessBlock(input: Input<"blockEdit">): Promise<PageAssessment<"blockEdit">> {
  const w = words();
  const home = await (await getVetrinaSource()).homepage();
  const block = home.blocks.find((b) => b.path === input.path && b.name === input.blockName);
  if (!block || block.kind !== "static" || !block.fields || !block.attrsHash) {
    throw new VetrinaError("not_found", w.page.blockNotFound, 404);
  }
  const current = { fields: block.fields, attrsHash: block.attrsHash };
  checkExpected(input.expected, { modifiedGmt: home.modifiedGmt, attrsHash: current.attrsHash });
  const fields = allowedFieldChanges(block.name, blockConfig(block.name).edit.fields, current.fields, input.fields);
  const changed = Object.keys(fields);
  if (changed.length === 0) throw new VetrinaError("invalid", w.page.unchanged, 400);
  const label = blockLabel(block.name);
  return {
    label: { kind: input.kind, count: 1, block: label },
    preview: preview(input.kind, [w.page.fields(fieldNames(changed))]),
    write: async () => {
      const result = await publishBlock({
        path: block.path,
        blockName: block.name,
        expectedModifiedGmt: input.expected?.modifiedGmt ?? home.modifiedGmt,
        expectedAttrsHash: input.expected?.attrsHash ?? current.attrsHash,
        fields: input.fields,
      });
      return {
        record: {
          kind: "blockEdit",
          block: { path: block.path, blockName: block.name, attrsHash: result.attrsHash, label },
          before: Object.fromEntries(changed.map((field) => [field, current.fields[field] ?? ""])),
        },
        sectionKey: null,
        result,
      };
    },
  };
}

/** Read the action against the page as it is: what it would do, or why it cannot. Nothing is written. */
export function assessPage<K extends PageActionKind>(input: Input<K>): Promise<PageAssessment<K>>;
export async function assessPage(input: PageActionInput): Promise<PageAssessment> {
  switch (input.kind) {
    case "sectionSwitch":
      return assessSwitch(input);
    case "sectionMove":
    case "sectionsArrange":
      return assessMove(input);
    case "sectionAdd":
      return assessAdd(input);
    case "sectionRemove":
      return assessRemove(input);
    case "sectionSource":
      return assessSource(input);
    case "sectionEdit":
      return assessEdit(input);
    case "blockEdit":
      return assessBlock(input);
  }
}

/* ---------------------------------------------------------------- *
 * Writing, filing, undoing
 * ---------------------------------------------------------------- */

/**
 * Do the action: assessed, written, filed with its way back. The answer is
 * the write's own (what the screen needs next) and the log's row — null
 * when the log could not file it (the page is written all the same).
 */
export async function startPageAction<K extends PageActionKind>(
  input: Input<K>,
  via: OperationVia = "app",
): Promise<{ row: VetrinaOperationRow | null; sectionKey: string | null; result: PageResult<K> }> {
  const assessment = await assessPage(input);
  const written = await assessment.write();
  // What the homepage's sections show may have moved: the catalog's marks follow at once.
  forgetHomepagePresence();
  const row = await file(input, assessment.label, written.record, via);
  return { row, sectionKey: written.sectionKey, result: written.result };
}

async function file(
  input: PageActionInput,
  label: OperationLabelParams,
  record: OperationPageRecord | null,
  via: OperationVia,
): Promise<VetrinaOperationRow | null> {
  // The screen's read is how it was checked, not part of what was asked.
  const { expected: _expected, ...asked } = input;
  try {
    // In demo mode the log of this demo shop starts no later than its first action.
    await logSince();
    return await repo.insertPageOperation({
      input: asked as PageActionInput,
      label: labelText(label, words("it")),
      labelParams: label,
      via,
      page: record,
    });
  } catch (e) {
    console.warn(`[vetrina-ops] homepage action written but not filed: ${messageOf(e)}`);
    return null;
  }
}

/**
 * "Annulla" for a homepage action: the way back written over the page as it
 * is now. The answer is the section's key after it (null when none).
 */
export async function undoPageAction(row: VetrinaOperationRow): Promise<{ row: VetrinaOperationRow; sectionKey: string | null }> {
  if (!row.page) throw new VetrinaError("invalid", words().page.notUndoable, 400);
  const sectionKey = await writeBack(row.page);
  forgetHomepagePresence();
  await repo.moveStatus(row.id, ["done"], { status: "undone", undoneAt: new Date(), undo: { restored: 0, kept: 0, failed: 0 }, error: null });
  return { row: (await repo.getOperation(row.id)) ?? row, sectionKey };
}

async function writeBack(record: OperationPageRecord): Promise<string | null> {
  const w = words();
  const home = await (await getVetrinaSource()).homepage();
  const rails = railsOf(home);
  /** The section the action left, as it left it: else someone changed it since, and the undo would undo them too. */
  const asLeft = (ref: SectionRef) => {
    const found = findSection(rails, ref);
    if (!found) throw new VetrinaError("stale", w.page.changedSince(ref.title), 409);
    return found;
  };
  switch (record.kind) {
    case "sectionSwitch": {
      const rail = asLeft(record.section);
      await switchSection({ key: rail.key, on: record.wasOn, expectedModifiedGmt: home.modifiedGmt, expectedAttrsHash: rail.attrsHash });
      return rail.key;
    }
    case "sectionMove":
    case "sectionsArrange": {
      const keys = orderBack(rails, record.order);
      if (!keys) throw new VetrinaError("stale", w.page.sectionsChanged, 409);
      await arrangeSections({ keys, expectedModifiedGmt: home.modifiedGmt });
      return null;
    }
    case "sectionAdd": {
      const rail = asLeft(record.section);
      await removeSection({ key: rail.key, expectedModifiedGmt: home.modifiedGmt });
      return null;
    }
    case "sectionRemove": {
      // Next to the same neighbour: by its fingerprint, or — edited since — by its name.
      const anchor = findSection(rails, record.neighbour) ?? rails.find((r) => r.key === record.neighbour.key);
      if (!anchor) throw new VetrinaError("stale", w.page.neighbourGone(record.title), 409);
      const result = await addSection({ ...record.restore, anchorKey: anchor.key, expectedModifiedGmt: home.modifiedGmt });
      return result.key;
    }
    case "sectionSource": {
      const rail = asLeft(record.section);
      const before = record.before;
      const result = await changeSectionSource({
        key: rail.key,
        expectedModifiedGmt: home.modifiedGmt,
        expectedAttrsHash: rail.attrsHash,
        source: before.source,
        fields: { title: before.title, buttonUrl: before.buttonUrl },
        restore: { pin: before.pin, exclude: before.exclude, fallback: before.fallback },
      });
      return result.key;
    }
    case "sectionEdit": {
      const rail = asLeft(record.section);
      const before = record.before;
      await publishRail({
        key: rail.key,
        expectedModifiedGmt: home.modifiedGmt,
        expectedAttrsHash: rail.attrsHash,
        pin: before.pin,
        exclude: before.exclude,
        fallback: before.fallback,
        fields: before.fields,
        limit: before.limit,
      });
      return rail.key;
    }
    case "blockEdit": {
      const block = home.blocks.find(
        (b) => b.kind === "static" && b.name === record.block.blockName && b.attrsHash === record.block.attrsHash,
      );
      if (!block) throw new VetrinaError("stale", w.page.changedSince(record.block.label), 409);
      await publishBlock({
        path: block.path,
        blockName: block.name,
        expectedModifiedGmt: home.modifiedGmt,
        expectedAttrsHash: record.block.attrsHash,
        fields: record.before,
      });
      return null;
    }
  }
}
