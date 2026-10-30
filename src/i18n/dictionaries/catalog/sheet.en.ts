import type { sheetIt } from "./sheet.it";

export const sheetEn: typeof sheetIt = {
  title: "In the shop",
  loading: "Loading where it is in the shop…",
  failed: "Couldn't see where it is in the shop.",
  notFound: "This product isn't in the catalog yet: if you just created it, it shows up in a few minutes.",
  retry: "Try again",

  status: {
    draft: "Draft",
    pending: "In review",
    private: "Private",
    future: "Scheduled",
    other: "Not published",
  },
  unpublished: "Customers can't see it on the site.",

  visibleSwitch: "Visible in the shop",
  shown: {
    visible: "Visible",
    catalog: "Only in the categories, not in search",
    search: "Only in search",
    hidden: "Hidden",
    unpublished: "Visible once published",
  },
  stock: {
    instock: "in stock",
    outofstock: "sold out",
    onbackorder: "on backorder",
  },
  linkOnly: "It opens only from its link.",
  hiding: "Hiding it…",
  showing: "Showing it again…",

  categories: "Categories",
  noCategories: "In no category",
  automatic: "automatic, decided by its rule",
  automaticHint: "Automatic: decided by its rule. The product comes and goes on its own and can't be taken out by hand.",
  deleteProduct: "Delete the product",
  fromFeed: "Comes from the GoldenSneakers feed: it can't be deleted, the feed would put it back. To take it out of sight, switch off “Visible in the shop”.",
  addCategory: "Category",
  addCategoryLabel: "Add to a category",
  removeCategory: (name: string) => `Take out of “${name}”`,
  removing: (name: string) => `Taking it out of “${name}”…`,
  brands: "Brands",
  noBrands: "No brand",
  homepage: "Homepage",
  notInHomepage: "Not on the homepage",
  pin: "Put on the homepage",
  section: (title: string, position: number) => `${title} #${position}`,
  sectionLabel: (title: string, position: number, pinned: boolean) =>
    `On the homepage: ${title}, position ${position}${pinned ? ", pinned" : ""}`,
  working: "working…",

  sale: {
    title: "Sale",
    none: "Not on sale",
    on: "On sale",
    price: (price: string) => `On the site: ${price}`,
    onNow: "Discounted price on the site",
    start: "Put on sale",
    stop: "End the sale",
    working: "Updating the sale…",
  },

  confirm: {
    cancel: "Cancel",
    loading: "Checking what changes…",
    starting: "Starting…",
    nothing: (why: string | null) => (why ? `Nothing changes: ${why}.` : "Nothing changes."),
    hide: {
      title: "Hide the product?",
      body: "It disappears from the shop, the categories and search; its link keeps working.",
      confirm: "Hide",
    },
    uncategorize: {
      title: (name: string) => `Take out of “${name}”?`,
      body: (name: string) => `It no longer shows among the products of “${name}”.`,
      confirm: "Take out",
    },
    delete: {
      title: "Delete the product?",
      body: "For a product you no longer sell. To only take it out of sight, switch off “Visible in the shop”.",
      confirm: "Delete",
    },
  },

  openInCatalog: "Open in the catalog",
};
