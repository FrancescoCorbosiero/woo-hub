import "server-only";
import type { OperationPreview, OperationVia } from "@/lib/vetrina/catalog-ops";
import {
  changesTo,
  childrenOf,
  descendantsOf,
  insertItems,
  layoutOf,
  moveItem,
  placeOf,
  removeItem,
  rowsOf,
  TOP,
  type Layout,
  type PlanError,
} from "@/lib/menus/plan";
import type { Menu, MenuItem, MenuTarget } from "@/lib/menus/types";
import type {
  MenuActionInput,
  MenuActionKind,
  MenuExpected,
  MenuItemSnapshot,
  MenuNewItem,
  MenuSpot,
  OperationMenuRecord,
} from "@/lib/vetrina/menu-ops";
import { decodeEntities } from "@/server/collections/index-rows";
import type { OperationLabelParams, VetrinaOperationRow } from "@/server/db/schema";
import { readCatalogTrees } from "@/server/vetrina/catalog";
import { VetrinaError } from "@/server/vetrina/source";
import {
  getMenuSource,
  itemIn,
  menuDigest,
  sameMenuName,
  targetKey,
  type MenuItemChange,
  type MenuSource,
  type NewMenuItem,
} from "@/server/wordpress/menus/source";
import { messageOf } from "./live";
import { labelText } from "./plan";
import * as repo from "./repo";
import { logSince } from "./standing";
import { words } from "./words";

/**
 * The site's navigation menus' actions — an item added, moved, taken away,
 * renamed — filed in the Vetrina's log with the same "Annulla"
 * (lib/vetrina/menu-ops.ts), over WordPress's REST API
 * (server/wordpress/menus).
 *
 * An action is assessed first — read the menu now, refuse what cannot be
 * done, say what it would do — then written, then filed with its way back.
 * WordPress keeps no version of a menu to write against, so an action
 * writes over the menu exactly as its assessment read it, moments before:
 * a screen's or a caller's own read rides along as `expected` (the menu's
 * fingerprint), and a proposal's preview carries it too, so a menu changed
 * since makes a new proposal rather than a surprise.
 *
 * Every write is the whole menu's new shape (lib/menus/plan.ts), numbered
 * as WordPress's own editor numbers it, and only the items whose place
 * changes are written — in WordPress's batches. A write WordPress takes only
 * part of is put back; if even that fails, the owner is told to look.
 *
 * "Annulla" finds the items again by id and neighbour, and refuses when
 * someone changed them since — the newer change stands, as on the homepage.
 *
 * A whole menu's actions — made (empty or as a copy), renamed, deleted, put
 * in a place of the theme — are one request each. A copy, and the undo of a
 * deletion, make the items again level by level, a parent before its items;
 * one WordPress refuses takes the half-made menu away again.
 */

/** What a write answers, for the screen that asked: the menu as it is after (null when it could not be read again). */
export interface MenuResult {
  menu: Menu | null;
  digest: string | null;
  /** The items an add made, in order. */
  created: number[];
}

/** An action read against the menu as it is: refused already, or ready to write. */
export interface MenuAssessment {
  label: OperationLabelParams;
  preview: OperationPreview;
  write: () => Promise<{ record: OperationMenuRecord; result: MenuResult }>;
}

/* ---------------------------------------------------------------- *
 * Reading the menu
 * ---------------------------------------------------------------- */

async function readMenu(source: MenuSource, id: number): Promise<Menu> {
  try {
    return await source.menu(id);
  } catch (e) {
    if (e instanceof VetrinaError && e.code === "not_found") throw new VetrinaError("not_found", words().menu.noMenu, 404);
    throw e;
  }
}

const titleOf = (menu: Menu, id: number) => itemIn(menu, id)?.title || "—";

/** Where an item stands in a layout, and the sibling it comes after — how "Annulla" finds its place again. */
function spotOf(layout: Layout, id: number): MenuSpot {
  const place = placeOf(layout, id)!;
  const siblings = layout.get(place.parent) ?? [];
  return { parent: place.parent, after: place.position > 1 ? siblings[place.position - 2] : null, position: place.position };
}

/** "in cima al menu", "sotto «Brand», al 2° posto": where an item is in a layout. */
function whereIn(menu: Menu, layout: Layout, id: number, names: Map<number, string> = new Map()): string {
  const w = words().menu;
  const place = placeOf(layout, id)!;
  const last = place.position === (layout.get(place.parent)?.length ?? 0);
  if (place.parent === TOP) return w.top(place.position, last);
  return w.under(names.get(place.parent) ?? titleOf(menu, place.parent), place.position, last);
}

