import "server-only";
import { createHash } from "node:crypto";
import { hubConfig } from "@/config";
import { env } from "@/lib/env";
import { layoutOf, rowsOf } from "@/lib/menus/plan";
import type { Menu, MenuItem, MenuItemExtra, MenuSummary, MenuTarget, SitePage, ThemePlace } from "@/lib/menus/types";
import type { VetrinaError } from "@/server/vetrina/source";

/**
 * Where the Hub reads and writes the site's navigation menus. Two
 * implementations with one contract, as the homepage has (VetrinaSource):
 * the live site, over WordPress's own REST API (wp-menus.ts), and the demo
 * shop's menus in memory, which behave as WordPress does (fixture-menus.ts).
 * VETRINA_SOURCE picks one for both.
 *
 * Writes are low-level on purpose — items made, changed, deleted, each with
 * its own outcome — so the action that plans them (operations/menu.ts)
 * decides what a half-done write means. A whole menu's writes (made,
 * renamed, deleted, put in a place) are one request each, and throw
 * WordPress's refusal.
 */

/** The site's menus and all their items: each item with the menu it is in. */
export interface SiteMenus {
  menus: MenuSummary[];
  items: (MenuItem & { menuId: number })[];
}

/** One write's outcome: done, or why not. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: VetrinaError };

export interface NewMenuItem {
  target: MenuTarget;
  /** Its own label; null = the target's own name (a link needs one). */
  label: string | null;
  parent: number;
  /** Its menu_order. */
  order: number;
  /** What an item an undo brings back had besides (its classes, a new tab…). */
  extra?: MenuItemExtra;
}

/** What changes on an item: only what is given. */
export interface MenuItemChange {
  id: number;
  parent?: number;
  order?: number;
  /** null = back to the target's own name. */
  label?: string | null;
}

export interface MenuSource {
  readonly kind: "wordpress" | "fixture";
  /** Every menu, with the theme's places it is in. */
  menus(): Promise<MenuSummary[]>;
  /** A menu and its items, read now; not_found when there is no such menu. */
  menu(id: number): Promise<Menu>;
  /** The published pages an item can lead to. */
  pages(): Promise<SitePage[]>;
  /** New items in a menu, in order: each as WordPress made it, or why it did not. */
  create(menuId: number, items: readonly NewMenuItem[]): Promise<Outcome<MenuItem>[]>;
  update(changes: readonly MenuItemChange[]): Promise<Outcome<null>[]>;
  /** Items deleted for good (menu items have no trash). */
  remove(ids: readonly number[]): Promise<Outcome<null>[]>;

  /** Every menu and every item of every menu, in one read: where something is in the site's menus. */
  everything(): Promise<SiteMenus>;
  /** Every menu and the theme's places, read together (the Menu tab; choosing a place). */
  overview(): Promise<{ menus: MenuSummary[]; places: ThemePlace[] }>;
  /** A menu with its items and the theme's places, read together (a menu's screen). */
  menuAndPlaces(id: number): Promise<{ menu: Menu; places: ThemePlace[] }>;
  /** Every place the theme registered, with the menu it shows. */
  places(): Promise<ThemePlace[]>;
  /** A new, empty menu in no place; refused when another menu has the name. */
  createMenu(name: string): Promise<MenuSummary>;
  renameMenu(id: number, name: string): Promise<void>;
  /** A menu and its items deleted; the places that showed it show none. */
  deleteMenu(id: number): Promise<void>;
  /** The menu a place shows; null: none. */
  setPlace(slug: string, menuId: number | null): Promise<void>;
}

/** The configured source; VETRINA_SOURCE overrides hub.config.ts, as for the homepage. */
export async function getMenuSource(): Promise<MenuSource> {
  const kind = env.VETRINA_SOURCE ?? hubConfig.vetrina.source;
  if (kind === "fixture") {
    const { fixtureMenus } = await import("./fixture-menus");
    return fixtureMenus();
  }
  const { wordpressMenus } = await import("./wp-menus");
  return wordpressMenus();
}

/** What an item leads to, as one string: "category:12", "link:/saldi". */
export function targetKey(target: MenuTarget): string {
  switch (target.kind) {
    case "link":
      return `link:${target.url}`;
    case "other":
      return `other:${target.type}:${target.object}:${target.id}`;
    default:
      return `${target.kind}:${target.id}`;
  }
}

/**
 * A menu's fingerprint: its items top to bottom — which is under which, each
 * one's label and target. What an action checks the menu against before
 * writing, and what a screen presents back. menu_order's numbers themselves
 * are left out: WordPress may number a menu with gaps, and only the order
 * they make counts.
 */
export function menuDigest(menu: Pick<Menu, "id" | "items">): string {
  const byId = new Map(menu.items.map((i) => [i.id, i]));
  const rows = rowsOf(layoutOf(menu.items)).map((r) => {
    const item = byId.get(r.id)!;
    return [r.id, r.parent, item.label, targetKey(item.target)];
  });
  return createHash("sha256").update(JSON.stringify([menu.id, rows])).digest("hex").slice(0, 32);
}

/** Item ids, read: what an item an action names is in this menu. */
export function itemIn(menu: Pick<Menu, "items">, id: number): MenuItem | undefined {
  return menu.items.find((i) => i.id === id);
}

/** Two menu names WordPress takes for one (its term lookup ignores case). */
export const sameMenuName = (a: string, b: string) => a.trim().toLocaleLowerCase("it") === b.trim().toLocaleLowerCase("it");
