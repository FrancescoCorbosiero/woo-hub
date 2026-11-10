import { describe, expect, it } from "vitest";
import {
  changesTo,
  descendantsOf,
  insertItems,
  layoutOf,
  moveItem,
  placeOf,
  removeItem,
  rowsOf,
  sameLayout,
  TOP,
  type Layout,
} from "./plan";
import type { MenuItem } from "./types";

const item = (id: number, parent: number, order: number): MenuItem => ({
  id,
  parent,
  order,
  title: `#${id}`,
  label: null,
  target: { kind: "link", url: `/${id}` },
  url: `/${id}`,
  invalid: false,
  extra: { newTab: false, classes: [], attrTitle: "", description: "", xfn: [] },
});

/** The menu as rows: "id@parent" top to bottom, children indented by their depth. */
const shape = (layout: Layout) => rowsOf(layout).map((r) => `${"  ".repeat(r.depth)}${r.id}`);

/** Home, Shop (Sneakers, Saldi (Outlet)), Brand (Nike), Contatti — numbered as WordPress's editor numbers them. */
const MENU = [
  item(10, 0, 1),
  item(20, 0, 2),
  item(21, 20, 3),
  item(22, 20, 4),
  item(23, 22, 5),
  item(30, 0, 6),
  item(31, 30, 7),
  item(40, 0, 8),
];

describe("a menu's shape", () => {
  it("reads top to bottom, a parent before its children, numbered 1…n", () => {
    const rows = rowsOf(layoutOf(MENU));
    expect(rows.map((r) => [r.id, r.parent, r.depth, r.position, r.order])).toEqual([
      [10, 0, 0, 1, 1],
      [20, 0, 0, 2, 2],
      [21, 20, 1, 1, 3],
      [22, 20, 1, 2, 4],
      [23, 22, 2, 1, 5],
      [30, 0, 0, 3, 6],
      [31, 30, 1, 1, 7],
      [40, 0, 0, 4, 8],
    ]);
  });

  it("orders by menu_order, then by id when WordPress gave two items the same number", () => {
    // An item added over the API without a number gets 1, beside the item already there.
    const rows = rowsOf(layoutOf([item(5, 0, 1), item(3, 0, 1), item(9, 0, 2)]));
    expect(rows.map((r) => r.id)).toEqual([3, 5, 9]);
  });

  it("shows an item whose parent is gone at the top level, as WordPress's walker does", () => {
    expect(shape(layoutOf([item(1, 0, 1), item(2, 99, 2), item(3, 2, 3)]))).toEqual(["1", "2", "  3"]);
  });

  it("gives items in a loop of parents a place at the top, rather than losing them", () => {
    const layout = layoutOf([item(1, 0, 1), item(2, 3, 2), item(3, 2, 3)]);
    expect(rowsOf(layout).map((r) => r.id).sort()).toEqual([1, 2, 3]);
    expect(placeOf(layout, 2)?.parent).toBe(TOP);
  });

  it("knows where each item stands and what is under it", () => {
    const layout = layoutOf(MENU);
    expect(placeOf(layout, 22)).toEqual({ parent: 20, position: 2 });
    expect(placeOf(layout, 40)).toEqual({ parent: TOP, position: 4 });
    expect(placeOf(layout, 999)).toBeNull();
    expect(descendantsOf(layout, 20)).toEqual([21, 22, 23]);
    expect(descendantsOf(layout, 40)).toEqual([]);
  });
});

