import type { sectionsIt } from "./sections.it";

/** English strings for the homepage's sections; same shape as ./sections.it.ts. */

const n = (count: number) => count.toLocaleString("en-GB");

const products = (count: number) => (count === 1 ? "1 product" : `${n(count)} products`);

export const sectionsEn: typeof sectionsIt = {
  shows: {
    label: "Shows",
    category: (name: string) => `Category “${name}”`,
    brand: (name: string) => `Brand “${name}”`,
    tag: (name: string) => `Products tagged “${name}”`,
    terms: (names: string) => `Several categories: ${names}`,
    fixed: "A fixed list of products",
    list: {
      recent: "What's new across the shop",
      best_selling: "The shop's best sellers",
      sale: "Everything on sale",
      featured: "The featured products",
      top_rated: "The shop's best rated",
    },
    count: (all: number, visible: number) =>
      all === visible ? products(all) : `${products(all)} · ${n(visible)} visible`,
    visible: (count: number) => (count === 1 ? "1 product visible" : `${n(count)} products visible`),
    change: "Change",
    changeLabel: (title: string) => `Change what “${title}” shows`,
  },

  switch: {
    label: "Visible on the site",
    on: "The section shows on the homepage.",
    off: "Switched off: it stays here with its products, but the site does not show it.",
    offBadge: "Off",
    turnOff: "Switch off on the site",
    turnOn: "Switch on again",
    turnedOff: (title: string) => `“${title}” switched off: no longer on the site`,
    turnedOn: (title: string) => `“${title}” back on the site`,
    draftOff: "Section switched off: publish to take it off the site",
    draftOn: "Section switched on: publish to put it back on the site",
  },

  pick: {
    title: "What the section shows",
    tabs: { category: "Categories", brand: "Brands", list: "Lists" },
    tabsLabel: "Choose from",
    search: { category: "Search a category", brand: "Search a brand" },
    lists: {
      recent: { title: "New in", hint: "The latest arrivals across the shop: it keeps itself up to date." },
      best_selling: { title: "Best sellers", hint: "The products that sell the most: it keeps itself up to date." },
      sale: { title: "On sale", hint: "Everything on sale right now." },
      featured: { title: "Featured", hint: "The products marked “featured” in WordPress." },
      top_rated: { title: "Best rated", hint: "The products with the best reviews." },
    },
    listsIntro: "A list takes its products from the whole shop, with no category to keep up to date.",
    current: "Now",
    automatic: "Automatic",
    empty: "Nothing by that name",
    loading: "Loading categories and brands…",
    failed: "Can't read the categories and brands.",
    products,
    inHomepage: (titles: string) => `Already on the homepage: ${titles}`,
  },

  change: {
    title: "Change what it shows",
    loading: "Checking what changes…",
    failed: "Can't check what changes.",
    keptPins: (count: number) =>
      count === 1 ? "1 pinned product is there too: it keeps its place." : `${n(count)} pinned products are there too: they keep their places.`,
    droppedPins: (count: number) =>
      count === 1 ? "1 pinned product is not there: it is unpinned." : `${n(count)} pinned products are not there: they are unpinned.`,
    droppedHidden: (count: number) =>
      count === 1 ? "1 hidden product is not there any more: no need to hide it." : `${n(count)} hidden products are not there any more: no need to hide them.`,
    alsoIn: (titles: string) => `The homepage already shows it in: ${titles}.`,
    button: (text: string, name: string) => `The “${text}” button will open “${name}”'s page.`,
    titleField: "Section title",
    suggest: (title: string) => `Use “${title}”`,
    draftLost: (count: number) =>
      count === 1 ? "You have 1 unpublished change: it will be lost." : `You have ${n(count)} unpublished changes: they will be lost.`,
    start: (name: string) => `Show “${name}”`,
    done: (name: string) => `The section now shows “${name}”`,
    undone: "Section as it was",
  },

  add: {
    open: "New section",
    title: "New section",
    where: "Where",
    whereTop: "At the top, before all of them",
    whereAfter: (title: string) => `After “${title}”`,
    eyebrowField: "Eyebrow (optional)",
    eyebrowPlaceholder: "E.g. Exclusive selection",
    size: "Products shown",
    start: "Add to the homepage",
    done: (title: string) => `“${title}” added to the homepage`,
    removedAgain: "Section removed",
    hint: "The section shows on the site at once. Then choose which products go on top.",
  },

  remove: {
    open: "Remove from the homepage",
    confirm: (title: string) =>
      `Remove “${title}” from the homepage? The products stay in the shop, and “Undo” puts the section back as it was.`,
    yes: "Remove",
    no: "Cancel",
    done: (title: string) => `“${title}” removed from the homepage`,
    back: (title: string) => `“${title}” back on the homepage`,
  },

  arrange: {
    open: "Move sections",
    title: "Move sections",
    intro: "Drag by the handle or use the arrows: banners, sliders and logos stay where they are.",
    up: (title: string) => `Move “${title}” up`,
    down: (title: string) => `Move “${title}” down`,
    moveUp: "Move up",
    moveDown: "Move down",
    save: "Save",
    nothing: "No moves to save",
    done: "Sections moved",
    undone: "Sections back as they were",
    off: "off",
  },

  auto: {
    title: "After the pinned ones, automatically",
    shop: (name: string) => `“Shop” follows the products' positions on “${name}”'s page in the shop.`,
    shopAny: "“Shop” follows the positions products have in the shop.",
    arrange: (name: string) => `Arrange “${name}” by hand`,
    ranking: "Arrange like a ranking…",
    moved: (label: string) => `After the pinned ones, now automatically: ${label}`,
  },

  menu: {
    open: (title: string) => `Actions for “${title}”`,
    edit: "Open the section",
    addProducts: "Add products",
    change: "Change what it shows…",
    addBelow: "New section below",
    viewSite: "View on the site",
    cancel: "Cancel",
  },
  quick: {
    add: "Add products",
    edit: "Edit",
  },

  undo: "Undo",
  undoFailed: "Can't undo: the homepage changed meanwhile.",
  outdated: "Adding, moving and changing sections from here needs the Golden Hive Blocks plugin 5.15.0 on the site.",
};