function planRefusal(error: PlanError, title: string, max: number): VetrinaError {
  const w = words().menu;
  switch (error) {
    case "noItem":
      return new VetrinaError("not_found", w.noItem, 404);
    case "noParent":
      return new VetrinaError("invalid", w.noParent, 400);
    case "position":
      return new VetrinaError("invalid", w.position(max), 400);
    case "intoItself":
      return new VetrinaError("invalid", w.intoItself, 400);
    case "unchanged":
      return new VetrinaError("invalid", w.samePlace(title), 400);
  }
}

function itemOf(menu: Menu, id: number): MenuItem {
  const item = itemIn(menu, id);
  if (!item) throw new VetrinaError("not_found", words().menu.noItem, 404);
  return item;
}

/** The names of what new items lead to, checked: a category or brand of the shop, a published page of the site. */
async function targetsOf(source: MenuSource, items: readonly MenuNewItem[]): Promise<{ target: MenuTarget; name: string }[]> {
  const w = words().menu;
  const needsTerms = items.some((i) => i.kind === "category" || i.kind === "brand");
  const needsPages = items.some((i) => i.kind === "page");
  const [trees, pages] = await Promise.all([needsTerms ? readCatalogTrees() : null, needsPages ? source.pages() : null]);
  return items.map((item) => {
    switch (item.kind) {
      case "category":
      case "brand": {
        const term = trees![item.kind].terms.get(item.id);
        if (!term) throw new VetrinaError("invalid", item.kind === "category" ? w.noCategory(item.id) : w.noBrand(item.id), 400);
        return { target: { kind: item.kind, id: item.id }, name: decodeEntities(term.name) };
      }
      case "page": {
        const page = pages!.find((p) => p.id === item.id);
        if (!page) throw new VetrinaError("invalid", w.noPage(item.id), 400);
        return { target: { kind: "page", id: item.id }, name: page.title };
      }
      case "link":
        return { target: { kind: "link", url: item.url }, name: item.label };
    }
  });
}

/** The name an item shows with no label of its own: its category's, brand's or page's. */
async function ownNameOf(source: MenuSource, item: MenuItem): Promise<string> {
  const target = item.target;
  try {
    if (target.kind === "category" || target.kind === "brand") {
      const term = (await readCatalogTrees())[target.kind].terms.get(target.id);
      if (term) return decodeEntities(term.name);
    } else if (target.kind === "page") {
      const page = (await source.pages()).find((p) => p.id === target.id);
      if (page) return page.title;
    }
  } catch {
    // Not read: the item's own title names it.
  }
  return item.title;
}

function preview(kind: MenuActionKind, menu: Menu, lines: string[], warnings: string[], changes = 1): OperationPreview {
  return {
    kind,
    changes,
    untouched: [],
    sample: [],
    warnings,
    page: { lines: [...lines, words().menu.shownAt(menu.locations.map((l) => l.name))] },
    menu: { id: menu.id, digest: menuDigest(menu) },
  };
}

/* ---------------------------------------------------------------- *
 * Writing
 * ---------------------------------------------------------------- */

interface Writes {
  /** New items, by the placeholder ids the plan gave them. */
  creates: { placeholder: number; item: NewMenuItem }[];
  /** A parent given as a placeholder becomes the new item's id. */
  updates: MenuItemChange[];
  removes: number[];
}

/** Undo what a refused write did: the items it made deleted, the ones it moved put back. True when all of it went. */
async function rollback(source: MenuSource, menu: Menu, made: number[], moved: number[]): Promise<boolean> {
  try {
    const before = new Map(menu.items.map((i) => [i.id, i]));
    const outcomes = [
      ...(moved.length > 0
        ? await source.update(moved.map((id) => ({ id, parent: before.get(id)!.parent, order: before.get(id)!.order })))
        : []),
      ...(made.length > 0 ? await source.remove(made) : []),
    ];
    return outcomes.every((o) => o.ok);
  } catch {
    return false;
  }
}

/**
 * Write the plan: the new items, then the items that move, then the ones
 * that go. The first refusal stops it and puts back what was written before
 * it — and says when that could not be done (an item deleted is gone).
 */
