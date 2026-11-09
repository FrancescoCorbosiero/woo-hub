import "server-only";
import type { Menu, MenuItem, MenuItemExtra, MenuSummary, MenuTarget, SitePage, ThemePlace } from "@/lib/menus/types";
import { DEMO_BRAND_PARENT, DEMO_TERM_IDS, DEMO_TERM_NAMES } from "@/server/vetrina/fixture-data";
import { VetrinaError } from "@/server/vetrina/source";
import { sameMenuName, type MenuItemChange, type MenuSource, type NewMenuItem, type Outcome } from "./source";

/**
 * The demo shop's menus (VETRINA_SOURCE=fixture), held in memory, over the
 * demo shop's own categories, brands and pages — with WordPress's own rules
 * (WordPress 6.5's wp_update_nav_menu_item and menu-items API):
 *
 * - an item keeps the menu_order it is given, and no other item is
 *   renumbered;
 * - a label equal to its target's name is stored as none, so the item
 *   follows the target's name;
 * - an item whose category or page is gone is invalid;
 * - deleting an item leaves its children pointing at it;
 * - a link needs a label and an address; an unknown item is refused;
 * - two menus never share a name (in any case); a deleted menu takes its
 *   items with it and leaves the places that showed it empty.
 *
 * Nothing is written anywhere; a restart puts them back as they always are.
 */

interface DemoItem {
  id: number;
  menu: number;
  parent: number;
  order: number;
  /** "" = shows its target's name, as WordPress stores it. */
  label: string;
  target: MenuTarget;
  extra: MenuItemExtra;
}

interface DemoMenus {
  menus: { id: number; name: string; slug: string }[];
  locations: { slug: string; name: string; menu: number }[];
  items: DemoItem[];
  nextId: number;
}

const PAGES: SitePage[] = [
  { id: 2, title: "Chi siamo", parent: 0, url: "/chi-siamo/" },
  { id: 3, title: "Contatti", parent: 0, url: "/contatti/" },
  { id: 4, title: "Spedizioni e resi", parent: 0, url: "/spedizioni-e-resi/" },
  { id: 5, title: "Termini e condizioni", parent: 0, url: "/termini-e-condizioni/" },
  { id: 6, title: "Guida alle taglie", parent: 0, url: "/guida-alle-taglie/" },
];

const SLUG_BY_ID = new Map(Object.entries(DEMO_TERM_IDS).map(([slug, id]) => [id, slug]));
const isBrandSlug = (slug: string) => slug in DEMO_BRAND_PARENT;

const NO_EXTRA: MenuItemExtra = { newTab: false, classes: [], attrTitle: "", description: "", xfn: [] };

/** What a target is called, and where it leads; null when it is gone. */
function resolve(target: MenuTarget): { name: string; url: string } | null {
  switch (target.kind) {
    case "category":
    case "brand": {
      const slug = SLUG_BY_ID.get(target.id);
      if (!slug || isBrandSlug(slug) !== (target.kind === "brand")) return null;
      return { name: DEMO_TERM_NAMES[slug], url: target.kind === "brand" ? `/brand/${slug}/` : `/categoria-prodotto/${slug}/` };
    }
    case "page": {
      const page = PAGES.find((p) => p.id === target.id);
      return page ? { name: page.title, url: page.url } : null;
    }
    case "link":
      return { name: "", url: target.url };
    case "other":
      return null;
  }
}

