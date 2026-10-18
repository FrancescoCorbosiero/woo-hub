import type { sourcesIt } from "./sources.it";

/** A count as the owner reads it: "1,234". */
const n = (count: number) => count.toLocaleString("en-GB");

export const sourcesEn: typeof sourcesIt = {
  title: "Order sources",
  open: "Order sources",
  row: (count: number) => (count === 0 ? "Use another shop's order" : count === 1 ? "1 source" : `${n(count)} sources`),
  intro:
    "A source is a ranking of the products taken from elsewhere: a shop's page, a marketplace's best sellers. On a category, a brand or the whole catalog, “Use the order of…” puts its products first, in that order; the others follow.",
  empty: "No source yet.",
  add: "Add a source",
  loading: "Loading the sources…",
  matched: (matched: number, items: number) =>
    items === 1 ? (matched === 1 ? "1 product, in the shop" : "1 product, not in the shop") : `${n(matched)} of ${n(items)} products in the shop`,
  updated: (when: string) => `updated ${when}`,

  origin: "Where it comes from",
  applyAll: "Use on the whole catalog",
  applyAllHint: "On one category or brand: from its page, “Sort” › “Use the order of…”.",
  edit: "Edit or replace the ranking",
  remove: "Delete the source",
  removeConfirm: (name: string) => `Delete “${name}”? The orders already applied stay as they are.`,
  removeYes: "Delete",
  removeNo: "Cancel",
  removed: (name: string) => `“${name}” deleted`,
  unmatched: "Not found in the shop",
  unmatchedHint: "The shop does not have them, or the name is not enough to tell which product they are: they are left out.",
  unmatchedMore: (count: number) => (count === 1 ? "and one more" : `and ${n(count)} more`),
  ambiguous: "several products possible",
  allMatched: "Every product of the source is in the shop.",

  newTitle: "New source",
  editTitle: "Edit the source",
  name: "Name",
  namePlaceholder: "E.g. StockX — best sellers",
  originLabel: "Where it comes from",
  originPlaceholder: "The page's link, or a few words (optional)",
  text: "Ranking",
  textPlaceholder: "Paste the LLM's answer here (JSON), a CSV with “sku” and “name”, or one product per line…",
  textKeep: "Leave empty to keep the current ranking.",
  file: "Upload a file",
  fileFailed: "Cannot read the file.",
  promptCopy: "Copy LLM instructions",
  promptCopied: "Instructions copied: paste them into the LLM with the page (link, text or screenshot), then paste its answer here.",
  promptFailed: "Cannot copy: press and hold the text below to copy it.",
  promptShow: "Show the instructions",
  checking: "Reading the ranking…",
  checkSummary: (matched: number, items: number) =>
    `${n(items)} ${items === 1 ? "product" : "products"} in the ranking: ${matched === items ? (items === 1 ? "it is in the shop" : "all in the shop") : `${n(matched)} in the shop`}.`,
  duplicates: (count: number) => (count === 1 ? "1 repeated, counted once." : `${n(count)} repeated, counted once.`),
  save: "Save the source",
  saved: (name: string) => `“${name}” saved`,

  use: (name: string) => `Use the order of “${name}”`,
  manage: "Order sources…",
  apply: {
    title: (name: string) => `Order of “${name}”`,
    whole: "The whole catalog",
    intro: "The source's products go to the top, in its order; the others follow, in theirs.",
    start: (count: number) => (count === 1 ? "Move 1 product" : `Move ${n(count)} products`),
    plain: "Apply",
  },

  llmPrompt: `You are an assistant that works out the order of the products on an online shop's page.

I give you a page (a link, its text or screenshots) that lists products (sneakers, clothing, accessories) in some order. Answer ONLY with valid JSON, no text before or after it, with this structure:

{
  "format": "woo-hub.order-source/1",
  "name": "<a short name for the source, e.g. Nike.com — New arrivals>",
  "origin": "<the page's link>",
  "items": [
    { "sku": "<the maker's style code>", "name": "<the product's full name>" }
  ]
}

Rules:
1. "items" follows the page's order: the first product shown is the first in the list. In a grid, read left to right, top to bottom.
2. "sku" is the maker's style code (e.g. DD1391-100 for Nike, IE3437 for adidas, 1203A537-100 for ASICS, U9060ZGB for New Balance). Put it only when it appears on the page or in the product's link; otherwise leave the field out: never make it up.
3. "name" is the name as written on the page: brand, model and colourway (e.g. "Nike Dunk Low Retro White Black Panda").
4. Each product once, even when the page repeats it.
5. No prices, sizes or other fields: only "sku" and "name".`,
};
