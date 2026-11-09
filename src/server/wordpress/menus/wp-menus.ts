import "server-only";
import type { Menu, MenuItem, MenuSummary, MenuTarget, ThemePlace } from "@/lib/menus/types";
import { decodeEntities } from "@/server/collections/index-rows";
import { VetrinaError } from "@/server/vetrina/source";
import { itemOf, wp, type BatchOutcome, type WpLocations, type WpMenu, type WpMenuItem, type WpMenuItemBody, type WpPage } from "../client";
import type { MenuItemChange, MenuSource, NewMenuItem, Outcome } from "./source";

/**
 * The live site's menus, over WordPress's own REST API (../client.ts):
 * WordPress's shapes read into the Hub's (lib/menus/types.ts), and the
 * Hub's items written as WordPress takes them.
 */

/** WooCommerce's taxonomies for what the Hub calls a category and a brand. */
const TAXONOMY = { category: "product_cat", brand: "product_brand" } as const;

const titleText = (title: WpMenuItem["title"] | WpPage["title"]) => decodeEntities(typeof title === "string" ? title : title.rendered);
const rawLabel = (title: WpMenuItem["title"]) => (typeof title === "string" ? null : (title.raw ?? null));

function targetOf(item: WpMenuItem): MenuTarget {
  if (item.type === "taxonomy" && item.object === TAXONOMY.category) return { kind: "category", id: item.object_id };
  if (item.type === "taxonomy" && item.object === TAXONOMY.brand) return { kind: "brand", id: item.object_id };
  if (item.type === "post_type" && item.object === "page") return { kind: "page", id: item.object_id };
  if (item.type === "custom") return { kind: "link", url: item.url };
  return { kind: "other", type: item.type, object: item.object, id: item.object_id };
}

export function menuItemOf(item: WpMenuItem): MenuItem {
  const label = rawLabel(item.title);
  return {
    id: item.id,
    parent: item.parent,
    order: item.menu_order,
    title: titleText(item.title) || (label ?? ""),
    // WordPress stores no label as "": the item then shows its target's name.
    label: label ? decodeEntities(label) : null,
    target: targetOf(item),
    url: item.url,
    invalid: item.invalid,
    extra: {
      newTab: item.target === "_blank",
      classes: item.classes.filter(Boolean),
      attrTitle: item.attr_title,
      // An item saved with no label gets " " as its description (wp_update_nav_menu_item): no description.
      description: item.description.trim(),
      xfn: item.xfn.filter(Boolean),
    },
  };
}

function summaryOf(menu: WpMenu, locations: WpLocations, count: number): MenuSummary {
  return {
    id: menu.id,
    name: decodeEntities(menu.name),
    slug: menu.slug,
    locations: menu.locations.map((slug) => ({ slug, name: locations[slug]?.description || slug })),
    count,
  };
}

/** The theme's places, each with the menu it shows, by the menus read with them. */
function placesOf(menus: readonly WpMenu[], locations: WpLocations): ThemePlace[] {
  const byId = new Map(menus.map((m) => [m.id, m]));
  return Object.entries(locations).map(([slug, place]): ThemePlace => {
    const menu = place.menu ? byId.get(place.menu) : undefined;
    return { slug, name: place.description || slug, menu: menu ? { id: menu.id, name: decodeEntities(menu.name) } : null };
  });
}

/** The item's target as WordPress takes it. */
function targetBody(target: MenuTarget): WpMenuItemBody {
  switch (target.kind) {
    case "category":
    case "brand":
      return { type: "taxonomy", object: TAXONOMY[target.kind], object_id: target.id };
    case "page":
      return { type: "post_type", object: "page", object_id: target.id };
    case "link":
      return { type: "custom", url: target.url };
    case "other":
      return { type: target.type as WpMenuItemBody["type"], object: target.object, object_id: target.id };
  }
}

function newItemBody(menuId: number, item: NewMenuItem): WpMenuItemBody {
  return {
    menus: menuId,
    ...targetBody(item.target),
    title: item.label ?? "",
    parent: item.parent,
    menu_order: item.order,
    ...(item.extra
      ? {
          target: item.extra.newTab ? "_blank" : "",
          classes: item.extra.classes,
          attr_title: item.extra.attrTitle,
          description: item.extra.description,
          xfn: item.extra.xfn,
        }
      : {}),
  };
}

function changeBody(change: MenuItemChange): WpMenuItemBody {
  return {
    ...(change.parent !== undefined ? { parent: change.parent } : {}),
    ...(change.order !== undefined ? { menu_order: change.order } : {}),
    // "" = back to the target's own name, as WordPress's editor saves an emptied label.
    ...(change.label !== undefined ? { title: change.label ?? "" } : {}),
  };
}

