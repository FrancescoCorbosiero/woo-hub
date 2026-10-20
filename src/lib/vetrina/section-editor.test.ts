import { describe, expect, it } from "vitest";
import type { EditorRow } from "./order";
import {
  draftOf,
  hiddenReasonOf,
  joinersOf,
  layoutRows,
  rowIndexOfPosition,
  sectionFill,
  visibleWithJoiners,
  withPicked,
  type AddedProduct,
} from "./section-editor";
import type { SectionDraft } from "./types";

const draft = (over: Partial<SectionDraft> = {}): SectionDraft => ({
  pin: [],
  exclude: [],
  fallback: "menu_order",
  fields: {},
  limit: 3,
  ...over,
});

const listed: AddedProduct["product"] = { status: "publish", visibility: "visible", stockStatus: "instock" };

describe("layoutRows — positions and the fold", () => {
  const kinds: Record<number, EditorRow["kind"]> = { 1: "pinned", 2: "ghost", 3: "auto", 4: "auto", 5: "auto" };
  const kindOf = (id: number) => kinds[id];

  it("numbers what the site shows, ghosts taking no place", () => {
    const { positions, visibleCount } = layoutRows([1, 2, 3, 4, 5], kindOf, 3);
    expect([...positions]).toEqual([
      [1, 1],
      [3, 2],
      [4, 3],
      [5, 4],
    ]);
    expect(visibleCount).toBe(4);
  });

  it("puts the fold after the last product the homepage shows", () => {
    expect(layoutRows([1, 2, 3, 4, 5], kindOf, 3).foldAfter).toBe(4);
    expect(layoutRows([1, 2, 3, 4, 5], kindOf, 1).foldAfter).toBe(1);
  });

  it("has no fold when the section shows them all", () => {
    expect(layoutRows([1, 2, 3], kindOf, 3).foldAfter).toBeNull();
  });
});

describe("rowIndexOfPosition — the row of position N", () => {
  const rows: EditorRow[] = [
    { id: 1, kind: "pinned" },
    { id: 2, kind: "ghost" },
    { id: 3, kind: "auto" },
    { id: 4, kind: "auto" },
  ];

  it("skips ghosts", () => {
    expect(rowIndexOfPosition(rows, 1)).toBe(0);
    expect(rowIndexOfPosition(rows, 2)).toBe(2);
    expect(rowIndexOfPosition(rows, 3)).toBe(3);
  });

  it("past the end is the last row", () => {
    expect(rowIndexOfPosition(rows, 9)).toBe(3);
  });
});

describe("withPicked — products picked in the catalog", () => {
  it("pins them on top in the order picked", () => {
    expect(withPicked(draft({ pin: [7, 8] }), [3, 1], "top").pin).toEqual([3, 1, 7, 8]);
  });

  it("or after the pins already there", () => {
    expect(withPicked(draft({ pin: [7, 8] }), [3, 1], "afterPins").pin).toEqual([7, 8, 3, 1]);
  });

  it("moves one pinned already, and shows one hidden again", () => {
    const next = withPicked(draft({ pin: [7, 3, 8], exclude: [1, 9] }), [3, 1], "top");
    expect(next.pin).toEqual([3, 1, 7, 8]);
    expect(next.exclude).toEqual([9]);
  });

  it("leaves the rest of the draft alone", () => {
    const before = draft({ fields: { title: "SALDI" }, limit: 12, fallback: "date" });
    const next = withPicked(before, [5], "top");
    expect(next.fields).toBe(before.fields);
    expect(next.limit).toBe(12);
    expect(next.fallback).toBe("date");
  });
});

describe("visibleWithJoiners — products joining the category on publish", () => {
  const added = new Map<number, AddedProduct>([
    [10, { product: listed, joins: true }],
    [11, { product: { ...listed, stockStatus: "outofstock" }, joins: true }],
    [12, { product: { ...listed, visibility: "hidden" }, joins: true }],
    [13, { product: listed, joins: false }],
  ]);

  it("draws the listable joiners where they will be, after the site's own", () => {
    expect(visibleWithJoiners([1, 2], [10, 11, 12, 13], added, true)).toEqual([1, 2, 10]);
  });

  it("counts a sold-out one when the shop lists sold-out products", () => {
    expect(visibleWithJoiners([1, 2], [10, 11], added, false)).toEqual([1, 2, 10, 11]);
  });

  it("keeps the site's list (the same array) when none joins", () => {
    const site = [1, 2];
    expect(visibleWithJoiners(site, [13, 1], added, true)).toBe(site);
  });

  it("does not draw twice a product the site shows already", () => {
    expect(visibleWithJoiners([1, 10], [10], added, true)).toEqual([1, 10]);
  });
});

describe("joinersOf — what goes into the category before publishing", () => {
  const added = new Map<number, AddedProduct>([
    [10, { product: listed, joins: true }],
    [11, { product: listed, joins: false }],
    [12, { product: listed, joins: true }],
  ]);

  it("is the pinned, added, outside products the site does not show", () => {
    expect(joinersOf([12, 11, 10, 3], added, [12])).toEqual([10]);
  });
});

describe("hiddenReasonOf", () => {
  it("says the first reason the shop would not list it", () => {
    expect(hiddenReasonOf({ ...listed, status: "draft", visibility: "hidden" })).toBe("unpublished");
    expect(hiddenReasonOf({ ...listed, visibility: "hidden", stockStatus: "outofstock" })).toBe("hidden");
    expect(hiddenReasonOf({ ...listed, stockStatus: "outofstock" })).toBe("outofstock");
    expect(hiddenReasonOf(listed)).toBe("not_in_section");
  });
});

describe("sectionFill — what may be added", () => {
  it("a category by hand, or by its rule", () => {
    expect(sectionFill({ taxonomy: "category" }, false, { taxonomy: "category", slug: "saldi" })).toBe("category");
    expect(sectionFill({ taxonomy: "category" }, true, { taxonomy: "category", slug: "saldi" })).toBe("automatic");
  });

  it("a brand", () => {
    expect(sectionFill({ taxonomy: "brand" }, false, { taxonomy: "brand", slug: "nike" })).toBe("brand");
  });

  it("the shop-wide lists", () => {
    expect(sectionFill(null, false, { list: "sale" })).toBe("sale");
    expect(sectionFill(null, false, { list: "best_selling" })).toBe("list");
  });

  it("nothing for several terms, a tag, a fixed list", () => {
    expect(sectionFill(null, false, null)).toBeNull();
  });
});

describe("draftOf", () => {
  it("is the rail's order, texts and size", () => {
    const rail = { pin: [1], exclude: [2], fallback: "date" as const, fields: { title: "X" }, limit: 8 };
    expect(draftOf(rail)).toEqual(rail);
  });
});
