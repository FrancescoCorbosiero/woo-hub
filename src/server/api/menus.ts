import "server-only";
import { layoutOf, rowsOf } from "@/lib/menus/plan";
import type { Menu, MenuSummary, SitePage, ThemePlace } from "@/lib/menus/types";
import { VetrinaError } from "@/server/vetrina/source";
import { getMenuSource, menuDigest } from "@/server/wordpress/menus/source";

/**
 * The site's navigation menus over the API (/api/v1/menus,
 * /api/v1/menu-locations, /api/v1/pages): what a caller reads before acting
 * on one — every menu, a menu's items top to bottom with where each stands,
 * the theme's places and the menu each shows, and the pages an item can lead
 * to. The actions themselves are the registry's (menuItem*, menuCreate,
 * menuRename, menuDelete, menuLocation), proposed and confirmed like any
 * other.
 */

export async function listMenus(): Promise<MenuSummary[]> {
  return (await getMenuSource()).menus();
}

/** A menu's id in an address: anything else is no menu of ours. */
export function menuId(id: string): number {
  const n = Number(id);
  if (!/^\d{1,10}$/.test(id) || !Number.isSafeInteger(n) || n <= 0) throw new VetrinaError("not_found", "No such menu.", 404);
  return n;
}

/**
 * A menu, its items top to bottom: each with its parent, its depth and its
 * 1-based place among its siblings (what an action's `place` takes), what it
 * leads to and its label. `digest` is the menu's fingerprint: send it back
 * as an action's `expected` to have the action refused if the menu changed
 * in between.
 */
export async function readMenu(id: number) {
  const menu: Menu = await (await getMenuSource()).menu(id);
  const byId = new Map(menu.items.map((i) => [i.id, i]));
  const { items: _items, ...summary } = menu;
  return {
    ...summary,
    digest: menuDigest(menu),
    items: rowsOf(layoutOf(menu.items)).map((row) => {
      const item = byId.get(row.id)!;
      return {
        id: item.id,
        parent: row.parent,
        depth: row.depth,
        position: row.position,
        title: item.title,
        label: item.label,
        target: item.target,
        url: item.url,
        invalid: item.invalid,
      };
    }),
  };
}

/** The site's published pages, for an item that leads to one. */
export async function listPages(): Promise<SitePage[]> {
  return (await getMenuSource()).pages();
}

/** The theme's places for a menu, each with the menu it shows. */
export async function listPlaces(): Promise<ThemePlace[]> {
  return (await getMenuSource()).places();
}

/** Where a category or a brand is in the site's menus, and the menus it can be added to. */
export interface TermInMenus {
  /** Each item leading to it: its menu (shown on the site or not), and the item it is under. */
  found: { menuId: number; menu: string; shown: boolean; itemId: number; parent: string | null }[];
  /** The site's menus, those the theme shows first. */
  menus: { id: number; name: string; shown: boolean; count: number }[];
}

/**
 * A category's or a brand's place in the site's menus, in one read of
 * them all (three requests to WordPress): for its screen in the catalog.
 */
export async function termInMenus(term: { kind: "category" | "brand"; id: number }): Promise<TermInMenus> {
  const { menus, items } = await (await getMenuSource()).everything();
  const byId = new Map(items.map((i) => [i.id, i]));
  const menuOf = new Map(menus.map((m) => [m.id, m]));
  // The menus the site shows first, each group in WordPress's order.
  const ordered = [...menus].sort((a, b) => Number(b.locations.length > 0) - Number(a.locations.length > 0));
  const rank = new Map(ordered.map((m, i) => [m.id, i]));
  const found = items
    .filter((i) => i.target.kind === term.kind && i.target.id === term.id && menuOf.has(i.menuId))
    .sort((a, b) => rank.get(a.menuId)! - rank.get(b.menuId)!)
    .map((i) => {
      const menu = menuOf.get(i.menuId)!;
      const parent = i.parent ? byId.get(i.parent) : undefined;
      return { menuId: menu.id, menu: menu.name, shown: menu.locations.length > 0, itemId: i.id, parent: parent?.title ?? null };
    });
  return { found, menus: ordered.map((m) => ({ id: m.id, name: m.name, shown: m.locations.length > 0, count: m.count })) };
}
