/** A field as the Vetrina's sheets draw theirs, without a width: for a row of fields, each sized by the row. */
export const FIELD =
  "rounded-xl border border-black/10 bg-white px-3 py-2.5 text-[16px] outline-none placeholder:opacity-40 focus:border-black/30 dark:border-white/15 dark:bg-white/10 dark:focus:border-white/40";

/** The add screens' own look: a field as wide as its place. */
export const INPUT = `w-full ${FIELD}`;

/** A field the check found wrong. */
export const INVALID = "!border-red-500 dark:!border-red-400";

/** A group of fields on the page, as the Vetrina's cards. */
export const CARD = "space-y-3 rounded-2xl bg-white p-4 dark:bg-[#1c1c1e]";

/** A section's heading above its card. */
export const SECTION = "px-5 pb-1.5 pt-5 text-[13px] font-semibold uppercase tracking-wide opacity-50";
