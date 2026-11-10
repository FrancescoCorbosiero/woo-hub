import { describe, expect, it } from "vitest";
import { movesOf } from "./moves";
import { layoutOf, moveItem, rowsOf, TOP } from "./plan";
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

/** Home, Brand (Nike, Adidas), Saldi. */
const layout = layoutOf([item(1, 0, 1), item(2, 0, 2), item(21, 2, 3), item(22, 2, 4), item(3, 0, 5)]);
const shape = (l: typeof layout) => rowsOf(l).map((r) => `${"  ".repeat(r.depth)}${r.id}`);

describe("an item's one-tap moves", () => {
  it("go up and down among its siblings, under the one above, out of its parent", () => {
    expect(movesOf(layout, 1)).toEqual({ up: null, down: { parent: TOP, position: 2 }, indent: null, outdent: null });
    expect(movesOf(layout, 3)).toEqual({ up: { parent: TOP, position: 2 }, down: null, indent: { parent: 2, position: null }, outdent: null });
    expect(movesOf(layout, 22)).toEqual({ up: { parent: 2, position: 1 }, down: null, indent: { parent: 21, position: null }, outdent: { parent: TOP, position: 3 } });
  });

  it("each lands where it says once planned", () => {
    const go = (id: number, place: { parent: number; position: number | null } | null) => {
      const moved = moveItem(layout, id, place!.parent, place!.position);
      if (!moved.ok) throw new Error(moved.error);
      return shape(moved.layout);
    };
    expect(go(1, movesOf(layout, 1).down)).toEqual(["2", "  21", "  22", "1", "3"]);
    expect(go(3, movesOf(layout, 3).indent)).toEqual(["1", "2", "  21", "  22", "  3"]);
    expect(go(22, movesOf(layout, 22).outdent)).toEqual(["1", "2", "  21", "22", "3"]);
    expect(go(22, movesOf(layout, 22).up)).toEqual(["1", "2", "  22", "  21", "3"]);
  });

  it("offers nothing for an item the menu lacks", () => {
    expect(movesOf(layout, 999)).toEqual({ up: null, down: null, indent: null, outdent: null });
  });
});
