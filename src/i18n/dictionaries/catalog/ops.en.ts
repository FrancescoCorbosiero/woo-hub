import { MAX_OPERATION_PRODUCTS, MAX_TERM_PRODUCTS } from "@/lib/vetrina/catalog-ops";
import type { opsIt } from "./ops.it";

/** A sale's last day as the owner reads it: "31 October". */
const longDay = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

/** A count as the owner reads it: "1,234". */
const n = (count: number) => count.toLocaleString("en-GB");
const products = (count: number) => (count === 1 ? "1 product" : `${n(count)} products`);

/** "Nike", "Nike and Adidas", "Nike, Adidas and Puma", "Nike, Adidas and 3 more". */
function nameList(names: readonly string[], total = names.length): string {
  const more = total - names.length;
  if (more > 0) return `${names.join(", ")} and ${more === 1 ? "one more" : `${n(more)} more`}`;
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export const opsEn: typeof opsIt = {
  money: (amount: number): string => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(amount),
  products,
  nameList,

  label: {
    hide: (count: number, term: string | null) => `${count === 1 ? "1 product hidden" : `${n(count)} products hidden`}${term ? ` · ${term}` : ""}`,
    show: (count: number) => (count === 1 ? "1 product visible again" : `${n(count)} products visible again`),
    sale: (percent: number, what: string) => `Sale −${percent}% · ${what}`,
    saleEnds: (percent: number, what: string, endsOn: string | null) =>
      `Sale −${percent}% · ${what}: ${endsOn ? `now until ${longDay(endsOn)}` : "now with no end"}`,
    unsale: (what: string) => `Sale ended · ${what}`,
    tag: (tag: string, count: number) => `Tag “${tag}” on ${products(count)}`,
    untag: (tag: string, count: number) => `Tag “${tag}” off ${products(count)}`,
    categorize: (category: string, count: number) => `Category “${category}” on ${products(count)}`,
    uncategorize: (category: string, count: number) => `Category “${category}” off ${products(count)}`,
    pin: (count: number, section: string) => `${count === 1 ? "1 product pinned" : `${n(count)} products pinned`} in ${section}`,
    margin: (percent: number | null, what: string) => (percent == null ? `Own margin removed · ${what}` : `Margin ${percent}% · ${what}`),
    order: (count: number, term: string, position: number | null) =>
      `${products(count)} ${position === 1 ? "to the top" : position == null ? "to the bottom" : `to position ${n(position)}`} · ${term}`,
    reorder: (count: number, term: string) => `New order · ${term}: ${count === 1 ? "1 product moved" : `${n(count)} products moved`}`,
    sourceOrder: (count: number, source: string, what: string) =>
      `Order of “${source}” · ${what}: ${count === 1 ? "1 product moved" : `${n(count)} products moved`}`,
  },

  untouched: {
    gone: (_count: number) => "no longer in the shop",
    alreadyHidden: (_count: number) => "already hidden",
    alreadyVisible: (_count: number) => "already visible",
    noPrice: (_count: number) => "no price",
    notLower: (_count: number) => "the sale would not be lower",
    same: (_count: number) => "already on this sale",
    noSale: (_count: number) => "not on sale",
    hasTag: (count: number) => (count === 1 ? "already has the tag" : "already have the tag"),
    noTag: (count: number) => (count === 1 ? "does not have the tag" : "do not have the tag"),
    inCategory: (_count: number) => "already in the category",
    notInCategory: (_count: number) => "not in the category",
    automatic: (_count: number) => "the category is automatic",
    notInSection: (_count: number) => "not in this section",
    overMax: (_count: number, max: number) => `past the ${n(max)} pinned`,
    held: (count: number, terms: string[]) =>
      `${count === 1 ? "stays" : "stay"} hidden by ${nameList(terms.map((t) => `“${t}”`))}`,
    supplier: (_count: number) => "supplier's price (GoldenSneakers)",
    storeOnly: (_count: number) => "priced in the shop, not by the Hub",
    otherRule: (count: number) => (count === 1 ? "has a more specific margin" : "have a more specific margin"),
    noQuote: (_count: number) => "no market price",
    notInTerm: (_count: number, term: string) => `not in “${term}”`,
    inPlace: (count: number) => (count === 1 ? "already in its place" : "already in their place"),
    notRanked: (count: number, source: string) =>
      `not in “${source}”: ${count === 1 ? "stays after, in its place" : "stay after, in their order"}`,
  },

  state: {
    visibility: (visibility: string) =>
      visibility === "hidden"
        ? "Hidden"
        : visibility === "catalog"
          ? "Only in the catalog"
          : visibility === "search"
            ? "Only in search"
            : "Visible",
    noTerms: "None",
    noPrice: "No price",
    from: (price: string) => `from ${price}`,
    pinned: (position: number) => `#${position} pinned`,
    shown: (position: number) => `#${position}`,
    notShown: "Not shown",
    until: (day: string) => `until ${longDay(day)}`,
    noEnd: "no end",
    addedTo: (category: string) => `In “${category}”, then pinned`,
    place: (position: number) => `#${n(position)}`,
  },

  warning: {
    orderElsewhere: (count: number, names: string[], total: number) =>
      `The shop's order is one number per product: ${count === 1 ? "1 is" : `${n(count)} are`} also in ${nameList(names, total)}, and ${count === 1 ? "moves" : "move"} there by the same rule.`,
    orderRoom: (count: number) =>
      `To make room, ${count === 1 ? "1 other product gets" : `${n(count)} other products get`} a new order number: ${count === 1 ? "its" : "their"} place stays the same.`,
    orderPins: (sections: string[]) =>
      `On the category's page the products pinned in ${nameList(sections.map((s) => `“${s}”`))} come first, then this order.`,
    sourceUnmatched: (count: number, total: number) =>
      `${count === 1 ? "1 product" : `${n(count)} products`} of the source out of ${n(total)} ${count === 1 ? "matches" : "match"} no product of the shop: ${count === 1 ? "it is" : "they are"} left out.`,
    orderNotUsed: (sort: string) =>
      `The shop sorts its pages by “${sort}”, not by the custom order: the order is saved, but the pages follow it only once WooCommerce › Settings › Products sets the default sorting to “Custom ordering + name”.`,
    alsoElsewhere: (count: number, names: string[], total: number) =>
      `${count === 1 ? "1 is" : `${n(count)} are`} also in ${nameList(names, total)}: ${count === 1 ? "it disappears" : "they disappear"} there too.`,
    sectionsLose: (sections: string[]) => `The homepage loses products in ${nameList(sections)}.`,
    sectionsShow: (sections: string[]) => `On the homepage: ${nameList(sections)}.`,
    repricing: (count: number) =>
      `For ${products(count)} the Hub keeps repricing on sale: the full price may change during the sale (the discounted one stays).`,
    deeperSale: (count: number) =>
      count === 1
        ? "1 already has a bigger discount: with this sale its price goes up."
        : `${n(count)} already have a bigger discount: with this sale their price goes up.`,
    ownSaleEnds: (count: number) =>
      count === 1
        ? "1 is already on a sale of its own: when this sale ends it loses that discount too and goes back to full price."
        : `${n(count)} are already on a sale of their own: when this sale ends they lose that discount too and go back to full price.`,
    noCategoryLeft: (count: number) =>
      `${count === 1 ? "1 is" : `${n(count)} are`} left without a category: WooCommerce puts ${count === 1 ? "it" : "them"} in the default one.`,
    newTag: (tag: string) => `The tag “${tag}” does not exist yet: I'll create it.`,
    categoryAdded: (count: number, category: string) =>
      `${count === 1 ? "1 product is not" : `${n(count)} products are not`} in “${category}”: I'll add ${count === 1 ? "it" : "them"}, so ${count === 1 ? "it shows" : "they show"} in the section.`,
    marginMoves: (count: number) =>
      count === 1
        ? "1 product changes margin with the category: its price is updated right after."
        : `${n(count)} products change margin with the category: their price is updated right after.`,
    intoHidden: (count: number, term: string) =>
      `“${term}” is hidden in the shop: ${count === 1 ? "the product I add is hidden too" : `the ${n(count)} products I add are hidden too`}.`,
    shownAgain: (count: number) =>
      `${count === 1 ? "1 was hidden" : `${n(count)} were hidden`} from this section: ${count === 1 ? "it shows" : "they show"} again.`,
    dropped: (count: number, max: number) =>
      `${count === 1 ? "1 product pinned before leaves" : `${n(count)} products pinned before leave`} the pinned places (at most ${n(max)}).`,
    lockedSizes: (count: number) =>
      count === 1 ? "1 size has a locked price: it keeps it." : `${n(count)} sizes have a locked price: they keep it.`,
    saleSizes: (count: number) =>
      count === 1
        ? "1 size is on sale: its full price changes when the sale ends."
        : `${n(count)} sizes are on sale: their full price changes when the sale ends.`,
    belowMinSizes: (count: number) =>
      count === 1
        ? "1 size stays as it is: the new price is too close to the current one to change it."
        : `${n(count)} sizes stay as they are: the new price is too close to the current one to change it.`,
    overMaxSizes: (count: number) =>
      count === 1
        ? "1 size stays as it is: it would change by more than the Hub's rules allow."
        : `${n(count)} sizes stay as they are: they would change by more than the Hub's rules allow.`,
    editedSizes: (count: number) =>
      count === 1
        ? "1 size had its price changed in WordPress: it keeps it."
        : `${n(count)} sizes had their prices changed in WordPress: they keep them.`,
  },

  error: {
    tooMany: (total: number) =>
      `That's ${n(total)} products: at most ${n(MAX_OPERATION_PRODUCTS)} at a time. Narrow it down with the filters.`,
    termTooBig: (total: number) =>
      `That's ${n(total)} products: more than the catalog holds (${n(MAX_TERM_PRODUCTS)}). Act on one sub-category at a time.`,
    empty: "No product chosen.",
    inOrder: "They are already in this order.",
    notInTerm: (term: string) => `None of these products is in “${term}”.`,
    alreadyHidden: (term: string) => `The products of “${term}” are already hidden: use “Show” to bring them back.`,
    automatic: (category: string) => `“${category}” is automatic: its rule decides its products.`,
    categoryGone: "This category is no longer in the shop.",
    termGone: "This category or brand is no longer in the shop.",
    tagGone: "This tag is no longer in the shop.",
    tagRefused: (tag: string) => `The shop did not create the tag “${tag}”.`,
    notPinnable: "Products are not pinned in this section from the Showcase.",
    nothingToPin: (section: string) => `None of these products can be in ${section}.`,
    notFound: "This action is no longer in the log.",
    stillRunning: "Still running: wait for it to finish, then undo.",
    alreadyUndone: "Already undone.",
    undoing: "Already being undone.",
    nothingToUndo: "It changed nothing: there is nothing to undo.",
    tooOld: (days: number) => `It can only be undone in the first ${days} days.`,
    sectionChanged: (title: string) => `The section “${title}” changed since: fix the order in the section editor.`,
    unexpected: "Didn't work, because of a problem on the server: try again shortly.",
    interrupted: "Interrupted: the server restarted before the end.",
    stopped: (message: string) => `Interrupted by an error: ${message}`,
    undoInterrupted: "Undo interrupted: the server restarted. Try again.",
    undoFailed: (message: string) => `Undo failed: ${message}`,
    marginDemo: "The margin is not changed in the demo: it would land on the Hub's real prices.",
    marginSame: (term: string, percent: number) => `“${term}” already has a ${percent}% margin.`,
    marginNone: (term: string) => `“${term}” has no margin of its own to remove.`,
    marginFull: (max: number) => `The Hub already has ${n(max)} pricing rules, the most it takes: remove one on the Hub's Margins tab, then try again.`,
    marginTermsUnknown: "The shop's categories and brands can't be read right now: try again shortly.",
    repriceUnanswered: (count: number) =>
      `Margin saved, but the market (KicksDB) did not answer for ${products(count)}: the next price update aligns them.`,
    marginNoSnapshot: "The Hub has not read the shop yet: update it from the Sync tab, then try again.",
    marginChanged: (term: string) => `The margin of “${term}” changed since: change it again from here.`,
    repriceFailed: (message: string) =>
      `Margin saved, but not every price was updated (${message}): the next price update aligns them.`,
  },

  source: {
    wholeCatalog: "the whole catalog",
    parse: {
      empty: "The text is empty: paste the ranking or upload the file.",
      invalidJson: "The JSON cannot be read: check brackets and quotes (or paste the LLM's answer as it is).",
      noItems: "No products in the text: it needs an «items» list with «sku» and/or «name», or one product per line.",
      tooMany: (max: number) => `More than ${n(max)} products: split them into several sources.`,
    },
    nameMissing: "Give the source a name.",
    nameTaken: (name: string) => `There is already a source “${name}”: pick another name, or replace that one.`,
    tooManySources: (max: number) => `There are already ${n(max)} sources, the most: delete one.`,
    gone: "This source is gone.",
    noneInTerm: (term: string, source: string) => `None of the products of “${term}” is in the source “${source}”.`,
    noneInShop: (source: string) => `None of the products of the source “${source}” is in the shop.`,
    inOrder: (source: string) => `It is already in the order of “${source}”.`,
  },

  input: {
    invalid: "Invalid request.",
    operation: "Invalid action.",
    term: "Invalid category or brand.",
    termTarget: "An action on the whole category or brand covers all its products.",
    date: "Invalid date.",
    pastDate: "The end date has already passed.",
    percent: "The discount goes from 1 to 90%.",
    tagName: "Write the tag's name.",
    marginPercent: "The margin goes from 0 to 200%.",
  },
};
