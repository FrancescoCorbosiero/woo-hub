import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";

/**
 * The Vetrina catalog's strings for a category's or a brand's margin (phase
 * 4): the "Ricarico" row of its screen and the margin sheet. What the server
 * says of the action (its label, the preview's reasons and warnings, the
 * refusals) lives with the other actions' words, in ./ops.it.ts. Italian is
 * the source of truth (see ./it.ts).
 */

/** A count as the owner reads it: "1.234". */
const n = (count: number) => count.toLocaleString("it-IT");
const products = (count: number) => (count === 1 ? "1 prodotto" : `${n(count)} prodotti`);
/** "+10 €" for a whole amount, "+10,50 €" otherwise. */
const euro = (amount: number) =>
  new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
/** "+8,2%", "−3%", "0%": the minus sign the sale's "−20%" uses. */
const signed = (change: number) =>
  `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;

export const marginsIt = {
  /** A margin, as a rule states it. */
  value: {
    percent: (percent: number) => `${n(percent)}%`,
    bands: "a fasce",
    fixed: (amount: number) => `+${euro(amount)}`,
  },

  /** The row of the term's panel, next to "Saldo". */
  row: {
    title: "Ricarico",
    own: (taxonomy: CatalogTaxonomy, value: string) =>
      `${taxonomy === "category" ? "Ricarico di questa categoria" : "Ricarico di questo brand"}: ${value}`,
    standard: (value: string | null) => (value ? `Ricarico: standard (${value})` : "Ricarico: standard"),
    /** Without one of its own: the margin of a term above it. */
    inherited: (value: string, term: string) => `Ricarico: ${value} da «${term}»`,
    applies: (count: number) => (count === 0 ? "Nessun prodotto lo segue" : `Vale per ${products(count)}`),
    supplier: (count: number) => `${n(count)} col prezzo del fornitore`,
    running: (done: number, total: number) => `Aggiorno i prezzi… ${n(done)}/${n(total)}`,
    undoing: "Rimetto il ricarico di prima…",
    waiting: "In attesa: parte appena finisce l'azione prima.",
    failed: "Non riesco a leggere il ricarico.",
    retry: "Riprova",
  },

  sheet: {
    title: "Ricarico",
    modes: { set: "Cambia il ricarico", standard: "Torna allo standard" },
    percentLabel: "Ricarico sul prezzo di mercato",
    percent: (percent: number) => `${n(percent)}%`,
    less: "Un punto in meno",
    more: "Un punto in più",
    presets: "Ricarichi veloci",
    nowOwn: (value: string) => `Adesso: ${value}, il suo.`,
    nowInherited: (value: string, term: string) => `Adesso: ${value}, quello di «${term}».`,
    nowStandard: (value: string | null) => (value ? `Adesso: lo standard (${value}).` : "Adesso: lo standard."),
    /** The slider on the margin the term has: nothing to preview. */
    same: "È il ricarico di adesso: spostalo per vedere cosa cambia.",
    backHint: (target: string) => `I suoi prodotti tornano ${target}.`,
    backToStandard: (value: string | null) => (value ? `al ricarico standard (${value})` : "al ricarico standard"),
    backToInherited: (value: string, term: string) => `al ricarico di «${term}» (${value})`,
    note: "Vale per i prodotti col prezzo dell'Hub. I prezzi del fornitore, le taglie col prezzo bloccato, quelle in saldo e i prezzi cambiati su WordPress restano come sono. L'Hub lo tiene a ogni aggiornamento dei prezzi.",
    summary: "Come cambiano i prezzi",
    up: "Salgono",
    down: "Scendono",
    unchanged: "Uguali",
    /** The average change of their prices: "In media +8,2%", "In media −3%". */
    average: (change: number) => `In media ${signed(change)}`,
    apply: (count: number) => `Applica a ${products(count)}`,
    applyPlain: "Applica",
    back: "Torna al ricarico standard",
  },
};