async function apply(source: MenuSource, menu: Menu, writes: Writes): Promise<Map<number, MenuItem>> {
  const made = new Map<number, MenuItem>();
  const moved: number[] = [];
  let removed = 0;
  const refusal = await (async (): Promise<unknown> => {
    try {
      if (writes.creates.length > 0) {
        const outcomes = await source.create(menu.id, writes.creates.map((c) => c.item));
        outcomes.forEach((o, i) => {
          if (o.ok) made.set(writes.creates[i].placeholder, o.value);
        });
        const refused = outcomes.find((o) => !o.ok);
        if (refused && !refused.ok) return refused.error;
      }
      if (writes.updates.length > 0) {
        const changes = writes.updates.map((u) => (u.parent !== undefined && u.parent < 0 ? { ...u, parent: made.get(u.parent)!.id } : u));
        const outcomes = await source.update(changes);
        outcomes.forEach((o, i) => {
          if (o.ok) moved.push(changes[i].id);
        });
        const refused = outcomes.find((o) => !o.ok);
        if (refused && !refused.ok) return refused.error;
      }
      if (writes.removes.length > 0) {
        const outcomes = await source.remove(writes.removes);
        removed = outcomes.filter((o) => o.ok).length;
        const refused = outcomes.find((o) => !o.ok);
        if (refused && !refused.ok) return refused.error;
      }
      return null;
    } catch (e) {
      return e;
    }
  })();
  if (refusal == null) return made;
  console.warn(`[vetrina-menu] «${menu.name}»: WordPress refused a write: ${messageOf(refusal)}`);
  const putBack = (await rollback(source, menu, [...made.values()].map((i) => i.id), moved)) && removed === 0;
  throw new VetrinaError("failed", putBack ? words().menu.writeFailed : words().menu.halfWritten);
}

/** The menu as it is after a write, for the screen; null when it could not be read again. */
async function after(source: MenuSource, id: number): Promise<{ menu: Menu | null; digest: string | null }> {
  try {
    const menu = await source.menu(id);
    return { menu, digest: menuDigest(menu) };
  } catch {
    return { menu: null, digest: null };
  }
}

/* ---------------------------------------------------------------- *
 * The actions
 * ---------------------------------------------------------------- */

async function assessAdd(source: MenuSource, menu: Menu, layout: Layout, input: Extract<MenuActionInput, { kind: "menuItemAdd" }>): Promise<MenuAssessment> {
  const w = words().menu;
  const parent = input.place?.parent || TOP;
  const placeholders = input.items.map((_, i) => -(i + 1));
  const planned = insertItems(layout, parent, input.place?.position ?? null, placeholders);
  if (!planned.ok) throw planRefusal(planned.error, "", (layout.get(parent)?.length ?? 0) + 1);
  const targets = await targetsOf(source, input.items);
  const names = input.items.map((item, i) => item.label?.trim() || targets[i].name);
  const where = whereIn(menu, planned.layout, placeholders[0]);
  const present = new Map(menu.items.map((i) => [targetKey(i.target), i]));
  const warnings = targets.flatMap((t, i) => {
    const there = present.get(targetKey(t.target));
    return there ? [w.already(names[i], there.parent ? titleOf(menu, there.parent) : null)] : [];
  });
  return {
    label: { kind: "menuItemAdd", count: input.items.length, item: names[0], menu: menu.name },
    preview: preview("menuItemAdd", menu, [w.add(names, menu.name, where)], warnings, input.items.length),
    write: async () => {
      const changes = changesTo(menu.items, planned.layout);
      const made = await apply(source, menu, {
        creates: changes.creates.map((c) => {
          const at = -c.id - 1;
          return { placeholder: c.id, item: { target: targets[at].target, label: input.items[at].label?.trim() || null, parent: c.parent, order: c.order } };
        }),
        updates: changes.updates,
        removes: [],
      });
      const created = placeholders.map((p) => made.get(p)!);
      return {
        record: {
          kind: "menuItemAdd",
          menuId: menu.id,
          menu: menu.name,
          created: created.map((item) => ({ id: item.id, parent: item.parent, label: item.label, title: item.title })),
        },
        result: { ...(await after(source, menu.id)), created: created.map((i) => i.id) },
      };
    },
  };
}

function assessMove(source: MenuSource, menu: Menu, layout: Layout, input: Extract<MenuActionInput, { kind: "menuItemMove" }>): MenuAssessment {
  const w = words().menu;
  const item = itemOf(menu, input.itemId);
  const parent = input.place.parent || TOP;
  const planned = moveItem(layout, item.id, parent, input.place.position ?? null);
  const max = (layout.get(parent) ?? []).filter((id) => id !== item.id).length + 1;
  if (!planned.ok) throw planRefusal(planned.error, item.title, max);
  const below = descendantsOf(layout, item.id).length;
  const lines = [w.move(item.title, whereIn(menu, planned.layout, item.id)), ...(below > 0 ? [w.withItems(below)] : [])];
  return {
    label: { kind: "menuItemMove", count: 1, item: item.title, menu: menu.name },
    preview: preview("menuItemMove", menu, lines, item.invalid ? [w.invalid(item.title)] : []),
    write: async () => {
      const changes = changesTo(menu.items, planned.layout, new Set([item.id]));
      await apply(source, menu, { creates: [], updates: changes.updates, removes: [] });
      return {
        record: {
          kind: "menuItemMove",
          menuId: menu.id,
          menu: menu.name,
          item: { id: item.id, title: item.title },
          from: spotOf(layout, item.id),
          to: spotOf(planned.layout, item.id),
        },
        result: { ...(await after(source, menu.id)), created: [] },
      };
    },
  };
}

