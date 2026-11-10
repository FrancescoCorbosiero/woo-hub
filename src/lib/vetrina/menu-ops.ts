import type { MenuItemExtra, MenuTarget } from "@/lib/menus/types";

/**
 * The site's navigation menus' own actions — an item added, moved, taken
 * away, renamed; a whole menu made (or copied), renamed, deleted, put in a
 * place of the theme — filed in the same log as the catalog's and the
 * homepage's actions (catalog-ops.ts, page-ops.ts), with the same "Annulla". Each is
 * written at once over WordPress's REST API (src/server/wordpress), the whole
 * menu renumbered as WordPress's own editor numbers it, and filed with its
 * way back: "Annulla" finds the items again by their ids and neighbours, and
 * refuses when someone changed them since
 * (src/server/vetrina/operations/menu.ts). Client components import only
 * these types.
 */

/**
 * The menu as a screen read it (its fingerprint, from the menu's read),
 * presented back with the action: refused when the menu changed since.
 * Absent: the menu as it is when the action runs.
 */
export interface MenuExpected {
  digest: string;
}

/** Where an item goes: under `parent` (an item's id; absent or 0 = the top level), at its 1-based `position` there (absent = last). */
export interface MenuPlace {
  parent?: number | null;
  position?: number | null;
}

/** What an item added leads to, and its own label (else its target's name; a link needs one). */
export type MenuNewItem =
  | { kind: "category"; id: number; label?: string | null }
  | { kind: "brand"; id: number; label?: string | null }
  | { kind: "page"; id: number; label?: string | null }
  | { kind: "link"; url: string; label: string };

export type MenuActionInput =
  /** Items added, in order, at one place. */
  | { kind: "menuItemAdd"; menuId: number; items: MenuNewItem[]; place?: MenuPlace; expected?: MenuExpected }
  /** An item, with everything under it, to another place. */
  | { kind: "menuItemMove"; menuId: number; itemId: number; place: MenuPlace; expected?: MenuExpected }
  /** An item taken out; its own items take its place. */
  | { kind: "menuItemRemove"; menuId: number; itemId: number; expected?: MenuExpected }
  /** An item's own label; null = back to its target's name. */
  | { kind: "menuItemRename"; menuId: number; itemId: number; label: string | null; expected?: MenuExpected }
  /** A new menu, empty or with a copy of another's items: in no place of the theme until put in one. */
  | { kind: "menuCreate"; name: string; copyOf?: number | null }
  /** A menu's name. */
  | { kind: "menuRename"; menuId: number; name: string }
  /** A menu deleted with its items: refused while the theme shows it. */
  | { kind: "menuDelete"; menuId: number; expected?: MenuExpected }
  /** The menu a place of the theme shows (GET /api/v1/menu-locations); null = none. */
  | { kind: "menuLocation"; location: string; menuId: number | null };

export type MenuActionKind = MenuActionInput["kind"];

export const MENU_ACTION_KINDS = [
  "menuItemAdd",
  "menuItemMove",
  "menuItemRemove",
  "menuItemRename",
  "menuCreate",
  "menuRename",
  "menuDelete",
  "menuLocation",
] as const satisfies readonly MenuActionKind[];

const MENU_KINDS: ReadonlySet<string> = new Set(MENU_ACTION_KINDS);

/** A menu action, not one on products or on the homepage. */
export function isMenuActionKind(kind: string): kind is MenuActionKind {
  return MENU_KINDS.has(kind);
}

/** Where an item stood: its parent, the sibling it came after (null = first), its 1-based place. */
export interface MenuSpot {
  parent: number;
  after: number | null;
  position: number;
}

/** An item as an action found or left it: enough to know it again, and to bring it back. */
export interface MenuItemSnapshot {
  id: number;
  title: string;
  label: string | null;
  target: MenuTarget;
  parent: number;
  extra: MenuItemExtra;
}

/**
 * A menu action's way back, filed with it (vetrina_operations.menu): the
 * menu, and what the action changed, as it left it.
 */
export type OperationMenuRecord =
  | {
      kind: "menuItemAdd";
      menuId: number;
      menu: string;
      /** The items WordPress made, as the action left them. */
      created: { id: number; parent: number; label: string | null; title: string }[];
    }
  | { kind: "menuItemMove"; menuId: number; menu: string; item: { id: number; title: string }; from: MenuSpot; to: MenuSpot }
  | {
      kind: "menuItemRemove";
      menuId: number;
      menu: string;
      item: MenuItemSnapshot;
      spot: MenuSpot;
      /** Its own items, lifted into its place, in their order. */
      lifted: number[];
    }
  | {
      kind: "menuItemRename";
      menuId: number;
      menu: string;
      item: { id: number; title: string };
      before: string | null;
      /** As WordPress stored it: a label equal to the target's name is stored as none. */
      after: string | null;
    }
  | {
      kind: "menuCreate";
      menuId: number;
      menu: string;
      /** The menu copied, by name; null: made empty. */
      from: string | null;
      copied: number;
      /** Its fingerprint as made: "Annulla" deletes it only while it is so. */
      digest: string;
    }
  | { kind: "menuRename"; menuId: number; menu: string; before: string; after: string }
  | {
      kind: "menuDelete";
      menuId: number;
      menu: string;
      /** Every item, top to bottom (a parent before its items): how "Annulla" makes the menu again. */
      items: MenuItemSnapshot[];
    }
  | {
      kind: "menuLocation";
      /** The menu put in the place (0: none). */
      menuId: number;
      menu: string | null;
      location: { slug: string; name: string };
      /** The menu the place showed before (null: none). */
      before: { id: number; name: string } | null;
    };
