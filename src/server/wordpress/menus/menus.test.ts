import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WpMenuItem } from "../client";

/**
 * The menus' two sources: WordPress's answers read into the Hub's items
 * (wp-menus.ts), the demo's menus keeping WordPress's own rules
 * (fixture-menus.ts), and the fingerprint a write is checked against.
 */
vi.mock("@/lib/env", () => ({ env: { VETRINA_SOURCE: "fixture" } }));
const client = vi.hoisted(() => ({
  menus: vi.fn(),
  locations: vi.fn(),
  updateMenu: vi.fn(),
  itemMenus: vi.fn(),
  menuItems: vi.fn(),
  createMenuItems: vi.fn(),
  updateMenuItems: vi.fn(),
  deleteMenuItems: vi.fn(),
}));
vi.mock("../client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../client")>();
  return { ...real, wp: { ...real.wp, ...client } };
});

import { fixtureMenus } from "./fixture-menus";
import { menuDigest, targetKey } from "./source";
import { menuItemOf, wordpressMenus } from "./wp-menus";

const wpItem = (over: Partial<WpMenuItem>): WpMenuItem => ({
  id: 1,
  title: { raw: "", rendered: "" },
  status: "publish",
  url: "",
  attr_title: "",
  description: " ",
  type: "custom",
  object: "custom",
  object_id: 1,
  parent: 0,
  menu_order: 1,
  target: "",
  classes: [""],
  xfn: [""],
  invalid: false,
  menus: 7,
  ...over,
});