function initial(): DemoMenus {
  let order = 0;
  const item = (id: number, menu: number, parent: number, target: MenuTarget, label = ""): DemoItem => ({
    id,
    menu,
    parent,
    order: ++order,
    label,
    target,
    extra: { ...NO_EXTRA },
  });
  const main = [
    item(11, 1, 0, { kind: "link", url: "/" }, "Home"),
    item(12, 1, 0, { kind: "category", id: DEMO_TERM_IDS["new-nuove-release"] }, "Novità"),
    item(13, 1, 0, { kind: "link", url: "#" }, "Brand"),
    item(14, 1, 13, { kind: "brand", id: DEMO_TERM_IDS.nike }),
    item(15, 1, 13, { kind: "brand", id: DEMO_TERM_IDS.adidas }),
    item(16, 1, 13, { kind: "brand", id: DEMO_TERM_IDS["new-balance"] }),
    item(17, 1, 0, { kind: "category", id: DEMO_TERM_IDS["saldi-sneakers-outlet"] }),
    item(18, 1, 0, { kind: "page", id: 2 }),
  ];
  order = 0;
  const footer = [item(21, 2, 0, { kind: "page", id: 3 }), item(22, 2, 0, { kind: "page", id: 4 }), item(23, 2, 0, { kind: "page", id: 5 })];
  return {
    menus: [
      { id: 1, name: "Menu principale", slug: "menu-principale" },
      { id: 2, name: "Footer", slug: "footer" },
    ],
    locations: [
      { slug: "primary", name: "Menu principale", menu: 1 },
      { slug: "footer", name: "Menu del footer", menu: 2 },
      { slug: "mobile", name: "Menu mobile", menu: 0 },
    ],
    items: [...main, ...footer],
    nextId: 100,
  };
}

// Shared across hot reloads and server bundles, like the demo shop itself.
const g = globalThis as { __vetrinaDemoMenus?: DemoMenus };
const state = (): DemoMenus => (g.__vetrinaDemoMenus ??= initial());

function view(item: DemoItem): MenuItem {
  const resolved = resolve(item.target);
  return {
    id: item.id,
    parent: item.parent,
    order: item.order,
    title: item.label || resolved?.name || "",
    label: item.label || null,
    target: structuredClone(item.target),
    url: resolved?.url ?? "",
    invalid: item.target.kind !== "link" && resolved == null,
    extra: structuredClone(item.extra),
  };
}

/** WordPress stores a label equal to the target's own name as none: the item follows the name. */
function storedLabel(target: MenuTarget, label: string | null): string {
  const own = resolve(target)?.name;
  return label == null || label === own ? "" : label;
}

const refused = (code: "not_found" | "invalid", message: string, status: number): Outcome<never> => ({
  ok: false,
  error: new VetrinaError(code, message, status),
});

/** WordPress's refusal of a name another menu has (wp_update_nav_menu_object). */
function assertFreeName(s: DemoMenus, name: string, id: number): void {
  if (s.menus.some((m) => m.id !== id && sameMenuName(m.name, name))) {
    throw new VetrinaError("invalid", `The menu name ${name} conflicts with another menu name. Please try another. (menu_exists, HTTP 400)`, 400);
  }
}

/** A slug as WordPress makes one from a name, unique among the menus. */
function slugFor(s: DemoMenus, name: string): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "menu";
  let slug = base;
  for (let n = 2; s.menus.some((m) => m.slug === slug); n++) slug = `${base}-${n}`;
  return slug;
}

function menuOf(s: DemoMenus, id: number): DemoMenus["menus"][number] {
  const menu = s.menus.find((m) => m.id === id);
  if (!menu) throw new VetrinaError("not_found", "Term does not exist. (rest_term_invalid, HTTP 404)", 404);
  return menu;
}

/** Every menu, with the places that show it and its items' count. */
function summaries(s: DemoMenus): MenuSummary[] {
  return s.menus.map((m) => ({
    ...m,
    locations: s.locations.filter((l) => l.menu === m.id).map(({ slug, name }) => ({ slug, name })),
    count: s.items.filter((i) => i.menu === m.id).length,
  }));
}

