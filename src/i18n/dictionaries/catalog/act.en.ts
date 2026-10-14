import type { actIt } from "./act.it";

/** A count as the owner reads it: "1,234". */
const n = (count: number) => count.toLocaleString("en-GB");
const products = (count: number) => (count === 1 ? "1 product" : `${n(count)} products`);
/** "Sale", "Sale and Nike", "Sale, Nike and Outlet". */
const names = (list: readonly string[]) =>
  list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;

export const actEn: typeof actIt = {
  select: {
    button: "Select",
    buttonLabel: "Select products to act on them together",
  },

  bar: {
    label: "Actions on the chosen products",
    cancel: "Cancel",
    none: "Choose the products",
    count: (count: number) => `${n(count)} selected`,
    all: (count: number) => (count === 1 ? "1 selected" : `All ${n(count)} selected`),
    selectAll: (count: number) => `Select all (${n(count)})`,
    selectAllShort: (count: number) => `All (${n(count)})`,
    deselect: "Deselect",
    tooMany: (max: number) => `Too many: at most ${n(max)} at a time`,
    allButOne: "To pick them one by one, tap “Deselect” first.",
    actions: {
      sale: "Sale",
      hide: "Hide",
      show: "Show",
      tag: "Tag",
      category: "Category",
      pin: "Homepage",
    },
  },

  target: {
    products,
    all: (count: number, list: string | null) => {
      const what = count === 1 ? "1 product" : `All ${n(count)} products`;
      return list ? `${what} in “${list}”` : `${what} in the list`;
    },
    found: (count: number, list: string | null) => {
      const what = count === 1 ? "The only product found" : `The ${n(count)} products found`;
      return list ? `${what} in “${list}”` : `${what} in the list`;
    },
  },

  sheet: {
    close: "Close",
    clear: "Clear",
    retry: "Try again",
    change: "Change",
    network: "Can't reach the server: try again shortly.",
    starting: "Starting…",
  },

  preview: {
    loading: "Checking what changes…",
    changes: (count: number) =>
      count === 0 ? "Nothing changes" : count === 1 ? "1 product changes" : `${n(count)} products change`,
    more: (count: number) => `and ${count === 1 ? "one more" : `${n(count)} more`}`,
    untouched: "Left as they are",
    before: "Before",
    after: "After",
    sampled: (count: number) =>
      `Prices read from the shop for the first ${count === 1 ? "one" : n(count)}: the rest is an estimate, the action checks each one again.`,
    failed: "Can't work out what would change.",
  },

  sale: {
    title: "Sale",
    modes: { sale: "Put on sale", unsale: "End the sale" },
    percentLabel: "Off the full price",
    percent: (percent: number) => `−${percent}%`,
    presets: "Quick discounts",
    rounding: "Rounding",
    roundings: { charm: "Round to .99", exact: "Exact" },
    roundingHint: {
      charm: "From €10 up it drops to .99: €129 −20% makes €102.99. The discount is never less than announced.",
      exact: "To the cent, always down.",
    },
    end: "Sale ends",
    ends: { none: "Never", sunday: "Sunday", week: "7 days", pick: "Pick…" },
    endsNever: "No end date: it stays until you end it.",
    endsOn: (day: string) => `Ends ${day}, at the end of the day.`,
    endsToday: "Ends tonight, at the end of the day.",
    pickLabel: "The sale's last day",
    pickFirst: "Pick the day above.",
    pickPast: "Pick a day from today on.",
    regularNote: "The full price does not change: the Hub always sets it.",
    unsaleHint: "The full price comes back and the end date is cleared. “Undo” puts the sale back as it was.",
    start: (count: number) => `Put ${products(count)} on sale`,
    startPlain: "Put on sale",
    stop: (count: number) => `End the sale on ${products(count)}`,
    stopPlain: "End the sale",
  },

  visibility: {
    title: { hide: "Hide", show: "Show" },
    hint: {
      hide: (count: number) =>
        count === 1
          ? "It disappears from the shop, its categories and its search; its link keeps working. “Undo” puts it back as it was."
          : "They disappear from the shop, its categories and its search; their links keep working. “Undo” puts them back as they were.",
      show: (count: number) =>
        count === 1 ? "It shows again in the shop, its categories and its search." : "They show again in the shop, its categories and its search.",
    },
    start: {
      hide: (count: number) => `Hide ${products(count)}`,
      show: (count: number) => `Show ${products(count)}`,
    },
    plain: { hide: "Hide", show: "Show" },
  },

  tag: {
    title: "Tag",
    modes: { add: "Add", remove: "Remove" },
    search: { add: "Search or type a tag", remove: "Search a tag" },
    create: (name: string) => `Create the tag “${name}”`,
    createHint: "It doesn't exist yet: I'll create it on the shop.",
    readBy: (list: readonly string[]) => `Read by: ${list.join(", ")}`,
    readByNote: (list: readonly string[]) =>
      list.length === 1
        ? `The automatic category ${names(list)} reads this tag: products may join or leave it.`
        : `The automatic categories ${names(list)} read this tag: products may join or leave them.`,
    none: "No tag with this name.",
    more: (count: number) => (count === 1 ? "1 more tag: type to find it." : `${n(count)} more tags: type to find them.`),
    empty: "The shop has no tags yet.",
    loading: "Loading the shop's tags…",
    failed: "Can't read the shop's tags.",
    start: {
      add: (tag: string, count: number) => `Add “${tag}” to ${products(count)}`,
      remove: (tag: string, count: number) => `Remove “${tag}” from ${products(count)}`,
    },
    plain: { add: "Add the tag", remove: "Remove the tag" },
  },

  category: {
    title: "Category",
    modes: { add: "Add to", remove: "Remove from" },
    search: "Search a category",
    automatic: "Decided by its rule",
    here: "Already here",
    none: "No category with this name.",
    more: (count: number) =>
      count === 1 ? "1 more category: type to find it." : `${n(count)} more categories: type to find them.`,
    empty: "The shop has no categories.",
    loading: "Loading the categories…",
    failed: "Can't read the categories.",
    start: {
      add: (category: string, count: number) => `Add ${products(count)} to “${category}”`,
      remove: (category: string, count: number) => `Remove ${products(count)} from “${category}”`,
    },
    plain: { add: "Add to the category", remove: "Remove from the category" },
  },

  pin: {
    title: "Put on the homepage",
    intro: "Pick the section: the products go to the top, pinned, in the list's order.",
    fill: {
      category: (name: string) => `Category “${name}”: products not in it are added.`,
      automatic: (name: string) => `Automatic “${name}”: only the products its rule picks.`,
      brand: (name: string) => `Brand “${name}”: only its own products.`,
      other: "Only the products it already shows.",
    },
    pinned: (count: number) => (count === 0 ? "None pinned" : `${n(count)} pinned`),
    notPinnable: "Products can't be pinned here from the Vetrina.",
    editing: "You're editing it: pin it from the section editor.",
    takesNone: (count: number) => (count === 1 ? "This product can't be here." : "None of these products can be here."),
    empty: "The homepage has no product sections.",
    loading: "Loading the homepage's sections…",
    failed: "Can't read the homepage.",
    start: (section: string, count: number) =>
      count === 1 ? `Pin to the top of ${section}` : `Pin ${n(count)} to the top of ${section}`,
    plain: "Pin to the top",
  },

  activity: {
    title: "Activity",
    open: "Activity",
    intro: "The latest actions on products. “Undo” puts the earlier values back, where nobody changed them since.",
    empty: "No actions yet.",
    loading: "Loading the activity…",
    failed: "Can't read the activity.",
    undo: "Undo",
    status: {
      running: (done: number, total: number) => `Running · ${n(done)}/${n(total)}`,
      queued: "Waiting",
      done: "Done",
      failed: "Didn't finish",
      undoing: "Undoing",
      undone: "Undone",
    },
    refused: (count: number) => `${products(count)} refused by the shop`,
  },

  pill: {
    kinds: {
      hide: "Hiding",
      show: "Showing again",
      sale: "Putting on sale",
      unsale: "Ending the sale",
      tag: "Adding the tag",
      untag: "Removing the tag",
      categorize: "Adding to the category",
      uncategorize: "Removing from the category",
      pin: "Pinning on the homepage",
    },
    undoing: "Undoing…",
    progress: (what: string, done: number, total: number) => `${what} · ${n(done)}/${n(total)}`,
    queued: (what: string) => `${what} · waiting`,
    more: (count: number) => `+${count}`,
    label: "Actions running: tap to see them",
  },

  toast: {
    undo: "Undo",
    refused: (count: number) => `${products(count)} refused by the shop.`,
    undone: (label: string) => `Undone: ${label}`,
    restored: (count: number) => `${products(count)} back as before`,
    kept: (count: number) =>
      count === 1 ? "1 product left as it was: changed meanwhile" : `${n(count)} products left as they were: changed meanwhile`,
    undoRefused: (count: number) => `${products(count)} refused by the shop`,
    held: (count: number) =>
      count === 1
        ? "1 stays hidden: it is also in a category or brand you hid"
        : `${n(count)} stay hidden: they are also in a category or brand you hid`,
    undoFailed: "Undo didn't work.",
    failed: "It didn't go through.",
  },
};
