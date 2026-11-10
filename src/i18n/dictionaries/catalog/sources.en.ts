import type { sourcesIt } from "./sources.it";

/** A count as the owner reads it: "1,234". */
const n = (count: number) => count.toLocaleString("en-GB");

export const sourcesEn: typeof sourcesIt = {
  title: "Rankings",
  open: "Rankings from other shops",
  row: (count: number) => (count === 0 ? "Arrange the products like another shop" : count === 1 ? "1 ranking" : `${n(count)} rankings`),
  intro:
    "A ranking is how another shop lines up its products, taken from one of its collection or category pages (not its homepage: it is not there). On a category, a brand or the whole catalog, “Arrange like…” puts its products first, one after the other as there; the others follow.",
  empty: "No ranking yet.",
  add: "Add a ranking",
  loading: "Loading the rankings…",
  matched: (matched: number, items: number) =>
    items === 1 ? (matched === 1 ? "1 product, in the shop" : "1 product, not in the shop") : `${n(matched)} of ${n(items)} products in the shop`,
  updated: (when: string) => `updated ${when}`,

  origin: "Where it comes from",
  applyAll: "Arrange the whole catalog like this",
  applyAllHint: "A ranking is usually one collection: use it on the category that matches it, from its page: “Positions in the shop” › “Arrange like…”.",
  edit: "Edit or replace the ranking",
  remove: "Delete the ranking",
  removeConfirm: (name: string) => `Delete “${name}”? The products already arranged like it stay where they are.`,
  removeYes: "Delete",
  removeNo: "Cancel",
  removed: (name: string) => `“${name}” deleted`,
  unmatched: "Not found in the shop",
  unmatchedHint: "The shop does not have them, or the name is not enough to tell which product they are: they are left out.",
  unmatchedMore: (count: number) => (count === 1 ? "and one more" : `and ${n(count)} more`),
  ambiguous: "several products possible",
  allMatched: "Every product of the ranking is in the shop.",

  newTitle: "New ranking",
  editTitle: "Edit the ranking",
  name: "Name",
  namePlaceholder: "E.g. Kith — Nike Dunk",
  originLabel: "Where it comes from",
  originPlaceholder: "The collection's or the category's link (optional)",
  originHomepage: "This looks like the homepage: how a shop lines up its products is read on a collection's or a category's page (on Shopify: /collections/…).",
  text: "Ranking",
  textPlaceholder: "Paste the LLM's answer here (JSON) — several answers, one after another —, a CSV with “sku” and “name”, or one product per line…",
  textKeep: "Leave empty to keep the current ranking.",
  file: "Upload a file",
  fileFailed: "Cannot read the file.",
  promptCopy: "Copy LLM instructions",
  promptCopied: "Instructions copied: paste them into the LLM with the collection's or the category's link, then paste its answer here.",
  promptFailed: "Cannot copy: press and hold the text below to copy it.",
  promptShow: "Show the instructions",
  checking: "Reading the ranking…",
  checkSummary: (matched: number, items: number) =>
    `${n(items)} ${items === 1 ? "product" : "products"} in the ranking: ${matched === items ? (items === 1 ? "it is in the shop" : "all in the shop") : `${n(matched)} in the shop`}.`,
  duplicates: (count: number) => (count === 1 ? "1 repeated, counted once." : `${n(count)} repeated, counted once.`),
  parts: (count: number) => `${n(count)} answers joined, one after the other as you pasted them.`,
  truncated:
    "The answer stops halfway: it is read up to the last whole product. Write “continue” to the LLM and paste its new answer here too, after this one.",
  save: "Save the ranking",
  saved: (name: string) => `“${name}” saved`,

  use: (name: string) => `Arrange like “${name}”`,
  manage: "Rankings…",
  rankAs: (term: string) => `Arrange “${term}” like…`,
  none: "No ranking yet: add one.",
  apply: {
    title: (name: string) => `Like “${name}”`,
    whole: "The whole catalog",
    intro: "The ranking's products go to the top, one after the other as there; the others follow, as they are.",
    start: (count: number) => (count === 1 ? "Move 1 product" : `Move ${n(count)} products`),
    plain: "Apply",
  },

  compare: {
    open: "Compare with the shop",
    openHint: "Prices that differ, products missing, pairings to check.",
    subtitle: "Compared with the shop",
    back: "Catalog",
    summary: (matched: number, items: number) => `${n(matched)} of ${n(items)} products in the shop`,
    threshold: (threshold: number) => `Prices that differ: by more than ${n(threshold)}%, not by the cents.`,
    filter: "Show",
    tabs: {
      prices: "Prices differ",
      missing: "Missing",
      uncertain: "To check",
      all: "All",
    },
    theirs: "Theirs",
    ours: "Ours",
    gap: (gap: number) => `${gap > 0 ? "+" : gap < 0 ? "−" : ""}${Math.abs(gap).toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`,
    onSale: "on sale",
    notPublished: "not published",
    paired: "paired by hand",
    pairedNone: "marked as not in the shop",
    inCatalog: "in the Hub's catalog",
    noSku: "no code",
    several: "several products possible",
    notInShop: "not in the shop",
    empty: {
      prices: "No price is off by more than the threshold.",
      pricesUnknown: "The ranking has no prices: ask the LLM for them (the instructions now include them) and replace the ranking with its new answer.",
      missing: "The shop has every product of the ranking.",
      uncertain: "No pairing to check.",
    },
    pricesIntro:
      "The shop's price is its cheapest size's, as the site shows it. “Match” brings the cheapest size there and moves the others by the same amount: on the Hub's products as locked prices, which the sync keeps.",
    missingIntro:
      "“Import” makes them in the shop with Publish: sizes priced by the engine and the margins, photos queued. Those without a code are looked up on KicksDB first.",
    uncertainIntro: "Several of the shop's products could be these: pick which, or mark them as not in the shop.",
    allIntro: "The whole ranking, in its order. Tap an entry to change its pairing.",
    selectAll: "Select all",
    selectNone: "Deselect",
    selected: (count: number) => (count === 1 ? "1 selected" : `${n(count)} selected`),
    alignTitle: "Match the prices",
    align: (count: number) => (count === 1 ? "Match 1 price" : `Match ${n(count)} prices`),
    import: (count: number) => (count === 1 ? "Import 1 product" : `Import ${n(count)} products`),
    useOrder: "Arrange the whole catalog like this",
    lookup: "Look up on KicksDB",
    lookingUp: "Looking up on KicksDB…",
    lookupNone: "KicksDB has no product with such a name.",
    lookupPick: "Which one is it?",
    chosen: (sku: string) => `To import: ${sku}`,
    pairAction: "Pair by hand",
    more: (count: number) => `Show ${n(count)} more`,
    failed: "Cannot compare the ranking.",
    retry: "Retry",
    later: "The products made join the comparison within a couple of minutes: the shop's copy updates itself.",
    demo: "On the demo shop the comparison shows, but nothing is imported.",
    pair: {
      title: "Which product is it?",
      subtitle: (name: string) => `“${name}”, in the ranking`,
      candidates: "Similar names in the shop",
      search: "Search the shop",
      searchEmpty: "No product of the shop with this name.",
      current: "Paired now",
      none: "Not in the shop",
      noneHint: "It goes among the missing: it can be imported.",
      auto: "Automatic pairing",
      autoHint: "By code and by name, as the Hub does on its own.",
      done: (name: string) => `Paired with “${name}”`,
      doneNone: "Marked as not in the shop",
      doneAuto: "Automatic pairing back",
    },
    importSheet: {
      title: (count: number) => (count === 1 ? "Import 1 product" : `Import ${n(count)} products`),
      intro:
        "They are made in the shop with Publish, as from its tab: sizes priced by the engine and the margins, photos queued. A code KicksDB does not confirm is not published; one already in the shop stays as it is.",
      start: "Import",
      progress: (done: number, total: number) => `Importing… ${n(done)} of ${n(total)}`,
      created: "Made",
      skipped: "Left as they are",
      notFound: "Unknown to KicksDB",
      unreachable: "KicksDB did not answer: try again",
      failed: "Not made",
      reasons: {
        alreadyOnStore: "already in the shop",
        feedDelisted: "out of the supplier's feed",
        inProgress: "already being published",
        hiddenNoPhoto: "already in the shop, hidden for its photo",
      },
      sizes: (count: number) => (count === 1 ? "1 size" : `${n(count)} sizes`),
      stop: "Stop",
      close: "Done",
    },
  },

  llmPrompt: `You are an assistant that works out the order of the products on an online shop's collection or category page.

I give you the link of a page that lists the products of ONE collection or category (or a screenshot of that page: read it the same way): on Shopify an address with /collections/… (e.g. https://shop.com/collections/sneakers); on other shops a category's page (e.g. …/category/sneakers, …/c/sneakers). I need the order in which the shop shows the products on that page with its default sorting ("Featured", "Recommended"): do not reorder them yourself and do not pick another sorting.

If the link is the homepage, a single product's page or a search, do not give me the JSON: answer with one sentence asking me for the collection's or the category's link. The homepage does not say in which order the shop puts its products.

If the products go on over more pages (?page=2, "Next page", "Load more"), read them in order and carry on the list from where you were.

With a collection's or a category's link answer ONLY with valid JSON, no text before or after it, with this structure:

{
  "format": "woo-hub.order-source/1",
  "name": "<shop — collection, e.g. Kith — Nike Dunk>",
  "origin": "<the collection's or the category's link>",
  "items": [
    { "sku": "<the maker's style code>", "name": "<the product's full name>", "price": 129.99 }
  ]
}

Rules:
1. "items" follows the page's order: the first product shown is the first in the list. In a grid, read left to right, top to bottom.
2. "sku" is the maker's style code (e.g. DD1391-100 for Nike, IE3437 for adidas, 1203A537-100 for ASICS, U9060ZGB for New Balance). Put it only when it appears on the page or in the product's link; otherwise leave the field out: never make it up.
3. "name" is the name as written on the page: brand, model and colourway (e.g. "Nike Dunk Low Retro White Black Panda").
4. Each product once, even when the page repeats it.
5. "price" is the price the page shows for that product, as a number (e.g. 129.99): what it sells for now — when discounted, the discounted price; when "from €129", 129. When the page shows none, leave the field out.
6. No sizes or other fields: only "sku", "name" and "price".
7. With more than 150 products, give me the first 150 and close the JSON; when I write "continue", give me a new JSON with the next 150, and so on to the last.`,
};