function assessRemove(source: MenuSource, menu: Menu, layout: Layout, input: Extract<MenuActionInput, { kind: "menuItemRemove" }>): MenuAssessment {
  const w = words().menu;
  const item = itemOf(menu, input.itemId);
  const removed = removeItem(layout, item.id);
  if (!removed.ok) throw planRefusal(removed.error, item.title, 1);
  const lifted = removed.lifted.map((id) => titleOf(menu, id));
  const lines = [w.remove(item.title, menu.name), ...(lifted.length > 0 ? [w.lifted(lifted)] : [])];
  return {
    label: { kind: "menuItemRemove", count: 1, item: item.title, menu: menu.name },
    preview: preview("menuItemRemove", menu, lines, []),
    write: async () => {
      const rest = menu.items.filter((i) => i.id !== item.id);
      // Its items first, to their new place; the item only once nothing points at it.
      const changes = changesTo(rest, removed.layout, new Set(removed.lifted));
      await apply(source, menu, { creates: [], updates: changes.updates, removes: [item.id] });
      return {
        record: {
          kind: "menuItemRemove",
          menuId: menu.id,
          menu: menu.name,
          item: { id: item.id, title: item.title, label: item.label, target: item.target, parent: placeOf(layout, item.id)!.parent, extra: item.extra },
          spot: spotOf(layout, item.id),
          lifted: removed.lifted,
        },
        result: { ...(await after(source, menu.id)), created: [] },
      };
    },
  };
}

async function assessRename(source: MenuSource, menu: Menu, input: Extract<MenuActionInput, { kind: "menuItemRename" }>): Promise<MenuAssessment> {
  const w = words().menu;
  const item = itemOf(menu, input.itemId);
  const label = input.label?.trim() || null;
  if (label == null && item.target.kind === "link") throw new VetrinaError("invalid", w.linkName, 400);
  const own = await ownNameOf(source, item);
  // WordPress stores a label equal to the target's name as none: the same as no label.
  const stored = label != null && label === own && item.target.kind !== "link" ? null : label;
  if (stored === item.label) throw new VetrinaError("invalid", w.sameName(item.title), 400);
  return {
    label: { kind: "menuItemRename", count: 1, item: item.title, menu: menu.name, renamed: stored },
    preview: preview("menuItemRename", menu, [stored == null ? w.ownName(item.title, own) : w.rename(item.title, stored)], item.invalid ? [w.invalid(item.title)] : []),
    write: async () => {
      await apply(source, menu, { creates: [], updates: [{ id: item.id, label: stored }], removes: [] });
      const read = await after(source, menu.id);
      const now = read.menu ? itemIn(read.menu, item.id) : undefined;
      return {
        record: {
          kind: "menuItemRename",
          menuId: menu.id,
          menu: menu.name,
          item: { id: item.id, title: item.title },
          before: item.label,
          after: now ? now.label : stored,
        },
        result: { ...read, created: [] },
      };
    },
  };
}

/** A menu action read against the menu as it is now: refused as its write would be, or previewed and ready to write. */
export async function assessMenu(input: MenuActionInput): Promise<MenuAssessment> {
  const source = await getMenuSource();
  switch (input.kind) {
    case "menuCreate":
      return assessCreateMenu(source, input);
    case "menuRename":
      return assessRenameMenu(source, input);
    case "menuLocation":
      return assessLocation(source, input);
    default:
      break;
  }
  const menu = await readMenu(source, input.menuId);
  if (input.expected && input.expected.digest !== menuDigest(menu)) throw new VetrinaError("stale", words().menu.stale, 409);
  if (input.kind === "menuDelete") return assessDeleteMenu(source, menu);
  const layout = layoutOf(menu.items);
  switch (input.kind) {
    case "menuItemAdd":
      return assessAdd(source, menu, layout, input);
    case "menuItemMove":
      return assessMove(source, menu, layout, input);
    case "menuItemRemove":
      return assessRemove(source, menu, layout, input);
    case "menuItemRename":
      return assessRename(source, menu, input);
  }
}

