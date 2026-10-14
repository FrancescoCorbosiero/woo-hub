import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import type { marginsIt } from "./margins.it";

/** A count as the owner reads it: "1,234". */
const n = (count: number) => count.toLocaleString("en-GB");
const products = (count: number) => (count === 1 ? "1 product" : `${n(count)} products`);
/** "+10 €" for a whole amount, "+10,50 €" otherwise. */
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
    own: (taxonomy: CatalogTaxonomy, value: string) =>
      `${taxonomy === "category" ? "This category's margin" : "This brand's margin"}: ${value}`,
    standard: (value: string | null) => (value ? `Margin: standard (${value})` : "Margin: standard"),
    inherited: (value: string, term: string) => `Margin: ${value} from “${term}”`,
    applies: (count: number) => (count === 0 ? "No product follows it" : `Applies to ${products(count)}`),
    supplier: (count: number) => `${n(count)} at the supplier's price`,
    running: (done: number, total: number) => `Updating prices… ${n(done)}/${n(total)}`,
    undoing: "Putting the previous margin back…",
    waiting: "Waiting: starts as soon as the action before ends.",
    failed: "Can't read the margin.",
    retry: "Retry",
  },

  sheet: {
    title: "Margin",
    modes: { set: "Change the margin", standard: "Back to standard" },
    percentLabel: "Margin on the market price",
    percent: (percent: number) => `${n(percent)}%`,
    less: "One point less",
    more: "One point more",
    presets: "Quick margins",
    nowOwn: (value: string) => `Now: ${value}, its own.`,
    nowInherited: (value: string, term: string) => `Now: ${value}, from “${term}”.`,
    nowStandard: (value: string | null) => (value ? `Now: the standard (${value}).` : "Now: the standard."),
    same: "That's the margin it has now: move it to see what changes.",
    backHint: (target: string) => `Its products go back ${target}.`,
    backToStandard: (value: string | null) => (value ? `to the standard margin (${value})` : "to the standard margin"),
    backToInherited: (value: string, term: string) => `to the margin of “${term}” (${value})`,
    note: "It applies to the products the Hub prices. Supplier prices, sizes with a locked price, sizes on sale and prices changed on WordPress stay as they are. The Hub keeps it at every price update.",
    summary: "How prices change",
    up: "Up",
    down: "Down",
    unchanged: "Same",
    average: (change: number) => `On average ${signed(change)}`,
    apply: (count: number) => `Apply to ${products(count)}`,
    applyPlain: "Apply",
    back: "Back to the standard margin",
  },
};