const done = (outcome: BatchOutcome): Outcome<null> => (outcome.ok ? { ok: true, value: null } : outcome);

export function wordpressMenus(): MenuSource {
  return {
    kind: "wordpress",
    async menus() {
      const [menus, locations, items] = await Promise.all([wp.menus(), wp.locations(), wp.itemMenus()]);
      const counts = new Map<number, number>();
      for (const item of items) counts.set(item.menus, (counts.get(item.menus) ?? 0) + 1);
      return menus.map((m) => summaryOf(m, locations, counts.get(m.id) ?? 0));
    },
    async menu(id) {
      const [menus, locations, items] = await Promise.all([wp.menus(), wp.locations(), wp.menuItems(id)]);
      const menu = menus.find((m) => m.id === id);
      if (!menu) throw new VetrinaError("not_found", `No menu ${id} on the site.`, 404);
      return { ...summaryOf(menu, locations, items.length), items: items.map(menuItemOf) } satisfies Menu;
    },
    async pages() {
      return (await wp.pages()).map((p) => ({ id: p.id, title: titleText(p.title), parent: p.parent, url: p.link }));
    },
    async create(menuId, items) {
      const outcomes = await wp.createMenuItems(items.map((item) => newItemBody(menuId, item)));
      return outcomes.map((o): Outcome<MenuItem> => (o.ok ? { ok: true, value: menuItemOf(itemOf(o.body)) } : o));
    },
    async update(changes) {
      return (await wp.updateMenuItems(changes.map((c) => ({ id: c.id, body: changeBody(c) })))).map(done);
    },
    async remove(ids) {
      return (await wp.deleteMenuItems(ids)).map(done);
    },
    async everything() {
      const [menus, locations, items] = await Promise.all([wp.menus(), wp.locations(), wp.allItems()]);
      const counts = new Map<number, number>();
      for (const item of items) counts.set(item.menus, (counts.get(item.menus) ?? 0) + 1);
      return {
        menus: menus.map((m) => summaryOf(m, locations, counts.get(m.id) ?? 0)),
        items: items.map((item) => ({ ...menuItemOf(item), menuId: item.menus })),
      };
    },
    async overview() {
      const [menus, locations, items] = await Promise.all([wp.menus(), wp.locations(), wp.itemMenus()]);
      const counts = new Map<number, number>();
      for (const item of items) counts.set(item.menus, (counts.get(item.menus) ?? 0) + 1);
      return { menus: menus.map((m) => summaryOf(m, locations, counts.get(m.id) ?? 0)), places: placesOf(menus, locations) };
    },
    async menuAndPlaces(id) {
      const [menus, locations, items] = await Promise.all([wp.menus(), wp.locations(), wp.menuItems(id)]);
      const menu = menus.find((m) => m.id === id);
      if (!menu) throw new VetrinaError("not_found", `No menu ${id} on the site.`, 404);
      return { menu: { ...summaryOf(menu, locations, items.length), items: items.map(menuItemOf) }, places: placesOf(menus, locations) };
    },
    async places() {
      const [menus, locations] = await Promise.all([wp.menus(), wp.locations()]);
      return placesOf(menus, locations);
    },
    async createMenu(name) {
      const made = await wp.createMenu(name);
      return { id: made.id, name: decodeEntities(made.name), slug: made.slug, locations: [], count: 0 };
    },
    async renameMenu(id, name) {
      await wp.updateMenu(id, { name });
    },
    async deleteMenu(id) {
      await wp.deleteMenu(id);
    },
    async setPlace(slug, menuId) {
      // A place is set through a menu's own list of places: the menu put there gets it (taken from whichever had it),
      // or the menu there loses it.
      const menus = await wp.menus();
      if (menuId != null) {
        const menu = menus.find((m) => m.id === menuId);
        if (!menu) throw new VetrinaError("not_found", `No menu ${menuId} on the site.`, 404);
        if (!menu.locations.includes(slug)) await wp.updateMenu(menu.id, { locations: [...menu.locations, slug] });
      } else {
        const holder = menus.find((m) => m.locations.includes(slug));
        if (holder) await wp.updateMenu(holder.id, { locations: holder.locations.filter((l) => l !== slug) });
      }
      // Read back: a write WordPress answered without changing the place (a theme or a plugin in the way) is no success.
      const now = (await wp.locations())[slug]?.menu ?? 0;
      if (now !== (menuId ?? 0)) {
        throw new VetrinaError("failed", `WordPress answered, but the place ${slug} shows menu ${now || "none"} instead of ${menuId ?? "none"}.`);
      }
    },
  };
}
