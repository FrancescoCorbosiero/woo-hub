/**
 * The site's navigation menus (WordPress's Appearance › Menus), as the Hub
 * reads and changes them over WordPress's own REST API (wp/v2: menus,
 * menu-items, menu-locations; src/server/wordpress). Pure types, shared by
 * the server and the screens.
 *
 * What WordPress keeps, and these mirror:
 * - a menu is a term (nav_menu) with a name; a theme shows it in its places
 *   ("locations", e.g. the header's);
 * - an item is a post (nav_menu_item) in one menu: what it leads to, its
 *   label, its parent item (0 at the top level) and `menu_order`, its place
 *   across the whole menu — WordPress's own editor numbers every item 1…n
 *   top to bottom, a parent before its children;
 * - an item that leads to a category, a brand or a page with no label of its
 *   own shows that thing's current name (a category renamed renames it);
 * - an item whose category or page is gone is "invalid": WordPress leaves it
 *   off the site.
 */

/**
 * What an item leads to. The Hub adds the first four; anything else a menu
 * can hold (a post, a blog category, an archive) is kept as it is, movable
 * and removable, under "other".
 */
export type MenuTarget =
  /** A product category (WooCommerce's product_cat). */
  | { kind: "category"; id: number }
  /** A brand (WooCommerce's product_brand). */
  | { kind: "brand"; id: number }
  /** A page. */
  | { kind: "page"; id: number }
  /** A link of its own: an address, inside the shop or out. */
  | { kind: "link"; url: string }
  /** Anything else, as WordPress names it: its type ("post_type"), object ("post") and that object's id. */
  | { kind: "other"; type: string; object: string; id: number };

export type MenuTargetKind = MenuTarget["kind"];

/**
 * What WordPress keeps on an item besides its place and label — none of it
 * set by the Hub, all of it kept, and put back with an item an undo brings
 * back.
 */
export interface MenuItemExtra {
  /** Opens in a new tab (target="_blank"). */
  newTab: boolean;
  classes: string[];
  /** The link's title attribute. */
  attrTitle: string;
  description: string;
  xfn: string[];
}

export interface MenuItem {
  id: number;
  /** The item it is under; 0 at the menu's top level. */
  parent: number;
  /** WordPress's menu_order: the item's place across the whole menu. */
  order: number;
  /** What the site shows: its own label, else its target's name. */
  title: string;
  /** Its own label; null when it shows its target's name. */
  label: string | null;
  target: MenuTarget;
  /** Where it leads, as WordPress resolves it. */
  url: string;
  /** Leads to something gone (a category deleted): WordPress leaves it off the site. */
  invalid: boolean;
  extra: MenuItemExtra;
}

/** A place of the theme that shows a menu: its slug ("primary") and its name ("Primary menu"). */
export interface MenuLocation {
  slug: string;
  name: string;
}

/**
 * A place the theme registered for a menu, and the menu it shows there
 * (null: none — the theme then shows nothing, or its own fallback). A theme
 * with no places at all is a block theme's, whose navigation is not these
 * menus.
 */
export interface ThemePlace extends MenuLocation {
  menu: { id: number; name: string } | null;
}

export interface MenuSummary {
  id: number;
  name: string;
  slug: string;
  /** Where the theme shows it; none = shown nowhere yet. */
  locations: MenuLocation[];
  /** Its items, counted. */
  count: number;
}

export interface Menu extends MenuSummary {
  /** Its items, in WordPress's order (menu_order, then id). */
  items: MenuItem[];
}

/** A page of the site, as a menu item can lead to it. */
export interface SitePage {
  id: number;
  title: string;
  /** Its parent page; 0 at the top. */
  parent: number;
  url: string;
}
