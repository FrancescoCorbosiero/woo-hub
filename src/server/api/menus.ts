import "server-only";
import { layoutOf, rowsOf } from "@/lib/menus/plan";
import type { Menu, MenuSummary, SitePage } from "@/lib/menus/types";
import { VetrinaError } from "@/server/vetrina/source";
import { getMenuSource, menuDigest } from "@/server/wordpress/menus/source";

/**
 * The site's navigation menus over the API (/api/v1/menus, /api/v1/pages):
 * what a caller reads before acting on one — every menu, a menu's items top
 * to bottom with where each stands, and the pages an item can lead to. The
 * actions themselves are the registry's (menuItemAdd, menuItemMove,
 * menuItemRemove, menuItemRename), proposed and confirmed like any other.
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