/* ---------------------------------------------------------------- *
 * Whole menus
 * ---------------------------------------------------------------- */

/**
 * A menu's items top to bottom, as a copy or an undo makes them again: a
 * parent before its items, each under its nearest parent kept (the items of
 * one left out go under its own parent). A link keeps a label: WordPress
 * makes none without.
 */
function snapshotOf(menu: Menu, keep: (item: MenuItem) => boolean = () => true): MenuItemSnapshot[] {
  const byId = new Map(menu.items.map((i) => [i.id, i]));
  const rows = rowsOf(layoutOf(menu.items));
  const parentOf = new Map(rows.map((r) => [r.id, r.parent]));
  const kept = new Set(rows.filter((r) => keep(byId.get(r.id)!)).map((r) => r.id));
  const keptParent = (id: number): number => {
    let parent = parentOf.get(id) ?? TOP;
    while (parent !== TOP && !kept.has(parent)) parent = parentOf.get(parent) ?? TOP;
    return parent;
  };
  return rows
    .filter((r) => kept.has(r.id))
    .map((r) => {
      const item = byId.get(r.id)!;
      const label = item.label ?? (item.target.kind === "link" ? item.title || item.target.url : null);
      return { id: item.id, title: item.title, label, target: item.target, parent: keptParent(r.id), extra: item.extra };
    });
}

/**
 * Items made in a menu from a snapshot, level by level — a parent made
 * before its items, so each goes under its parent's new id — numbered top
 * to bottom, as WordPress's editor numbers them. Throws WordPress's first
 * refusal, once the level it came in is written.
 */
async function build(source: MenuSource, menuId: number, rows: readonly MenuItemSnapshot[]): Promise<number> {
  const order = new Map(rows.map((r, i) => [r.id, i + 1]));
  const depth = new Map<number, number>();
  for (const r of rows) depth.set(r.id, r.parent !== TOP && depth.has(r.parent) ? depth.get(r.parent)! + 1 : 0);
  const made = new Map<number, number>();
  const deepest = rows.length > 0 ? Math.max(...depth.values()) : -1;
  for (let d = 0; d <= deepest; d++) {
    const level = rows.filter((r) => depth.get(r.id) === d);
    const outcomes = await source.create(
      menuId,
      level.map((r) => ({ target: r.target, label: r.label, parent: r.parent === TOP ? TOP : (made.get(r.parent) ?? TOP), order: order.get(r.id)!, extra: r.extra })),
    );
    outcomes.forEach((o, i) => {
      if (o.ok) made.set(level[i].id, o.value.id);
    });
    const refused = outcomes.find((o) => !o.ok);
    if (refused && !refused.ok) throw refused.error;
  }
  return made.size;
}

/** A menu made from a snapshot, or none: when an item is refused, the menu goes again (it takes its items with it). */
async function makeMenu(source: MenuSource, name: string, rows: readonly MenuItemSnapshot[]): Promise<{ id: number; items: number }> {
  const w = words().menu;
  const made = await source.createMenu(name).catch((e: unknown) => {
    // Another menu took the name between the check and the write.
    throw e instanceof VetrinaError && e.code === "invalid" ? new VetrinaError("invalid", w.nameTaken(name), 400) : e;
  });
  try {
    return { id: made.id, items: await build(source, made.id, rows) };
  } catch (e) {
    console.warn(`[vetrina-menu] «${name}»: WordPress refused an item: ${messageOf(e)}`);
    const gone = await source.deleteMenu(made.id).then(
      () => true,
      () => false,
    );
    throw new VetrinaError("failed", gone ? w.makeFailed : w.makeHalf);
  }
}

/** A whole menu's preview: what it does, in sentences; a copy's and a deletion's with the menu's fingerprint. */
function wholePreview(kind: MenuActionKind, lines: string[], warnings: string[], menu?: Menu): OperationPreview {
  return { kind, changes: 1, untouched: [], sample: [], warnings, page: { lines }, ...(menu ? { menu: { id: menu.id, digest: menuDigest(menu) } } : {}) };
}

