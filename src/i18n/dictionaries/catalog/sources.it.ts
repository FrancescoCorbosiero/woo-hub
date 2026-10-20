/**
 * The Vetrina catalog's strings for order sources ("classifiche": another
 * shop's ranking of its products — never "ordine", which in a shop reads as
 * a customer's order): their sheet (the list, one, the form), "Disponi come
 * «…»" and the
 * instructions an LLM is given to write a source from a web page. Italian is
 * the source of truth (see ./it.ts). The server's own words about a source
 * are in ./ops.it.ts (source).
 */

/** A count as the owner reads it: "1.234". */
const n = (count: number) => count.toLocaleString("it-IT");

export const sourcesIt = {
  title: "Classifiche",
  /** The catalog's row, the panels' and the section editor's buttons. */
  open: "Classifiche da altri negozi",
  row: (count: number) =>
    count === 0 ? "Disponi i prodotti come un altro negozio" : count === 1 ? "1 classifica" : `${n(count)} classifiche`,
  intro:
    "Una classifica è come un altro negozio mette in fila i suoi prodotti, presa dalla pagina di una sua collezione o categoria (non dalla homepage: lì non c'è). Su una categoria, un brand o tutto il catalogo, «Disponi come…» mette prima i suoi prodotti, uno dopo l'altro come lì; gli altri seguono.",
  empty: "Nessuna classifica, per ora.",
  add: "Aggiungi una classifica",
  loading: "Carico le classifiche…",
  matched: (matched: number, items: number) =>
    items === 1 ? (matched === 1 ? "1 prodotto, nel negozio" : "1 prodotto, non nel negozio") : `${n(matched)} di ${n(items)} prodotti nel negozio`,
  updated: (when: string) => `aggiornata ${when}`,

  /** One source. */
  origin: "Da dove viene",
  applyAll: "Disponi tutto il catalogo così",
  applyAllHint: "Di solito una classifica è una collezione: usala sulla categoria che le corrisponde, dalla sua pagina: «Posizioni nel negozio» › «Disponi come…».",
  edit: "Modifica o sostituisci la classifica",
  remove: "Elimina la classifica",
  removeConfirm: (name: string) => `Eliminare «${name}»? I prodotti già disposti così restano dove sono.`,
  removeYes: "Elimina",
  removeNo: "Annulla",
  removed: (name: string) => `«${name}» eliminata`,
  unmatched: "Non trovati nel negozio",
  unmatchedHint: "Il negozio non li ha, o il nome non basta a capire quale prodotto sono: vengono ignorati.",
  unmatchedMore: (count: number) => (count === 1 ? "e un altro" : `e altri ${n(count)}`),
  ambiguous: "più prodotti possibili",
  allMatched: "Tutti i prodotti della classifica sono nel negozio.",

  /** The form. */
  newTitle: "Nuova classifica",
  editTitle: "Modifica la classifica",
  name: "Nome",
  namePlaceholder: "Es. Kith — Nike Dunk",
  originLabel: "Da dove viene",
  originPlaceholder: "Link della collezione o della categoria (facoltativo)",
  /** The origin is a shop's homepage: its order is in its collections' pages. */
  originHomepage: "Sembra la homepage: come il negozio mette in fila i prodotti si legge nella pagina di una collezione o di una categoria (su Shopify: /collections/…).",
  text: "Classifica",
  textPlaceholder: "Incolla qui la risposta dell'LLM (JSON) — più risposte, una dopo l'altra —, un CSV con «sku» e «name», o un prodotto per riga…",
  textKeep: "Lascia vuoto per tenere la classifica di adesso.",
  file: "Carica un file",
  fileFailed: "Non riesco a leggere il file.",
  promptCopy: "Copia istruzioni LLM",
  promptCopied: "Istruzioni copiate: incollale nell'LLM con il link della collezione o della categoria, poi incolla qui la sua risposta.",
  promptFailed: "Non riesco a copiare: tieni premuto sul testo qui sotto per copiarlo.",
  promptShow: "Mostra le istruzioni",
  checking: "Leggo la classifica…",
  checkSummary: (matched: number, items: number) =>
    `${n(items)} ${items === 1 ? "prodotto" : "prodotti"} nella classifica: ${matched === items ? (items === 1 ? "è nel negozio" : "tutti nel negozio") : `${n(matched)} nel negozio`}.`,
  duplicates: (count: number) => (count === 1 ? "1 ripetuto, contato una volta." : `${n(count)} ripetuti, contati una volta.`),
  /** Several JSON answers pasted one after another. */
  parts: (count: number) => `${n(count)} risposte unite, una dopo l'altra come le hai incollate.`,
  /** The last answer stops halfway: the LLM's length limit. */
  truncated:
    "La risposta si interrompe a metà: ho letto fino all'ultimo prodotto completo. Scrivi «continua» all'LLM e incolla qui, dopo questa, anche la sua nuova risposta.",
  save: "Salva la classifica",
  saved: (name: string) => `«${name}» salvata`,

  /** "Disponi come «X»", on a term's panel and the section editor, and its sheet. */
  use: (name: string) => `Disponi come «${name}»`,
  manage: "Classifiche…",
  /** The action sheet listing them for a category or a brand. */
  rankAs: (term: string) => `Disponi «${term}» come…`,
  none: "Nessuna classifica, per ora: aggiungine una.",
  apply: {
    title: (name: string) => `Come «${name}»`,
    whole: "Tutto il catalogo",
    intro: "I prodotti della classifica vanno in cima, uno dopo l'altro come lì; gli altri seguono, come sono.",
    start: (count: number) => (count === 1 ? "Sposta 1 prodotto" : `Sposta ${n(count)} prodotti`),
    plain: "Applica",
  },

  /** What an LLM is told, to write a source from a web page. */
  llmPrompt: `Sei un assistente che ricava l'ordine dei prodotti dalla pagina di una collezione o di una categoria di un negozio online.

Ti do il link di una pagina che elenca i prodotti di UNA collezione o categoria: su Shopify è un indirizzo con /collections/… (es. https://negozio.com/collections/sneakers); sugli altri negozi è la pagina di una categoria (es. …/categoria/sneakers, …/c/sneakers). Mi serve l'ordine in cui il negozio mostra i prodotti in quella pagina con il suo ordinamento predefinito ("In evidenza", "Consigliati", "Featured"): non riordinarli tu e non scegliere un altro ordinamento.

Se il link è la homepage, la pagina di un singolo prodotto o una ricerca, non darmi il JSON: rispondi con una sola frase che mi chiede il link della collezione o della categoria. La homepage non dice in che ordine il negozio mette i suoi prodotti.

Se i prodotti continuano su altre pagine (?page=2, "Pagina successiva", "Carica altri"), leggile in ordine e continua l'elenco da dove eri arrivato.

Con il link di una collezione o di una categoria rispondi SOLO con un JSON valido, senza testo prima o dopo, con questa struttura:

{
  "format": "woo-hub.order-source/1",
  "name": "<negozio — collezione, es. Kith — Nike Dunk>",
  "origin": "<il link della collezione o della categoria>",
  "items": [
    { "sku": "<codice stile del produttore>", "name": "<nome completo del prodotto>" }
  ]
}

Regole:
1. "items" segue l'ordine della pagina: il primo prodotto mostrato è il primo dell'elenco. In una griglia leggi da sinistra a destra, dall'alto in basso.
2. "sku" è il codice stile del produttore (es. DD1391-100 per Nike, IE3437 per adidas, 1203A537-100 per ASICS, U9060ZGB per New Balance). Mettilo solo se compare sulla pagina o nel link del prodotto; se non c'è, ometti il campo: non inventarlo.
3. "name" è il nome come scritto sulla pagina: brand, modello e colorway (es. "Nike Dunk Low Retro White Black Panda").
4. Ogni prodotto una volta sola, anche se la pagina lo ripete.
5. Niente prezzi, taglie o altri campi: solo "sku" e "name".
6. Se i prodotti sono più di 150, dammi i primi 150 e chiudi il JSON; quando ti scrivo "continua", dammi un nuovo JSON con i successivi 150, e così via fino all'ultimo.`,
};