export function fixtureMenus(): MenuSource {
  return {
    kind: "fixture",
    async menus() {
      return summaries(state());
    },
    async menu(id) {
      const s = state();
      const menu = s.menus.find((m) => m.id === id);
      if (!menu) throw new VetrinaError("not_found", `No menu ${id} on the site.`, 404);
      const items = s.items
        .filter((i) => i.menu === id)
        .sort((a, b) => a.order - b.order || a.id - b.id)
        .map(view);
      return {
        ...menu,
        locations: s.locations.filter((l) => l.menu === id).map(({ slug, name }) => ({ slug, name })),
        count: items.length,
        items,
      } satisfies Menu;
    },
    async pages() {
      return structuredClone(PAGES);
    },
    async create(menuId, items: readonly NewMenuItem[]) {
      const s = state();
      if (!s.menus.some((m) => m.id === menuId)) return items.map(() => refused("invalid", "Invalid menu ID.", 400));
      return items.map((asked): Outcome<MenuItem> => {
        if (asked.target.kind === "link" && (!asked.label || !asked.target.url)) {
          return refused("invalid", "The title and the url are required when using a custom menu item type.", 400);
        }
        const id = s.nextId++;
        const item: DemoItem = {
          id,
          menu: menuId,
          parent: asked.parent === id ? 0 : asked.parent,
          order: asked.order || 1,
          label: storedLabel(asked.target, asked.label),
          target: structuredClone(asked.target),
          extra: structuredClone(asked.extra ?? NO_EXTRA),
        };
        s.items.push(item);
        return { ok: true, value: view(item) };
      });
    },
    async update(changes: readonly MenuItemChange[]) {
      const s = state();
      return changes.map((change): Outcome<null> => {
        const item = s.items.find((i) => i.id === change.id);
        if (!item) return refused("not_found", "Invalid post ID.", 404);
        if (change.label !== undefined && change.label == null && item.target.kind === "link") {
          return refused("invalid", "The title is required when using a custom menu item type.", 400);
        }
        if (change.parent !== undefined) item.parent = change.parent === item.id ? 0 : change.parent;
        if (change.order !== undefined) item.order = change.order;
        if (change.label !== undefined) item.label = storedLabel(item.target, change.label);
        return { ok: true, value: null };
      });
    },
    async remove(ids) {
      const s = state();
      return ids.map((id): Outcome<null> => {
        const at = s.items.findIndex((i) => i.id === id);
        if (at < 0) return refused("not_found", "Invalid post ID.", 404);
        // Its children keep pointing at it, as WordPress leaves them.
        s.items.splice(at, 1);
        return { ok: true, value: null };
      });
    },
    async everything() {
      const s = state();
      const items = [...s.items].sort((a, b) => a.order - b.order || a.id - b.id).map((item) => ({ ...view(item), menuId: item.menu }));
      return { menus: summaries(s), items };
    },
    async places() {
      const s = state();
      return s.locations.map((l): ThemePlace => {
        const menu = s.menus.find((m) => m.id === l.menu);
        return { slug: l.slug, name: l.name, menu: menu ? { id: menu.id, name: menu.name } : null };
      });
    },
    async createMenu(name) {
      const s = state();
      assertFreeName(s, name, 0);
      const menu = { id: s.nextId++, name: name.trim(), slug: slugFor(s, name) };
      s.menus.push(menu);
      return { ...menu, locations: [], count: 0 };
    },
    async renameMenu(id, name) {
      const s = state();
      const menu = menuOf(s, id);
      assertFreeName(s, name, id);
      menu.name = name.trim();
    },
    async deleteMenu(id) {
      const s = state();
      menuOf(s, id);
      s.menus = s.menus.filter((m) => m.id !== id);
      s.items = s.items.filter((i) => i.menu !== id);
      for (const place of s.locations) if (place.menu === id) place.menu = 0;
    },
    async setPlace(slug, menuId) {
      const s = state();
      const place = s.locations.find((l) => l.slug === slug);
      if (!place) throw new VetrinaError("invalid", "Invalid menu location. (rest_invalid_menu_location, HTTP 400)", 400);
      if (menuId != null) menuOf(s, menuId);
      place.menu = menuId ?? 0;
    },
  };
}
