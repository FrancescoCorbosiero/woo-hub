import type { homeIt } from "./home.it";

export const homeEn: typeof homeIt = {
  title: "Catalog",
  tabs: { homepage: "Homepage", catalog: "Catalog" },
  search: "Search the catalog",
  segments: { category: "Categories", brand: "Brands" },

  views: {
    soldout: "Sold out",
    onsale: "On sale",
    hidden: "Hidden",
    nophoto: "No photo",
    nocategory: "No category",
    unpublished: "Not published",
  },
  viewsLabel: "Quick views",

  groups: {
    inHomepage: "On the homepage",
    automatic: "Automatic",
    allCategories: "All categories",
  },
  inHomepageMark: "On the homepage",
  order: {
    name: "A–Z",
    count: "By count",
    toName: "Sort from A to Z",
    toCount: "Sort by number of products",
  },
  showEmpty: (n: number) => (n === 1 ? "Show 1 empty" : `Show ${n} empty`),
  hideEmpty: "Hide the empty ones",
  showEmptyBrands: (n: number) => (n === 1 ? "Show 1 empty brand" : `Show ${n} empty brands`),
  hideEmptyBrands: "Hide the empty brands",
  noCategories: "The shop has no categories yet.",
  noBrands: "The shop has no brands yet.",
  soldOut: (n: number) => `${n} sold out`,
  hidden: (n: number) => `${n} hidden`,

  firstRead: {
    title: "Reading the shop…",
    body: "The first time takes a few seconds. The page updates by itself.",
    retry: "Try again",
  },

  results: {
    categories: "Categories",
    brands: "Brands",
    products: "Products",
    none: (q: string) => `No results for “${q}”`,
    hint: "Search by name or SKU: every word counts, in any order.",
    showAll: (n: number) => `Show all ${n} products`,
    showMore: (n: number) => (n === 1 ? "Show the last one" : `Show ${n} more`),
    failed: "The search didn't work.",
    retry: "Try again",
  },
};
