import type { termsIt } from "./terms.it";

/** English strings for a category's or brand's own actions; same shape as ./terms.it.ts. */

const n = (count: number) => count.toLocaleString("en-GB");

export const termsEn: typeof termsIt = {
  menu: {
    rename: "Rename",
    newChild: { category: "New sub-category", brand: "New line of the brand" },
    move: "Move under…",
    merge: "Merge into…",
    delete: { category: "Delete the category", brand: "Delete the brand" },
  },
  name: {
    rename: (name: string) => `Rename “${name}”`,
    create: { category: (parent: string) => `New sub-category of “${parent}”`, brand: (parent: string) => `New line of “${parent}”` },
    label: "Name",
    renameHint: "Its address on the site stays the same.",
    save: "Save",
    make: "Make",
    needName: "Write a name.",
  },
  pick: {
    move: (name: string) => `Move “${name}” under…`,
    merge: (name: string) => `Merge “${name}” into…`,
    top: "To the top level",
    search: { category: "Search a category", brand: "Search a brand" },
    empty: "Nothing to show.",
    loading: "Loading…",
    failed: "Could not read the list.",
  },
  confirm: {
    move: (name: string, into: string | null) => (into ? `Move “${name}” under “${into}”` : `Move “${name}” to the top level`),
    merge: (name: string, into: string) => `Merge “${name}” into “${into}”`,
    delete: (name: string) => `Delete “${name}”`,
    moveButton: "Move",
    mergeButton: (count: number | null) => (count ? `Merge · ${count === 1 ? "1 product" : `${n(count)} products`}` : "Merge"),
    deleteButton: (count: number | null) => (count ? `Delete · ${count === 1 ? "1 product" : `${n(count)} products`}` : "Delete"),
    background: "The products move one by one, in the background: the progress is at the bottom, and Activity can undo it.",
    other: "Choose another",
  },
  done: {
    renamed: (name: string) => `It is called “${name}” now`,
    created: { category: (name: string) => `Category “${name}” made`, brand: (name: string) => `Brand “${name}” made` },
    moved: { category: (name: string) => `Category “${name}” moved`, brand: (name: string) => `Brand “${name}” moved` },
    undone: "As it was",
  },
  undo: "Undo",
};