describe("planning a change", () => {
  it("adds new items, in order, at a place among a parent's items — or after the last", () => {
    const layout = layoutOf(MENU);
    const atTop = insertItems(layout, TOP, 2, [-1, -2]);
    expect(atTop.ok && shape(atTop.layout).filter((s) => !s.startsWith(" "))).toEqual(["10", "-1", "-2", "20", "30", "40"]);
    const last = insertItems(layout, 30, null, [-1]);
    expect(last.ok && shape(last.layout)).toEqual(["10", "20", "  21", "  22", "    23", "30", "  31", "  -1", "40"]);
    // One item under Brand: its places are 1 and 2 (after it).
    expect(insertItems(layout, 30, 2, [-1])).toMatchObject({ ok: true });
  });

  it("refuses to add under an item the menu lacks, or past the end", () => {
    const layout = layoutOf(MENU);
    expect(insertItems(layout, 999, null, [-1])).toEqual({ ok: false, error: "noParent" });
    expect(insertItems(layout, 30, 3, [-1])).toEqual({ ok: false, error: "position" });
    expect(insertItems(layout, TOP, 0, [-1])).toEqual({ ok: false, error: "position" });
  });

  it("moves an item with everything under it; a place counts the items there without it", () => {
    const layout = layoutOf(MENU);
    // Saldi (with Outlet) under Brand, first.
    const under = moveItem(layout, 22, 30, 1);
    expect(under.ok && shape(under.layout)).toEqual(["10", "20", "  21", "30", "  22", "    23", "  31", "40"]);
    // Home third at the top: after Shop and Brand.
    const third = moveItem(layout, 10, TOP, 3);
    expect(third.ok && shape(third.layout).filter((s) => !s.startsWith(" "))).toEqual(["20", "30", "10", "40"]);
    // To the end of the top level.
    const end = moveItem(layout, 20, TOP, null);
    expect(end.ok && shape(end.layout).filter((s) => !s.startsWith(" "))).toEqual(["10", "30", "40", "20"]);
  });

  it("refuses a move under itself, into its own items, to where it already is, or nowhere", () => {
    const layout = layoutOf(MENU);
    expect(moveItem(layout, 20, 20, 1)).toEqual({ ok: false, error: "intoItself" });
    expect(moveItem(layout, 20, 23, 1)).toEqual({ ok: false, error: "intoItself" });
    expect(moveItem(layout, 22, 20, 2)).toEqual({ ok: false, error: "unchanged" });
    expect(moveItem(layout, 40, TOP, null)).toEqual({ ok: false, error: "unchanged" });
    expect(moveItem(layout, 999, TOP, 1)).toEqual({ ok: false, error: "noItem" });
    expect(moveItem(layout, 10, 999, 1)).toEqual({ ok: false, error: "noParent" });
    expect(moveItem(layout, 10, 30, 3)).toEqual({ ok: false, error: "position" });
  });

  it("takes an item out with its own items lifted into its place, in their order", () => {
    const removed = removeItem(layoutOf(MENU), 20);
    expect(removed.ok && removed.lifted).toEqual([21, 22]);
    expect(removed.ok && shape(removed.layout)).toEqual(["10", "21", "22", "  23", "30", "  31", "40"]);
    expect(removeItem(layoutOf(MENU), 999)).toEqual({ ok: false, error: "noItem" });
  });

  it("writes only the items whose parent or number changed", () => {
    const moved = moveItem(layoutOf(MENU), 40, TOP, 1);
    if (!moved.ok) throw new Error(moved.error);
    // Contatti first: every item above it moves down one.
    expect(changesTo(MENU, moved.layout).updates).toEqual([
      { id: 40, order: 1 },
      { id: 10, order: 2 },
      { id: 20, order: 3 },
      { id: 21, order: 4 },
      { id: 22, order: 5 },
      { id: 23, order: 6 },
      { id: 30, order: 7 },
      { id: 31, order: 8 },
    ]);
    // A swap at the bottom writes the two items only.
    const swap = moveItem(layoutOf(MENU), 31, TOP, 4);
    if (!swap.ok) throw new Error(swap.error);
    expect(changesTo(MENU, swap.layout).updates).toEqual([{ id: 31, parent: 0 }]);
  });

  it("numbers new items and only the items after them", () => {
    const added = insertItems(layoutOf(MENU), 30, null, [-1]);
    if (!added.ok) throw new Error(added.error);
    const changes = changesTo(MENU, added.layout);
    expect(changes.creates).toEqual([{ id: -1, parent: 30, order: 8 }]);
    expect(changes.updates).toEqual([{ id: 40, order: 9 }]);
  });

  it("keeps a lost parent where WordPress has it, unless the item itself is moved", () => {
    const orphaned = [item(1, 0, 1), item(2, 99, 2), item(3, 0, 3)];
    const layout = layoutOf(orphaned);
    const swapped = moveItem(layout, 3, TOP, 1);
    if (!swapped.ok) throw new Error(swapped.error);
    expect(changesTo(orphaned, swapped.layout).updates).toEqual([
      { id: 3, order: 1 },
      { id: 1, order: 2 },
      { id: 2, order: 3 },
    ]);
    const fixed = moveItem(layout, 2, TOP, 1);
    if (!fixed.ok) throw new Error(fixed.error);
    expect(changesTo(orphaned, fixed.layout, new Set([2])).updates).toContainEqual({ id: 2, parent: 0, order: 1 });
  });

  it("tells two layouts with the same items in the same places apart from changed ones", () => {
    const layout = layoutOf(MENU);
    expect(sameLayout(layout, layoutOf([...MENU].reverse()))).toBe(true);
    const moved = moveItem(layout, 10, TOP, 2);
    expect(moved.ok && sameLayout(layout, moved.layout)).toBe(false);
  });
});