async function assessCreateMenu(source: MenuSource, input: Extract<MenuActionInput, { kind: "menuCreate" }>): Promise<MenuAssessment> {
  const w = words().menu;
  const name = input.name.trim();
  const menus = await source.menus();
  if (menus.some((m) => sameMenuName(m.name, name))) throw new VetrinaError("invalid", w.nameTaken(name), 400);
  const from = input.copyOf ? await readMenu(source, input.copyOf) : null;
  // A copy leaves out what leads to something gone: the site does not show it anyway.
  const rows = from ? snapshotOf(from, (item) => !item.invalid) : [];
  const skipped = from ? from.items.length - rows.length : 0;
  return {
    label: { kind: "menuCreate", count: rows.length, menu: name, from: from?.name ?? null },
    preview: wholePreview(
      "menuCreate",
      [from ? w.createCopy(name, from.name, rows.length) : w.create(name), w.notShownYet],
      skipped > 0 ? [w.copySkipped(skipped)] : [],
      from ?? undefined,
    ),
    write: async () => {
      const made = await makeMenu(source, name, rows);
      const now = await after(source, made.id);
      return {
        record: { kind: "menuCreate", menuId: made.id, menu: now.menu?.name ?? name, from: from?.name ?? null, copied: made.items, digest: now.digest ?? "" },
        result: { ...now, created: [] },
      };
    },
  };
}

async function assessRenameMenu(source: MenuSource, input: Extract<MenuActionInput, { kind: "menuRename" }>): Promise<MenuAssessment> {
  const w = words().menu;
  const name = input.name.trim();
  const menus = await source.menus();
  const menu = menus.find((m) => m.id === input.menuId);
  if (!menu) throw new VetrinaError("not_found", w.noMenu, 404);
  if (menu.name === name) throw new VetrinaError("invalid", w.sameMenuName(name), 400);
  if (menus.some((m) => m.id !== menu.id && sameMenuName(m.name, name))) throw new VetrinaError("invalid", w.nameTaken(name), 400);
  return {
    label: { kind: "menuRename", count: 1, menu: name, from: menu.name },
    preview: wholePreview("menuRename", [w.renameMenu(menu.name, name), w.shownAt(menu.locations.map((l) => l.name))], []),
    write: async () => {
      await source.renameMenu(menu.id, name).catch((e: unknown) => {
        throw e instanceof VetrinaError && e.code === "invalid" ? new VetrinaError("invalid", w.nameTaken(name), 400) : e;
      });
      const now = await after(source, menu.id);
      const stored = now.menu?.name ?? name;
      return { record: { kind: "menuRename", menuId: menu.id, menu: stored, before: menu.name, after: stored }, result: { ...now, created: [] } };
    },
  };
}

function assessDeleteMenu(source: MenuSource, menu: Menu): MenuAssessment {
  const w = words().menu;
  // The site would be left without it there: another menu goes in its place first.
  if (menu.locations.length > 0) throw new VetrinaError("invalid", w.deleteShown(menu.name, menu.locations.map((l) => l.name)), 400);
  const items = snapshotOf(menu);
  return {
    label: { kind: "menuDelete", count: menu.items.length, menu: menu.name },
    preview: preview("menuDelete", menu, [w.deleteMenu(menu.name, menu.items.length)], []),
    write: async () => {
      await source.deleteMenu(menu.id);
      return { record: { kind: "menuDelete", menuId: menu.id, menu: menu.name, items }, result: { menu: null, digest: null, created: [] } };
    },
  };
}

async function assessLocation(source: MenuSource, input: Extract<MenuActionInput, { kind: "menuLocation" }>): Promise<MenuAssessment> {
  const w = words().menu;
  const [places, menus] = await Promise.all([source.places(), input.menuId != null ? source.menus() : Promise.resolve([])]);
  const place = places.find((p) => p.slug === input.location);
  if (!place) throw new VetrinaError("invalid", w.noPlace(input.location), 400);
  const menu = input.menuId != null ? menus.find((m) => m.id === input.menuId) : null;
  if (input.menuId != null && !menu) throw new VetrinaError("not_found", w.noMenu, 404);
  const before = place.menu;
  if ((before?.id ?? null) === (menu?.id ?? null)) {
    throw new VetrinaError("invalid", menu ? w.alreadyShown(menu.name, place.name) : w.alreadyEmpty(place.name), 400);
  }
  return {
    label: { kind: "menuLocation", count: 1, menu: menu?.name, place: place.name },
    preview: wholePreview(
      "menuLocation",
      [menu ? w.placeShows(place.name, menu.name, before?.name ?? null) : w.placeEmptied(place.name, before!.name)],
      menu && menu.count === 0 ? [w.emptyShown(menu.name, place.name)] : [],
    ),
    write: async () => {
      await source.setPlace(place.slug, menu?.id ?? null).catch((e: unknown) => {
        if (!(e instanceof VetrinaError && e.code === "failed")) throw e;
        // WordPress's detail for the log; the owner reads that the place may not have changed.
        console.warn(`[vetrina-menu] place ${place.slug}: ${messageOf(e)}`);
        throw new VetrinaError("failed", w.placeNotChanged);
      });
      return {
        record: { kind: "menuLocation", menuId: menu?.id ?? 0, menu: menu?.name ?? null, location: { slug: place.slug, name: place.name }, before },
        result: menu ? { ...(await after(source, menu.id)), created: [] } : { menu: null, digest: null, created: [] },
      };
    },
  };
}

