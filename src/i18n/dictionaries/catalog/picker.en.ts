import type { pickerIt } from "./picker.it";

/** English strings for adding products to a section; same shape as ./picker.it.ts. */

const n = (count: number) => count.toLocaleString("en-GB");

export const pickerEn: typeof pickerIt = {
  open: "Add",
  listTitle: "The section's products",
  openLong: "Add products from the catalog",
  openLabel: (section: string) => `Add products to “${section}”`,
  title: (section: string) => `Add to “${section}”`,
  intro: {
    category: (name: string) => `Choose from the catalog: those not in “${name}” join it when you publish.`,
    automatic: (name: string) => `What meets its rule joins “${name}”: choose among its products which go on top.`,
    brand: (name: string) => `The section shows “${name}”: choose among its products which go on top.`,
    sale: "The section shows the products on sale: choose which go on top.",
    list: "Choose from the catalog: they go on top of the section.",
  },
  search: "Search by name or SKU",
  sortLabel: "Show first",
  sort: { newest: "New", bestselling: "Best sellers", name: "A–Z" },
  filters: { instock: "In stock", onSale: "On sale" },
  filtersLabel: "Filters",
  shown: (position: number) => `In section · #${position}`,
  pinned: "Pinned here",
  joins: (name: string) => `Joins “${name}”`,
  soldOut: "Sold out: shows once it is back",
  hidden: "Hidden from the shop: won't show",
  picked: (count: number) => `${n(count)} chosen`,
  clear: "Clear all",
  loading: "Loading products…",
  loadMore: "Load more",
  loadingMore: "Loading more products…",
  failed: "Can't load the products.",
  retry: "Retry",
  empty: "No products here",
  emptySearch: (q: string) => `No products for “${q}”`,
  place: { label: "Where they go", top: "On top", afterPins: "After the pinned" },
  start: (count: number) =>
    count === 0 ? "Choose the products" : count === 1 ? "Add 1 product" : `Add ${n(count)} products`,
  room: (max: number) => `At most ${max} pinned products per section.`,
  added: (count: number) =>
    count === 1 ? "1 product added: publish to see it on the site" : `${n(count)} products added: publish to see them on the site`,
  newBadge: "New",
  willJoin: (name: string) => `Joins “${name}” when you publish`,
  joining: (name: string) => `Adding to “${name}”…`,
  joinFailed: "Couldn't put them in the category: the section was not published. Try again.",
};
