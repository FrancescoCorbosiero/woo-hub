import { MAX_OPERATION_PRODUCTS } from "@/lib/vetrina/catalog-ops";
import type { opsIt } from "./ops.it";

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
  products,
  nameList,

  label: {
    hide: (count: number, term: string | null) => `${count === 1 ? "1 product hidden" : `${n(count)} products hidden`}${term ? ` · ${term}` : ""}`,
    show: (count: number) => (count === 1 ? "1 product visible again" : `${n(count)} products visible again`),
    sale: (percent: number, what: string) => `Sale −${percent}% · ${what}`,
    unsale: (what: string) => `Sale ended · ${what}`,
    tag: (tag: string, count: number) => `Tag “${tag}” on ${products(count)}`,
    untag: (tag: string, count: number) => `Tag “${tag}” off ${products(count)}`,
    categorize: (category: string, count: number) => `Category “${category}” on ${products(count)}`,
    uncategorize: (category: string, count: number) => `Category “${category}” off ${products(count)}`,
    pin: (count: number, section: string) => `${count === 1 ? "1 product pinned" : `${n(count)} products pinned`} in ${section}`,
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
    addedTo: (category: string) => `In “${category}”, then pinned`,
  },

  warning: {
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
    shownAgain: (count: number) =>
      `${count === 1 ? "1 was hidden" : `${n(count)} were hidden`} from this section: ${count === 1 ? "it shows" : "they show"} again.`,
    dropped: (count: number, max: number) =>
      `${count === 1 ? "1 product pinned before leaves" : `${n(count)} products pinned before leave`} the pinned places (at most ${n(max)}).`,
  },

  error: {
    tooMany: (total: number) =>
      `That's ${n(total)} products: at most ${n(MAX_OPERATION_PRODUCTS)} at a time. Narrow it down with the filters.`,
    empty: "No product chosen.",
    alreadyHidden: (term: string) => `The products of “${term}” are already hidden: use “Show” to bring them back.`,
    automatic: (category: string) => `“${category}” is automatic: its rule decides its products.`,
    categoryGone: "This category is no longer in the shop.",
    termGone: "This category or brand is no longer in the shop.",
    tagGone: "This tag is no longer in the shop.",
    tagRefused: (tag: string) => `The shop did not create the tag “${tag}”.`,
    notPinnable: "Products are not pinned in this section from the Vetrina.",
    nothingToPin: (section: string) => `None of these products can be in ${section}.`,
    notFound: "This action is no longer in the log.",
    stillRunning: "Still running: wait for it to finish, then undo.",
    alreadyUndone: "Already undone.",
    undoing: "Already being undone.",
    nothingToUndo: "It changed nothing: there is nothing to undo.",
    tooOld: (days: number) => `It can only be undone in the first ${days} days.`,
    sectionChanged: (title: string) => `The section “${title}” changed since: fix the order in the section editor.`,
    interrupted: "Interrupted: the server restarted before the end.",
    stopped: (message: string) => `Interrupted by an error: ${message}`,
    undoInterrupted: "Undo interrupted: the server restarted. Try again.",
    undoFailed: (message: string) => `Undo failed: ${message}`,
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
  },
};