describe("WordPress's menus, read", () => {
  it("counts each menu's items from the items, since WordPress's menus carry no count", async () => {
    client.menus.mockResolvedValueOnce([
      { id: 7, name: "Principale", slug: "principale", locations: ["primary"] },
      { id: 9, name: "Footer &amp; info", slug: "footer", locations: [] },
      { id: 11, name: "Vuoto", slug: "vuoto", locations: [] },
    ]);
    client.locations.mockResolvedValueOnce({ primary: { name: "primary", description: "Menu principale", menu: 7 } });
    client.itemMenus.mockResolvedValueOnce([
      { id: 1, menus: 7 },
      { id: 2, menus: 7 },
      { id: 3, menus: 9 },
    ]);
    expect(await wordpressMenus().menus()).toEqual([
      { id: 7, name: "Principale", slug: "principale", locations: [{ slug: "primary", name: "Menu principale" }], count: 2 },
      { id: 9, name: "Footer & info", slug: "footer", locations: [], count: 1 },
      { id: 11, name: "Vuoto", slug: "vuoto", locations: [], count: 0 },
    ]);
  });

  it("counts a menu's items as read, and says when the menu is not there", async () => {
    client.menus.mockResolvedValue([{ id: 7, name: "Principale", slug: "principale", locations: [] }]);
    client.locations.mockResolvedValue({});
    client.menuItems.mockResolvedValueOnce([wpItem({ id: 1 }), wpItem({ id: 2, menu_order: 2 })]);
    expect(await wordpressMenus().menu(7)).toMatchObject({ id: 7, count: 2, items: [{ id: 1 }, { id: 2 }] });
    client.menuItems.mockResolvedValueOnce([]);
    await expect(wordpressMenus().menu(8)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("WordPress's places, set", () => {
  const MENUS = [
    { id: 7, name: "Principale", slug: "principale", locations: ["primary", "mobile"] },
    { id: 9, name: "Saldi", slug: "saldi", locations: [] },
  ];

  it("puts a menu in a place through its own list of places, and reads the place back", async () => {
    client.menus.mockResolvedValueOnce(MENUS);
    client.updateMenu.mockResolvedValueOnce({});
    client.locations.mockResolvedValueOnce({ primary: { name: "primary", description: "", menu: 9 } });
    await wordpressMenus().setPlace("primary", 9);
    expect(client.updateMenu).toHaveBeenCalledWith(9, { locations: ["primary"] });
  });

  it("empties a place by taking it out of the list of the menu there, the menu's other places kept", async () => {
    client.menus.mockResolvedValueOnce(MENUS);
    client.updateMenu.mockResolvedValueOnce({});
    client.locations.mockResolvedValueOnce({ primary: { name: "primary", description: "", menu: 0 } });
    await wordpressMenus().setPlace("primary", null);
    expect(client.updateMenu).toHaveBeenCalledWith(7, { locations: ["mobile"] });
  });

  it("is no success when WordPress answers without changing the place", async () => {
    client.menus.mockResolvedValueOnce(MENUS);
    client.updateMenu.mockResolvedValueOnce({});
    client.locations.mockResolvedValueOnce({ primary: { name: "primary", description: "", menu: 7 } });
    await expect(wordpressMenus().setPlace("primary", 9)).rejects.toMatchObject({ code: "failed", message: expect.stringContaining("shows menu 7") });
  });
});

describe("WordPress's menu items, read", () => {
  it("knows a product category, a brand, a page and a link — and keeps anything else as it is", () => {
    const of = (over: Partial<WpMenuItem>) => menuItemOf(wpItem(over)).target;
    expect(of({ type: "taxonomy", object: "product_cat", object_id: 12 })).toEqual({ kind: "category", id: 12 });
    expect(of({ type: "taxonomy", object: "product_brand", object_id: 7 })).toEqual({ kind: "brand", id: 7 });
    expect(of({ type: "post_type", object: "page", object_id: 2 })).toEqual({ kind: "page", id: 2 });
    expect(of({ type: "custom", url: "https://shop.example.com/saldi/" })).toEqual({ kind: "link", url: "https://shop.example.com/saldi/" });
    expect(of({ type: "taxonomy", object: "category", object_id: 3 })).toEqual({ kind: "other", type: "taxonomy", object: "category", id: 3 });
    expect(of({ type: "post_type_archive", object: "product", object_id: 0 })).toEqual({ kind: "other", type: "post_type_archive", object: "product", id: 0 });
  });

  it("tells an item's own label from its target's name, and reads WordPress's entities", () => {
    const named = menuItemOf(wpItem({ type: "taxonomy", object: "product_cat", object_id: 12, title: { raw: "", rendered: "Saldi &amp; Outlet" } }));
    expect([named.title, named.label]).toEqual(["Saldi & Outlet", null]);
    const own = menuItemOf(wpItem({ title: { raw: "Novità", rendered: "Novità" } }));
    expect([own.title, own.label]).toEqual(["Novità", "Novità"]);
  });

  it("keeps what WordPress has besides, without its blanks", () => {
    const item = menuItemOf(wpItem({ target: "_blank", classes: ["", "evidenza"], xfn: [""], attr_title: "Tutto", description: " " }));
    expect(item.extra).toEqual({ newTab: true, classes: ["evidenza"], attrTitle: "Tutto", description: "", xfn: [] });
  });

  it("writes a new item as WordPress takes it: its target, its label or none, its place", async () => {
    client.createMenuItems.mockResolvedValueOnce([
      { ok: true, body: wpItem({ id: 40, type: "taxonomy", object: "product_cat", object_id: 12, parent: 3, menu_order: 5 }) },
    ]);
    const [made] = await wordpressMenus().create(7, [{ target: { kind: "category", id: 12 }, label: null, parent: 3, order: 5 }]);
    expect(client.createMenuItems).toHaveBeenCalledWith([
      { menus: 7, type: "taxonomy", object: "product_cat", object_id: 12, title: "", parent: 3, menu_order: 5 },
    ]);
    expect(made).toMatchObject({ ok: true, value: { id: 40, parent: 3, order: 5, target: { kind: "category", id: 12 } } });
  });

  it("changes only what it is given, a label back to its target's name as an empty title", async () => {
    client.updateMenuItems.mockResolvedValueOnce([{ ok: true, body: {} }, { ok: true, body: {} }]);
    await wordpressMenus().update([{ id: 4, order: 2 }, { id: 5, label: null, parent: 0 }]);
    expect(client.updateMenuItems).toHaveBeenCalledWith([
      { id: 4, body: { menu_order: 2 } },
      { id: 5, body: { parent: 0, title: "" } },
    ]);
  });
});

describe("the demo shop's menus", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__vetrinaDemoMenus;
  });

  it("are the main menu and the footer, in the theme's places, over the demo's own categories, brands and pages", async () => {
    const menus = await fixtureMenus().menus();
    expect(menus.map((m) => [m.name, m.locations.map((l) => l.slug), m.count])).toEqual([
      ["Menu principale", ["primary"], 8],
      ["Footer", ["footer"], 3],
    ]);
    const main = await fixtureMenus().menu(1);
    expect(main.items.map((i) => [i.title, i.parent])).toEqual([
      ["Home", 0],
      ["Novità", 0],
      ["Brand", 0],
      ["Nike", 13],
      ["Adidas", 13],
      ["New Balance", 13],
      ["Saldi outlet", 0],
      ["Chi siamo", 0],
    ]);
    await expect(fixtureMenus().menu(99)).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps the menu_order it is given and renumbers nobody, as WordPress", async () => {
    const source = fixtureMenus();
    const [made] = await source.create(1, [{ target: { kind: "brand", id: 208 }, label: null, parent: 13, order: 4 }]);
    expect(made).toMatchObject({ ok: true, value: { title: "Asics", order: 4, parent: 13 } });
    const orders = (await source.menu(1)).items.filter((i) => i.order === 4).map((i) => i.title);
    expect(orders.sort()).toEqual(["Asics", "Nike"]);
  });

  it("stores a label equal to the target's name as none, so the item follows the name", async () => {
    const source = fixtureMenus();
    await source.update([{ id: 17, label: "Saldi outlet" }]);
    expect((await source.menu(1)).items.find((i) => i.id === 17)).toMatchObject({ label: null, title: "Saldi outlet" });
    await source.update([{ id: 17, label: "Saldi" }]);
    expect((await source.menu(1)).items.find((i) => i.id === 17)).toMatchObject({ label: "Saldi", title: "Saldi" });
  });

  it("leaves a deleted item's children pointing at it, and refuses what is not there", async () => {
    const source = fixtureMenus();
    expect(await source.remove([13])).toEqual([{ ok: true, value: null }]);
    expect((await source.menu(1)).items.filter((i) => i.parent === 13).map((i) => i.title)).toEqual(["Nike", "Adidas", "New Balance"]);
    expect((await source.remove([13]))[0]).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect((await source.update([{ id: 999, order: 1 }]))[0]).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("refuses a link without a label, and marks an item whose category is gone", async () => {
    const source = fixtureMenus();
    expect((await source.create(1, [{ target: { kind: "link", url: "/x" }, label: null, parent: 0, order: 9 }]))[0]).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });
    expect((await source.update([{ id: 11, label: null }]))[0]).toMatchObject({ ok: false, error: { code: "invalid" } });
    const [gone] = await source.create(1, [{ target: { kind: "category", id: 999 }, label: null, parent: 0, order: 9 }]);
    expect(gone).toMatchObject({ ok: true, value: { invalid: true } });
  });

  it("starts again as it always is after a restart", async () => {
    await fixtureMenus().remove([18]);
    delete (globalThis as Record<string, unknown>).__vetrinaDemoMenus;
    expect((await fixtureMenus().menu(1)).items).toHaveLength(8);
  });
});

describe("a menu's fingerprint", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__vetrinaDemoMenus;
  });

  it("follows the order the numbers make, not the numbers", async () => {
    const menu = await fixtureMenus().menu(1);
    const gaps = { ...menu, items: menu.items.map((i) => ({ ...i, order: i.order * 10 })) };
    expect(menuDigest(gaps)).toBe(menuDigest(menu));
  });

  it("changes when an item moves, is renamed or leads elsewhere", async () => {
    const source = fixtureMenus();
    const before = menuDigest(await source.menu(1));
    await source.update([{ id: 18, order: 0 }]);
    const moved = menuDigest(await source.menu(1));
    expect(moved).not.toBe(before);
    await source.update([{ id: 18, label: "La nostra storia" }]);
    expect(menuDigest(await source.menu(1))).not.toBe(moved);
    expect(targetKey({ kind: "link", url: "/x" })).not.toBe(targetKey({ kind: "page", id: 2 }));
  });
});
