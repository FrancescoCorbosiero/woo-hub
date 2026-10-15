/**
 * The product sheet's grouped look, as iOS draws grouped lists inside a
 * sheet: cards a step lighter than the sheet behind them (white on #f2f2f7,
 * #2c2c2e on #1c1c1e), and separators that start where the text starts. The
 * prices, the tags, "Nel negozio" and the links share it, so the sheet reads
 * as one.
 */

/** A card of the sheet. */
export const SHEET_CARD = "overflow-hidden rounded-2xl bg-white dark:bg-[#2c2c2e]";

/** Konsta's List in the same colours: its own dark surface is the sheet's, so the card would vanish. */
export const SHEET_LIST_COLORS = {
  strongBgIos: "bg-white dark:bg-[#2c2c2e]",
  strongBgMaterial: "bg-white dark:bg-[#2c2c2e]",
};

/** A Konsta List as one of the sheet's cards: no margins of its own, the sheet's radius. */
export const SHEET_LIST = "!mx-0 !my-0 !rounded-2xl";

/** On a card's own <ul>: no separator under the last row (Konsta's rule, as its lists use). */
export const ROWS = "last-child-hairline-b-none";

/** A row of a card: inset on the left, so its separator starts with the text. */
export const ROW = "ps-4";

/** Inside a ROW: the separator (Konsta's hairline, one device pixel) and the right padding. */
export const ROW_INNER = "relative hairline-b pe-4";

/** The small capitals above a card. */
export const HEADING = "mb-1.5 block px-1 text-[13px] font-semibold uppercase tracking-wide opacity-50";
