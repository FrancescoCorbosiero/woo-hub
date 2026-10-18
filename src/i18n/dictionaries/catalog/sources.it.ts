/**
 * The Vetrina catalog's strings for order sources ("fonti d'ordine"): their
 * sheet (the list, one source, the form), "Usa l'ordine di «…»" and the
 * instructions an LLM is given to write a source from a web page. Italian is
 * the source of truth (see ./it.ts). The server's own words about a source
 * are in ./ops.it.ts (source).
 */

/** A count as the owner reads it: "1.234". */
const n = (count: number) => count.toLocaleString("it-IT");

export const sourcesIt = {
  title: "Fonti d'ordine",
  /** The catalog's row, the homepage tab's button. */
  open: "Fonti d'ordine",
  row: (count: number) =>
    count === 0 ? "Usa l'ordine di un altro negozio" : count === 1 ? "1 fonte" : `${n(count)} fonti`,
  intro:
    "Una fonte è una classifica dei prodotti presa altrove: la pagina di un negozio, i più venduti di un marketplace. Su una categoria, un brand o tutto il catalogo, «Usa l'ordine di…» mette prima i suoi prodotti, in quell'ordine; gli altri seguono.",
  empty: "Nessuna fonte, per ora.",
  add: "Aggiungi una fonte",
  loading: "Carico le fonti…",
  matched: (matched: number, items: number) =>
    items === 1 ? (matched === 1 ? "1 prodotto, nel negozio" : "1 prodotto, non nel negozio") : `${n(matched)} di ${n(items)} prodotti nel negozio`,
  updated: (when: string) => `aggiornata ${when}`,

  /** One source. */
  origin: "Da dove viene",
  applyAll: "Usa su tutto il catalogo",
  applyAllHint: "Su una sola categoria o un brand: dalla sua pagina, «Ordina» › «Usa l'ordine di…».",
  edit: "Modifica o sostituisci la classifica",
  remove: "Elimina la fonte",
  removeConfirm: (name: string) => `Eliminare «${name}»? Gli ordini già applicati restano come sono.`,
  removeYes: "Elimina",
  removeNo: "Annulla",
  removed: (name: string) => `«${name}» eliminata`,
  unmatched: "Non trovati nel negozio",
  unmatchedHint: "Il negozio non li ha, o il nome non basta a capire quale prodotto sono: vengono ignorati.",
  unmatchedMore: (count: number) => (count === 1 ? "e un altro" : `e altri ${n(count)}`),
  ambiguous: "più prodotti possibili",
  allMatched: "Tutti i prodotti della fonte sono nel negozio.",

  /** The form. */
  newTitle: "Nuova fonte",
  editTitle: "Modifica la fonte",
  name: "Nome",
  namePlaceholder: "Es. StockX — più venduti",
  originLabel: "Da dove viene",
  originPlaceholder: "Link della pagina, o due parole (facoltativo)",
  text: "Classifica",
  textPlaceholder: "Incolla qui la risposta dell'LLM (JSON), un CSV con «sku» e «name», o un prodotto per riga…",
  textKeep: "Lascia vuoto per tenere la classifica di adesso.",
  file: "Carica un file",
  fileFailed: "Non riesco a leggere il file.",
  promptCopy: "Copia istruzioni LLM",
  promptCopied: "Istruzioni copiate: incollale nell'LLM con la pagina (link, testo o screenshot), poi incolla qui la sua risposta.",
  promptFailed: "Non riesco a copiare: tieni premuto sul testo qui sotto per copiarlo.",
  promptShow: "Mostra le istruzioni",
  checking: "Leggo la classifica…",
  checkSummary: (matched: number, items: number) =>
    `${n(items)} ${items === 1 ? "prodotto" : "prodotti"} nella classifica: ${matched === items ? (items === 1 ? "è nel negozio" : "tutti nel negozio") : `${n(matched)} nel negozio`}.`,
  duplicates: (count: number) => (count === 1 ? "1 ripetuto, contato una volta." : `${n(count)} ripetuti, contati una volta.`),
  save: "Salva la fonte",
  saved: (name: string) => `«${name}» salvata`,

  /** "Usa l'ordine di «X»", on a list's sort sheet, and its sheet. */
  use: (name: string) => `Usa l'ordine di «${name}»`,
  manage: "Fonti d'ordine…",
  apply: {
    title: (name: string) => `Ordine di «${name}»`,
    whole: "Tutto il catalogo",
    intro: "I prodotti della fonte vanno in cima, nel suo ordine; gli altri seguono, nel loro.",
    start: (count: number) => (count === 1 ? "Sposta 1 prodotto" : `Sposta ${n(count)} prodotti`),
    plain: "Applica",
  },

  /** What an LLM is told, to write a source from a web page. */
  llmPrompt: `Sei un assistente che ricava l'ordine dei prodotti da una pagina di un negozio online.

Ti do una pagina (link, testo copiato o screenshot) che elenca prodotti (sneakers, abbigliamento, accessori) in un certo ordine. Rispondi SOLO con un JSON valido, senza testo prima o dopo, con questa struttura:

{
  "format": "woo-hub.order-source/1",
  "name": "<un nome breve per la fonte, es. Nike.com — Novità>",
  "origin": "<il link della pagina>",
  "items": [
    { "sku": "<codice stile del produttore>", "name": "<nome completo del prodotto>" }
  ]
}

Regole:
1. "items" segue l'ordine della pagina: il primo prodotto mostrato è il primo dell'elenco. In una griglia leggi da sinistra a destra, dall'alto in basso.
2. "sku" è il codice stile del produttore (es. DD1391-100 per Nike, IE3437 per adidas, 1203A537-100 per ASICS, U9060ZGB per New Balance). Mettilo solo se compare sulla pagina o nel link del prodotto; se non c'è, ometti il campo: non inventarlo.
3. "name" è il nome come scritto sulla pagina: brand, modello e colorway (es. "Nike Dunk Low Retro White Black Panda").
4. Ogni prodotto una volta sola, anche se la pagina lo ripete.
5. Niente prezzi, taglie o altri campi: solo "sku" e "name".`,
};
