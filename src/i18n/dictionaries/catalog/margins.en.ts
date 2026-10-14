import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import type { marginsIt } from "./margins.it";

/** A count as the owner reads it: "1,234". */
const n = (count: number) => count.toLocaleString("en-GB");
const products = (count: number) => (count === 1 ? "1 product" : `${n(count)} products`);
/** "+€10" for a whole amount, "+€10.50" otherwise. */
const euro = (amount: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
/** "+8.2%", "−3%", "0%". */
const signed = (change: number) =>
  `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change).toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`;

export const marginsEn: typeof marginsIt = {
  value: {
    percent: (percent: number) => `${n(percent)}%`,
    bands: "banded",
    fixed: (amount: number) => `+${euro(amount)}`,
  },

  row: {
    title: "Margin",
    value: (value: string) => `Margin: ${value}`,
    standard: "Margin: standard",
    hub: "Margin: the Hub's rules",
    ownOf: (taxonomy: CatalogTaxonomy) => (taxonomy === "category" ? "This category's" : "This brand's"),
    from: (term: string) => `From “${term}”`,
    standardIs: (value: string) => `Standard ${value}`,
    applies: (count: number) => (count === 0 ? "Applies to no product" : `Applies to ${products(count)}`),
    nonePriced: "No product at a Hub price, for now",
    loading: "Reading the margin…",
    supplier: (count: number) => `${n(count)} at the supplier's price`,
    running: (done: number, total: number) => `Updating prices… ${n(done)}/${n(total)}`,
    undoing: "Putting the previous margin back…",
    waiting: "Waiting: it starts as soon as the action before it ends.",
    failed: "Can't read the margin.",
    retry: "Try again",
  },

  sheet: {
    title: "Margin",
    modes: { set: "Change margin", standard: "Remove margin" },
    percentLabel: "Margin on the market price",
    percent: (percent: number) => `${n(percent)}%`,
    less: "One point less",
    more: "One point more",
    presets: "Quick margins",
    nowOwn: (value: string, taxonomy: CatalogTaxonomy) => `Now: ${value} (this ${taxonomy === "category" ? "category" : "brand"}'s own).`,
    nowInherited: (value: string, term: string) => `Now: ${value}, from “${term}”.`,
    nowHub: "Now: the Hub's rules (a brand's, a family's…).",
    nowStandard: (value: string | null) => (value ? `Now: the standard (${value}).` : "Now: the standard."),
    same: "That's the margin it has now: move it to see what changes.",
    backHint: (target: string) => `Its products go back ${target}.`,
    backToStandard: (value: string | null) => (value ? `to the standard margin (${value})` : "to the standard margin"),
    backToInherited: (value: string, term: string) => `to the margin of “${term}” (${value})`,
    backToHub: "to the Hub's rules that price them",
    note: "It applies to the products the Hub prices. Supplier prices, sizes with a locked price and prices changed on WordPress stay as they are; sizes on sale take the new full price when the sale ends. The Hub keeps it at every price update.",
    summary: "How prices change",
    up: "Up",
    down: "Down",
    unchanged: "Same",
    average: (change: number) => `On average ${signed(change)}`,
    apply: (count: number) => `Apply to ${products(count)}`,
    applyPlain: "Apply",
    back: {
      standard: "Back to the standard margin",
      inherited: (term: string) => `Back to the margin of “${term}”`,
      hub: "Back to the Hub's rules",
    },
  },
};
