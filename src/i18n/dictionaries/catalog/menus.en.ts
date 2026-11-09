import type { menusIt } from "./menus.it";

/** English strings for the Vetrina's "Menus" tab; same shape as ./menus.it.ts. */

const n = (count: number) => count.toLocaleString("en-GB");
const items = (count: number) => (count === 1 ? "1 item" : `${n(count)} items`);

export const menusEn: typeof menusIt = {
  title: "Menus",
  intro: "Your site's menus, as the theme shows them: tap a menu to arrange its items.",
  shownIn: (places: string) => `On the site in: ${places}`,
  shownNowhere: "The theme shows it nowhere",
  items,
  empty: "The site has no menus: make one in WordPress (Appearance › Menus), then come back.",
  errors: {
    not_configured:
      "The site's menus are not connected: they need access to WordPress (WP_APP_USER and WP_APP_PASSWORD) and WordPress 5.9 or later. Ask whoever runs the server.",
    unauthorized: "WordPress refused access: the application password is wrong, or its user is not an administrator.",
    not_found: "This menu is no longer on the site.",
    failed: "WordPress is not answering. Try again in a moment.",
  },
  back: "Menus",

  menu: {
    add: "Add items",
    emptyMenu: "The menu is empty: add its first item.",
    kinds: { category: "Category", brand: "Brand", page: "Page", link: "Link", other: "From WordPress" },
    renamed: "renamed",
    invalid: "Gone: the site does not show it",
    actionsFor: (title: string) => `Actions for “${title}”`,
  },

  actions: {
    moveUp: "Move up",
    moveDown: "Move down",
    indent: (above: string) => `Put under “${above}”`,
    outdent: (parent: string) => `Take out of “${parent}”`,
    addBelow: "Add items under it",
    rename: "Rename",
    open: "Open on the site",
    remove: "Remove from the menu",
    cancel: "Close",
  },

  remove: {
    title: "Remove from the menu",
    confirm: (title: string, children: number) =>
      children === 0 ? `“${title}” leaves the menu. What it leads to stays in the shop.` : `“${title}” leaves the menu; its ${items(children)} take its place.`,
    yes: "Remove",
    no: "Keep",
  },

  done: {
    added: (names: readonly string[]) => (names.length === 1 ? `“${names[0]}” added to the menu` : `${items(names.length)} added to the menu`),
    moved: (title: string) => `“${title}” moved`,
    removed: (title: string) => `“${title}” removed from the menu`,
    renamed: (title: string) => `Now called “${title}”`,
    ownName: "Back to its own name",
    undone: "Menu as it was",
  },
  undo: "Undo",

  add: {
    title: "Add items",
    whereEnd: "At the bottom of the menu",
    whereUnder: (parent: string) => `Under “${parent}”, at the bottom`,
    tabs: { category: "Categories", brand: "Brands", page: "Pages", link: "Link" },
    tabsLabel: "What to add",
    search: { category: "Search a category", brand: "Search a brand", page: "Search a page" },
    inMenu: "already in the menu",
    empty: "Nothing to show.",
    loading: "Loading…",
    failed: "Could not read the list.",
    link: {
      url: "Address",
      urlHint: "https://…, a path in the shop (/sale/) or # for an item that only opens its own items",
      label: "Name in the menu",
      badUrl: "Write an address starting with https://, / or #.",
      needLabel: "Write the name the menu will show.",
    },
    button: (count: number) => (count === 0 ? "Pick what to add" : `Add ${items(count)}`),
  },

  rename: {
    title: (title: string) => `Rename “${title}”`,
    label: "Name in the menu",
    own: (name: string) => `Use its own name: “${name}”`,
    save: "Save",
    needLabel: "Write the name the menu will show.",
  },
};
