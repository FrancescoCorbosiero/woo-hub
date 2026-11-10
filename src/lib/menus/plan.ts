import type { MenuItem } from "./types";

/**
 * A menu's shape — which item is under which, in what order — and how an
 * action changes it, worked out before anything is written. Pure: the server
 * plans its writes with it, the screens draw the menu with it.
 *
 * WordPress numbers a menu's items 1…n top to bottom, a parent before its
 * children (menu_order), and never renumbers them itself: an item saved at
 * "1" shares that number with the item already there. So every change is
 * planned as the whole menu's new shape, numbered the way WordPress's own
 * editor numbers it, and only the items whose number or parent changed are
 * written (changesTo).
 */

/** Each parent's items, in order; TOP (0) is the menu's top level. */
export type Layout = Map<number, number[]>;

export const TOP = 0;

/** WordPress's order: menu_order, then id (the older first). */
export function byMenuOrder(a: Pick<MenuItem, "order" | "id">, b: Pick<MenuItem, "order" | "id">): number {
  return a.order - b.order || a.id - b.id;
}

/**
 * The parent an item counts under: its own, when that item is in the menu;
 * else the top level — where WordPress's walker shows an item whose parent
 * is gone (on a menu shown at full depth; a shallower one leaves it off).
 */
export function effectiveParent(item: Pick<MenuItem, "id" | "parent">, ids: ReadonlySet<number>): number {
  return item.parent !== item.id && ids.has(item.parent) ? item.parent : TOP;
}

function clone(layout: Layout): Layout {
  return new Map([...layout].map(([parent, children]) => [parent, [...children]]));
}

/** One row of the menu as it reads top to bottom. */
export interface Row {
  id: number;
  parent: number;
  /** 0 at the top level. */
  depth: number;
  /** 1-based place among its siblings. */
  position: number;
  /** 1-based place across the whole menu: the menu_order WordPress's editor would give it. */
  order: number;
}

/** The menu top to bottom, a parent before its children. */
export function rowsOf(layout: Layout): Row[] {
  const out: Row[] = [];
  const seen = new Set<number>();
  const visit = (parent: number, depth: number) => {
    (layout.get(parent) ?? []).forEach((id, i) => {
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ id, parent, depth, position: i + 1, order: out.length + 1 });
      visit(id, depth + 1);
    });
  };
  visit(TOP, 0);
  return out;
}

/**
 * The menu's shape, from its items as WordPress has them. An item whose
 * parent is gone, and items in a loop of parents (A under B under A, which
 * no top reaches), stand at the top level — so every item has one place.
 */
export function layoutOf(items: readonly MenuItem[]): Layout {
  const ids = new Set(items.map((i) => i.id));
  const sorted = [...items].sort(byMenuOrder);
  const layout: Layout = new Map([[TOP, []]]);
  const parentOf = new Map<number, number>();
  for (const item of sorted) {
    const parent = effectiveParent(item, ids);
    parentOf.set(item.id, parent);
    const siblings = layout.get(parent) ?? [];
    siblings.push(item.id);
    layout.set(parent, siblings);
  }
  for (;;) {
    const reached = new Set(rowsOf(layout).map((r) => r.id));
    const lost = sorted.find((i) => !reached.has(i.id));
    if (!lost) return layout;
    const parent = parentOf.get(lost.id)!;
    layout.set(parent, (layout.get(parent) ?? []).filter((id) => id !== lost.id));
    layout.get(TOP)!.push(lost.id);
    parentOf.set(lost.id, TOP);
  }
}

/** Where an item stands: its parent and its 1-based place among its siblings. */
export function placeOf(layout: Layout, id: number): { parent: number; position: number } | null {
  for (const [parent, children] of layout) {
    const at = children.indexOf(id);
    if (at >= 0) return { parent, position: at + 1 };
  }
  return null;
}

/** The item's children, in order. */
export function childrenOf(layout: Layout, id: number): number[] {
  return [...(layout.get(id) ?? [])];
}

/** Every item below `id`, at any depth, top to bottom. */
export function descendantsOf(layout: Layout, id: number): number[] {
  const out: number[] = [];
  const visit = (parent: number) => {
    for (const child of layout.get(parent) ?? []) {
      if (out.includes(child) || child === id) continue;
      out.push(child);
      visit(child);
    }
  };
  visit(id);
  return out;
}

export type PlanError =
  /** No such item in the menu. */
  | "noItem"
  /** No such parent item in the menu. */
  | "noParent"
  /** Past the end of the parent's items. */
  | "position"
  /** Under itself, or under one of its own items. */
  | "intoItself"
  /** Already there. */
  | "unchanged";

