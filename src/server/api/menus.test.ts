import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The menus' reads for the API and the catalog, over the demo menus
 * (VETRINA_SOURCE=fixture): a category's or a brand's place in them, and the
 * theme's places.
 */
vi.mock("@/lib/env", () => ({ env: { VETRINA_SOURCE: "fixture" } }));

import { getMenuSource } from "@/server/wordpress/menus/source";
import { listPlaces, readMenu, termInMenus } from "./menus";

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__vetrinaDemoMenus;
});

describe("where a category or a brand is in the site's menus", () => {
  it("finds a brand under its parent item, and lists the menus the site shows first", async () => {
    expect(await termInMenus({ kind: "brand", id: 201 })).toEqual({
      found: [{ menuId: 1, menu: "Menu principale", shown: true, itemId: 14, parent: "Brand" }],
      menus: [
        { id: 1, name: "Menu principale", shown: true, count: 8 },
        { id: 2, name: "Footer", shown: true, count: 3 },
      ],
    });
  });

  it("finds it in every menu holding it, a menu the site does not show last, and none for what no menu holds", async () => {
    const source = await getMenuSource();
    const extra = await source.createMenu("Bozza");
    await source.create(extra.id, [{ target: { kind: "brand", id: 201 }, label: "Nike!", parent: 0, order: 1 }]);
    await source.create(2, [{ target: { kind: "brand", id: 201 }, label: null, parent: 0, order: 9 }]);
    const nike = await termInMenus({ kind: "brand", id: 201 });
    expect(nike.found.map((f) => [f.menu, f.shown, f.parent])).toEqual([
      ["Menu principale", true, "Brand"],
      ["Footer", true, null],
      ["Bozza", false, null],
    ]);
    expect(nike.menus.map((m) => [m.name, m.shown])).toEqual([
      ["Menu principale", true],
      ["Footer", true],
      ["Bozza", false],
    ]);
    expect((await termInMenus({ kind: "category", id: 201 })).found).toEqual([]);
  });
});

describe("the theme's places, and a menu as the API reads it", () => {
  it("lists every place with the menu it shows, an empty one too", async () => {
    expect(await listPlaces()).toEqual([
      { slug: "primary", name: "Menu principale", menu: { id: 1, name: "Menu principale" } },
      { slug: "footer", name: "Menu del footer", menu: { id: 2, name: "Footer" } },
      { slug: "mobile", name: "Menu mobile", menu: null },
    ]);
  });

  it("reads a menu's items top to bottom, each with its depth and its place among its siblings", async () => {
    const menu = await readMenu(1);
    expect(menu.items.map((i) => [i.title, i.depth, i.position])).toEqual([
      ["Home", 0, 1],
      ["Novità", 0, 2],
      ["Brand", 0, 3],
      ["Nike", 1, 1],
      ["Adidas", 1, 2],
      ["New Balance", 1, 3],
      ["Saldi outlet", 0, 4],
      ["Chi siamo", 0, 5],
    ]);
    expect(menu.digest).toMatch(/^[0-9a-f]{32}$/);
  });
});
