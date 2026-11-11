/** "Aggiungi prodotti"'s addresses, and the hand-over between its two screens. */

const EDITOR = "/vetrina/negozio/aggiungi/nuovo";

/** The form for a code made by hand, starting from what is known of it ("da=codici": back leads to the codes). */
export function editorHref(sku: string | null, back = false): string {
  const query = new URLSearchParams();
  if (sku) query.set("sku", sku);
  if (back) query.set("da", "codici");
  const q = query.toString();
  return q ? `${EDITOR}?${q}` : EDITOR;
}

/** Where the form finds the product sheet's row it was opened for, in this tab's storage: read once, on opening. */
export const SHEET_DRAFT = "handmade-draft:";