export type Planned = { ok: true; layout: Layout } | { ok: false; error: PlanError };

const inMenu = (layout: Layout, id: number) => placeOf(layout, id) != null;

/**
 * New items, in order, under `parent` (TOP for the top level), from its
 * 1-based `position` — null: after its last item. New items go by
 * placeholder ids (negative), until WordPress gives them theirs.
 */
export function insertItems(layout: Layout, parent: number, position: number | null, ids: readonly number[]): Planned {
  if (parent !== TOP && !inMenu(layout, parent)) return { ok: false, error: "noParent" };
  const next = clone(layout);
  const siblings = next.get(parent) ?? [];
  const at = position == null ? siblings.length : position - 1;
  if (at < 0 || at > siblings.length) return { ok: false, error: "position" };
  siblings.splice(at, 0, ...ids);
  next.set(parent, siblings);
  return { ok: true, layout: next };
}

/**
 * An item, with everything under it, to a place: under `parent`, at its
 * 1-based `position` among the items there once it has left its own place
 * (so "3" puts it third) — null: after the last.
 */
export function moveItem(layout: Layout, id: number, parent: number, position: number | null): Planned {
  const from = placeOf(layout, id);
  if (!from) return { ok: false, error: "noItem" };
  if (parent !== TOP && !inMenu(layout, parent)) return { ok: false, error: "noParent" };
  if (parent === id || descendantsOf(layout, id).includes(parent)) return { ok: false, error: "intoItself" };
  const next = clone(layout);
  next.get(from.parent)!.splice(from.position - 1, 1);
  const siblings = next.get(parent) ?? [];
  const at = position == null ? siblings.length : position - 1;
  if (at < 0 || at > siblings.length) return { ok: false, error: "position" };
  if (parent === from.parent && at === from.position - 1) return { ok: false, error: "unchanged" };
  siblings.splice(at, 0, id);
  next.set(parent, siblings);
  return { ok: true, layout: next };
}

/**
 * An item taken out of the menu, its own items lifted into its place, in
 * their order — what WordPress's menu editor does when an item with
 * sub-items is removed. WordPress itself does nothing for them: an item
 * deleted over the API leaves its children pointing at nothing.
 */
export function removeItem(layout: Layout, id: number): { ok: true; layout: Layout; lifted: number[] } | { ok: false; error: PlanError } {
  const from = placeOf(layout, id);
  if (!from) return { ok: false, error: "noItem" };
  const next = clone(layout);
  const lifted = next.get(id) ?? [];
  next.delete(id);
  next.get(from.parent)!.splice(from.position - 1, 1, ...lifted);
  return { ok: true, layout: next, lifted: [...lifted] };
}

/** An item's place, as an action writes it. */
export interface Slot {
  parent: number;
  order: number;
}

/** Every item's place in a layout: its parent and the menu_order WordPress's editor would give it. */
export function slotsOf(layout: Layout): Map<number, Slot> {
  return new Map(rowsOf(layout).map((r) => [r.id, { parent: r.parent, order: r.order }]));
}

export interface LayoutChanges {
  /** Items already in the menu whose parent or menu_order change: only what changes. */
  updates: { id: number; parent?: number; order?: number }[];
  /** New items (by placeholder id) and their places. */
  creates: ({ id: number } & Slot)[];
}

/**
 * What writing `layout` over the menu as it is takes. An item whose parent is
 * gone keeps it (the top level is only where it shows) unless `moved` names
 * it: the plan touches nobody's parent it did not mean to.
 */
export function changesTo(items: readonly MenuItem[], layout: Layout, moved: ReadonlySet<number> = new Set()): LayoutChanges {
  const ids = new Set(items.map((i) => i.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  const changes: LayoutChanges = { updates: [], creates: [] };
  for (const [id, slot] of slotsOf(layout)) {
    const item = byId.get(id);
    if (!item) {
      changes.creates.push({ id, ...slot });
      continue;
    }
    const update: LayoutChanges["updates"][number] = { id };
    const unmoved = slot.parent === effectiveParent(item, ids) && !moved.has(id);
    if (!unmoved && slot.parent !== item.parent) update.parent = slot.parent;
    if (slot.order !== item.order) update.order = slot.order;
    if (update.parent !== undefined || update.order !== undefined) changes.updates.push(update);
  }
  return changes;
}

/** Same items, same places: nothing to write. */
export function sameLayout(a: Layout, b: Layout): boolean {
  const ra = rowsOf(a);
  const rb = rowsOf(b);
  return ra.length === rb.length && ra.every((r, i) => r.id === rb[i].id && r.parent === rb[i].parent);
}