/* ---------------------------------------------------------------- *
 * Doing it, and filing it
 * ---------------------------------------------------------------- */

async function file(
  input: MenuActionInput,
  label: OperationLabelParams,
  record: OperationMenuRecord,
  via: OperationVia,
  actor: string | null,
): Promise<VetrinaOperationRow | null> {
  // The screen's read is how it was checked, not part of what was asked.
  const { expected: _expected, ...asked } = input as MenuActionInput & { expected?: MenuExpected };
  try {
    // In demo mode the log of this demo shop starts no later than its first action.
    await logSince();
    return await repo.insertMenuOperation({ input: asked as MenuActionInput, label: labelText(label, words("it")), labelParams: label, via, actor, menu: record });
  } catch (e) {
    console.warn(`[vetrina-ops] menu action written but not filed: ${messageOf(e)}`);
    return null;
  }
}

/**
 * Do the action: assessed, written, filed with its way back. The answer is
 * the menu as it is after, and the log's row — null when the log could not
 * file it (the menu is written all the same).
 */
export async function startMenuAction(
  input: MenuActionInput,
  via: OperationVia = "app",
  actor: string | null = null,
): Promise<{ row: VetrinaOperationRow | null; result: MenuResult }> {
  const assessment = await assessMenu(input);
  const written = await assessment.write();
  const row = await file(input, assessment.label, written.record, via, actor);
  return { row, result: written.result };
}

/* ---------------------------------------------------------------- *
 * "Annulla"
 * ---------------------------------------------------------------- */

/** Back to where an item stood: after the same sibling when it is still there, else at the same place (or the last). */
function positionFor(layout: Layout, spot: MenuSpot, id: number | null): number {
  const siblings = (layout.get(spot.parent) ?? []).filter((s) => s !== id);
  if (spot.after == null) return 1;
  const at = siblings.indexOf(spot.after);
  return at >= 0 ? at + 2 : Math.min(spot.position, siblings.length + 1);
}

const changedSince = (title: string) => new VetrinaError("stale", words().menu.changedSince(title), 409);

/** Its way back, written over the menu as it is: refused when what the action changed was changed again since. */
export async function undoMenuAction(row: VetrinaOperationRow, undoneBy: string | null = null): Promise<{ row: VetrinaOperationRow }> {
  const record = row.menu;
  if (!record) throw new VetrinaError("invalid", words().error.nothingToUndo, 400);
  const source = await getMenuSource();
  const restored = isWholeMenuRecord(record) ? await undoWholeMenu(source, record) : await undoItems(source, record);
  await repo.moveStatus(row.id, ["done"], { status: "undone", undoneAt: new Date(), undoneBy, undo: { restored, kept: 0, failed: 0 }, error: null });
  return { row: (await repo.getOperation(row.id)) ?? row };
}

type WholeMenuRecord = Extract<OperationMenuRecord, { kind: "menuCreate" | "menuRename" | "menuDelete" | "menuLocation" }>;
type ItemRecord = Exclude<OperationMenuRecord, WholeMenuRecord>;

const isWholeMenuRecord = (record: OperationMenuRecord): record is WholeMenuRecord =>
  record.kind === "menuCreate" || record.kind === "menuRename" || record.kind === "menuDelete" || record.kind === "menuLocation";

