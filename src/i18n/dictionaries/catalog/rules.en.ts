import type { rulesIt } from "./rules.it";

const n = (count: number) => count.toLocaleString("en-GB");

export const rulesEn: typeof rulesIt = {
  title: "New automatic category",
  fromList: (name: string) => `From the filters of “${name}”`,
  intro: "A real category of the shop that fills itself: the Hub adds and removes products by the rule.",
  name: "Name",
  namePlaceholder: "E.g. Nike on sale",
  parent: "Inside",
  topLevel: "None (top level)",
  rule: "The rule",

  notes: {
    hidden: "The “Hidden” filter stays out: a rule does not look at whether a product is hidden.",
    search: "The search becomes “the name contains”: the SKU does not count.",
  },

  nameTaken: (name: string) =>
    `“${name}” already exists here: pick another name. To make that one automatic, open it from the catalog.`,
  nameFirst: "Write the category's name",
  save: "Create and apply",
  saving: "Creating the category…",
  applying: (name: string) => `Putting the products in “${name}”…`,
  created: (name: string, moved: number) =>
    moved === 0
      ? `“${name}” is ready: no products for now.`
      : moved === 1
        ? `“${name}” is ready: 1 product in it.`
        : `“${name}” is ready: ${n(moved)} products in it.`,
  slow: (name: string) => `“${name}” is saved: the products arrive shortly.`,
  failed: (error: string) => `Didn't work: ${error}`,
  open: "Open",
  loading: "Loading the shop's categories and tags…",
  loadFailed: "Couldn't read the shop's categories.",
  network: "Can't reach the server: try again shortly.",
  retry: "Try again",
};
