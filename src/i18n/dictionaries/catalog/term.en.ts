import type { termIt } from "./term.it";

/** A count as the owner reads it: "1,234". */
const n = (count: number) => count.toLocaleString("en-GB");

/** "“Adidas”", "“Adidas” and “Nike”", "“Adidas”, “Nike” and 2 more". */
function quoted(names: readonly string[], shown = 2): string {
  const list = names.slice(0, shown).map((name) => `“${name}”`);
  const more = names.length - list.length;
  if (more > 0) return `${list.join(", ")} and ${more === 1 ? "one more" : `${n(more)} more`}`;
  return list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export const termEn: typeof termIt = {
  catalog: "Catalog",
  back: "Back",
  products: (count: number) => (count === 1 ? "1 product" : `${n(count)} products`),
  backTo: (name: string) => `Back to ${name}`,
  backToCatalog: "Back to the catalog",
  searchIn: (name: string) => `Search in ${name}`,
  searchView: "Search this list",
  searchAll: (q: string) => `Search “${q}” in the whole catalog`,

  panel: {
    automatic: (rule: string) => `Automatic: ${rule}`,
    automaticSample: "tagged “saldi” and in stock",
    makeHint: "Products come and go on their own, by a rule: for example every product tagged “sale”.",
    inHomepage: (section: string) => `On the homepage: ${section}`,
    notInHomepage: "Not on the homepage",
    soldOut: (count: number) => `${n(count)} sold out`,
    hidden: (count: number) => `${n(count)} hidden`,
    onSale: (count: number) => `${n(count)} on sale`,
    allGood: "Everything in stock and visible",

    visible: "Visible in the shop",
    visibleHint: "Turn it off and its products disappear from the shop; their links keep working.",
    hiddenOneByOne: (count: number) => `${n(count)} hidden one by one`,
    allHiddenOneByOne: "All hidden one by one: turn it on to show them.",
    heldBy: (count: number, terms: readonly string[]) =>
      `${count === 1 ? "1 stays" : `${n(count)} stay`} hidden by ${quoted(terms)}`,
    hiding: (done: number, total: number) => `${total === 1 ? "Hiding it" : "Hiding them"}… ${n(done)}/${n(total)}`,
    waiting: "Waiting: it starts as soon as the action before it ends.",
    hiddenSince: (when: string, count = 2) =>
      count === 1
        ? `Hidden by you · ${when}. Turn it on and it goes back as it was.`
        : `Hidden by you · ${when}. Turn it on and they go back as they were.`,
    hiddenPartly: (changed: number, total: number) =>
      `Partly hidden: ${n(changed)} of ${n(total)}. Turn it on and they go back as they were.`,
    showing: (count = 2) => (count === 1 ? "Putting it back as it was…" : "Putting them back as they were…"),
    showingAll: (done: number, total: number) => `${total === 1 ? "Showing it" : "Showing them"} again… ${n(done)}/${n(total)}`,
    showHidden: (count: number) => (count === 1 ? "Show the hidden one" : `Show the ${n(count)} hidden`),
    hideAdded: (count: number) => (count === 1 ? "Hide the one added since too" : `Hide the ${n(count)} added since too`),
    hideAddedHint: "Added later: they hide by themselves within a few minutes, or right away from here.",
    hidingAdded: "Hiding them…",
    hiddenOf: (count: number, name: string) =>
      `${count === 1 ? "1 hidden product" : `${n(count)} hidden products`} of “${name}”`,

    sale: "Sale",
    saleStart: "Put on sale",
    saleHint: "A discount on all its products, with or without an end date.",
    saleOthers: (count: number) => (count === 1 ? "1 already on sale on its own" : `${n(count)} already on sale on their own`),
    saleOn: (percent: number) => `Sale −${percent}%`,
    saleUntil: (day: string) => `Until ${day}`,
    saleNoEnd: "No end date: it stays until you end it",
    saleRunning: (done: number, total: number) => `Applying it… ${n(done)}/${n(total)}`,
    saleUndoing: "Ending it…",
    saleMenu: (percent: number, name: string) => `Sale −${percent}% on “${name}”`,
    saleChange: "Change the discount",
    saleStop: "End the sale",
    saleStopHint: "Ending it puts all its products back to full price.",
    saleUndo: "Undo this sale",
    saleUndoBack: (percent: number) => `Undo the change: back to −${percent}%`,
    saleUndoBackEnd: (day: string | null) => (day ? `Undo the change: until ${day} again` : "Undo the change: no end again"),
    cancel: "Cancel",
    stateFailed: "Couldn't read whether it is hidden or on sale.",
    retry: "Try again",
  },

  menu: {
    open: "More actions",
    saveRule: "Save as an automatic category",
    activity: "Activity",
    cancel: "Cancel",
  },

  children: { category: "Subcategories", brand: "Brand lines" },

  filters: {
    label: "Filters",
    all: "All",
    instock: "In stock",
    outofstock: "Sold out",
    hidden: "Hidden",
    onsale: "On sale",
    withinLabel: { category: "Brands", brand: "Categories" },
    withinAll: { category: "All brands", brand: "All categories" },
  },

  sort: {
    button: (label: string) => `Sort: ${label}`,
    title: "Sort by",
    cancel: "Cancel",
    options: {
      shop: "Shop",
      newest: "Newest",
      bestselling: "Best sellers",
      priceAsc: "Price, low to high",
      priceDesc: "Price, high to low",
      name: "Name",
    },
  },

  list: {
    loadMore: "Load more",
    loadingMore: "Loading more products…",
    failed: "Couldn't load the products.",
    moreFailed: "Couldn't load more products.",
    retry: "Try again",
    reloadFailed: "Couldn't refresh the list: try again shortly.",
    empty: "No products here",
    emptySearch: (q: string) => `No products for “${q}”`,
    emptyFiltered: "No products left with these filters.",
    clearFilters: "Clear filters",
  },

  row: {
    section: (title: string, position: number) => `${title} #${position}`,
    sectionLabel: (title: string, position: number, pinned: boolean) =>
      `On the homepage: ${title}, position ${position}${pinned ? ", pinned" : ""}`,
    moreSections: (count: number) => `+${count}`,
    locked: "Price locked",
    noPhoto: "No photo",
    hidden: "Hidden",
    soldOut: "Sold out",
    onSale: "On sale",
    status: {
      draft: "Draft",
      pending: "In review",
      private: "Private",
      future: "Scheduled",
      other: "Not published",
    } as Record<string, string>,
  },

  views: {
    soldout: { title: "Sold out", hint: "No size available: they can't be bought on the site." },
    onsale: { title: "On sale", hint: "Products with a discounted price right now." },
    hidden: { title: "Hidden", hint: "Hidden from the shop: they show neither in the site's lists nor in its search." },
    nophoto: { title: "No photo", hint: "They show with an empty image on the site: add a photo from WordPress." },
    nocategory: { title: "No category", hint: "They can't be found on the site by browsing the categories." },
    unpublished: { title: "Not published", hint: "Drafts, products in review and private ones: not visible on the site." },
  },

  viewsEmpty: {
    soldout: { title: "Nothing sold out", text: "Everything in the shop can be bought." },
    onsale: { title: "Nothing on sale", text: "For a sale, pick the products from a category or a brand." },
    hidden: { title: "Nothing hidden", text: "Everything shows in the shop." },
    nophoto: { title: "Every product has a photo", text: "No empty images in the shop." },
    nocategory: { title: "Every product has a category", text: "They can all be found by browsing the shop." },
    unpublished: { title: "Nothing to publish", text: "No drafts or pending products: everything is online." },
  },

  errors: {
    category: "This category is no longer in the shop.",
    brand: "This brand is no longer in the shop.",
  },
};