/** A whole menu's way back: what it put back (a deleted menu's items; else 1, or 0 when there was nothing left to undo). */
async function undoWholeMenu(source: MenuSource, record: WholeMenuRecord): Promise<number> {
  const w = words().menu;
  switch (record.kind) {
    case "menuCreate": {
      const menu = await source.menu(record.menuId).catch((e: unknown) => {
        if (e instanceof VetrinaError && e.code === "not_found") return null;
        throw e;
      });
      // Deleted since: what its undo would do is done.
      if (!menu) return 0;
      if (menu.locations.length > 0) throw new VetrinaError("stale", w.shownNow(menu.name, menu.locations.map((l) => l.name)), 409);
      if (menu.name !== record.menu || menuDigest(menu) !== record.digest) throw new VetrinaError("stale", w.menuChangedSince(menu.name), 409);
      await source.deleteMenu(menu.id);
      return 1;
    }
    case "menuRename": {
      const menus = await source.menus();
      const menu = menus.find((m) => m.id === record.menuId);
      if (!menu) throw new VetrinaError("stale", w.menuGone(record.menu), 409);
      if (menu.name !== record.after) throw new VetrinaError("stale", w.menuChangedSince(menu.name), 409);
      if (menus.some((m) => m.id !== menu.id && sameMenuName(m.name, record.before))) throw new VetrinaError("stale", w.nameTaken(record.before), 409);
      await source.renameMenu(menu.id, record.before);
      return 1;
    }
    case "menuDelete": {
      const menus = await source.menus();
      if (menus.some((m) => sameMenuName(m.name, record.menu))) throw new VetrinaError("stale", w.nameTaken(record.menu), 409);
      // Made again, with its items as they were (new ids: WordPress gives no old ones back), in no place, as it was.
      return (await makeMenu(source, record.menu, record.items)).items;
    }
    case "menuLocation": {
      const place = (await source.places()).find((p) => p.slug === record.location.slug);
      if (!place) throw new VetrinaError("stale", w.noPlace(record.location.name), 409);
      if ((place.menu?.id ?? 0) !== record.menuId) throw new VetrinaError("stale", w.placeChanged(record.location.name), 409);
      if (record.before && !(await source.menus()).some((m) => m.id === record.before!.id)) {
        throw new VetrinaError("stale", w.menuGone(record.before.name), 409);
      }
      await source.setPlace(place.slug, record.before?.id ?? null);
      return 1;
    }
  }
}

/** An item action's way back, written over the menu as it is. */
async function undoItems(source: MenuSource, record: ItemRecord): Promise<number> {
  const w = words().menu;
  const menu = await readMenu(source, record.menuId);
  const layout = layoutOf(menu.items);
  let restored = 1;

  switch (record.kind) {
    case "menuItemAdd": {
      // What is gone already needs no undo; what someone renamed, moved or put items under since stays.
      const still = record.created.filter((c) => itemIn(menu, c.id));
      for (const c of still) {
        const item = itemIn(menu, c.id)!;
        if (placeOf(layout, c.id)!.parent !== c.parent || item.label !== c.label) throw changedSince(c.title);
        if (childrenOf(layout, c.id).length > 0) throw new VetrinaError("stale", w.gotChildren(c.title), 409);
      }
      // Taking items away leaves gaps in menu_order, which WordPress orders by all the same.
      await apply(source, menu, { creates: [], updates: [], removes: still.map((c) => c.id) });
      restored = still.length;
      break;
    }
    case "menuItemMove": {
      const item = itemIn(menu, record.item.id);
      if (!item || placeOf(layout, item.id)!.parent !== record.to.parent) throw changedSince(record.item.title);
      if (record.from.parent !== TOP && !itemIn(menu, record.from.parent)) throw new VetrinaError("stale", w.parentGone(record.item.title), 409);
      const planned = moveItem(layout, item.id, record.from.parent, positionFor(layout, record.from, item.id));
      // Already back where it was (moved there by hand): nothing to write.
      if (planned.ok) {
        await apply(source, menu, { creates: [], updates: changesTo(menu.items, planned.layout, new Set([item.id])).updates, removes: [] });
      } else if (planned.error !== "unchanged") {
        throw changedSince(record.item.title);
      }
      break;
    }
    case "menuItemRemove": {
      const parent = record.spot.parent;
      if (parent !== TOP && !itemIn(menu, parent)) throw new VetrinaError("stale", w.parentGone(record.item.title), 409);
      const planned = insertItems(layout, parent, positionFor(layout, record.spot, null), [-1]);
      if (!planned.ok) throw changedSince(record.item.title);
      // Its items go back under it, those still where the removal lifted them.
      let next = planned.layout;
      const back = record.lifted.filter((id) => placeOf(next, id)?.parent === parent);
      for (const id of back) {
        const moved = moveItem(next, id, -1, null);
        if (moved.ok) next = moved.layout;
      }
      const changes = changesTo(menu.items, next, new Set(back));
      const slot = changes.creates[0];
      await apply(source, menu, {
        creates: [{ placeholder: -1, item: { target: record.item.target, label: record.item.label, parent: slot.parent, order: slot.order, extra: record.item.extra } }],
        updates: changes.updates,
        removes: [],
      });
      restored = 1 + back.length;
      break;
    }
    case "menuItemRename": {
      const item = itemIn(menu, record.item.id);
      if (!item || item.label !== record.after) throw changedSince(record.item.title);
      await apply(source, menu, { creates: [], updates: [{ id: item.id, label: record.before }], removes: [] });
      break;
    }
  }
  return restored;
}
