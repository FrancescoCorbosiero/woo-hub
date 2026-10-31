import type { ProductSource } from "@/lib/vetrina/catalog";

/**
 * Where a product comes from ("Provenienza"), as the owner tells them apart:
 * each source's colour carries a few letters on a row, its whole name on a
 * chip and in the product sheet, and one line saying what it means for the
 * shop — above all whether "Elimina" takes it. Italian is the source of
 * truth (see ./it.ts).
 */
export const originIt = {
  /** The chips' row over a list, and the product sheet's row. */
  label: "Provenienza",
  /** The row's first chip: every source. */
  all: "Tutte",
  /**
   * On a row's badge, beside the price: a few letters. A shop-made product's
   * says it whole: "Negozio" alone is also the list's order ("⇅ Negozio").
   */
  short: {
    goldensneakers: "GS",
    kicksdb: "KicksDB",
    delisted: "Ex GS",
    woo: "Solo negozio",
  } satisfies Record<ProductSource, string>,
  /** On a chip, and in the product sheet. */
  name: {
    goldensneakers: "GoldenSneakers",
    kicksdb: "KicksDB",
    delisted: "Ex GoldenSneakers",
    woo: "Solo negozio",
  } satisfies Record<ProductSource, string>,
  /** For a screen reader, on a row's badge. */
  aria: (name: string) => `Provenienza: ${name}`,
  /** Under the name in the product sheet: what it means, and whether "Elimina" takes it. */
  hint: {
    goldensneakers: "Lo porta il feed del fornitore, che decide se è nel negozio. Non si elimina: il feed lo rimetterebbe.",
    kicksdb: "L'hai aggiunto tu dall'Hub, col prezzo del mercato (StockX). Se non lo vendi più, puoi eliminarlo.",
    delisted: "Il fornitore non lo vende più: l'Hub lo tiene esaurito. Puoi eliminarlo.",
    woo: "Creato nel negozio (WordPress): nessun listino lo aggiorna. Se non lo vendi più, puoi eliminarlo.",
  } satisfies Record<ProductSource, string>,
};
