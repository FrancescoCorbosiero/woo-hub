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
  visible: "Visible in the shop",
  hidden: "Hidden from the shop — it opens only from its link",
  hiddenUnpublished: "Hidden from the shop",

  categories: "Categories",
  noCategories: "In no category",
  automatic: "automatic",
  automaticHint: "Automatic: the product comes and goes on its own, by the category's rule.",
  brands: "Brands",
  noBrands: "No brand",
  homepage: "Homepage",
  notInHomepage: "Not on the homepage",
  section: (title: string, position: number) => `${title} #${position}`,
  sectionLabel: (title: string, position: number, pinned: boolean) =>
    `On the homepage: ${title}, position ${position}${pinned ? ", pinned" : ""}`,

  openInCatalog: "Open in the catalog",
};
