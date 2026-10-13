import type { termIt } from "./term.it";

/** A count as the owner reads it: "1,234". */
const n = (count: number) => count.toLocaleString("en-GB");

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
    makeHint: "Products come and go on their own, by a rule: for example every product tagged “sale”.",
    inHomepage: (section: string) => `On the homepage: ${section}`,
    notInHomepage: "Not on the homepage",
    soldOut: (count: number) => `${n(count)} sold out`,
    hidden: (count: number) => `${n(count)} hidden`,
    onSale: (count: number) => `${n(count)} on sale`,
    allGood: "Everything in stock and visible",
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
    hidden: { title: "Hidden", hint: "Hidden by the shop: they show neither in the site's lists nor in its search." },
    nophoto: { title: "No photo", hint: "They show with an empty image on the site: add a photo from WordPress." },
    nocategory: { title: "No category", hint: "They can't be found on the site by browsing the categories." },
    unpublished: { title: "Not published", hint: "Drafts, products in review and private ones: not visible on the site." },
  },

  errors: {
    category: "This category is no longer in the shop.",
    brand: "This brand is no longer in the shop.",
  },
};
