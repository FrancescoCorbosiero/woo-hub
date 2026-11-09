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

  /**
   * The comparison of a ranking with the shop (its screen,
   * /vetrina/catalogo/classifica/…): prices beyond the threshold, the
   * products the shop lacks, the uncertain ones — and what to do with each.
   */
  compare: {
    open: "Confronta con il negozio",
    openHint: "Prezzi diversi, prodotti che mancano, abbinamenti da verificare.",
    subtitle: "Confronto con il negozio",
    back: "Catalogo",
    summary: (matched: number, items: number) => `${n(matched)} di ${n(items)} prodotti nel negozio`,
    threshold: (threshold: number) => `Prezzi diversi: oltre il ${n(threshold)}%, non per i centesimi.`,
    filter: "Mostra",
    tabs: {
      prices: "Prezzi diversi",
      missing: "Mancanti",
      uncertain: "Da verificare",
      all: "Tutti",
    },
    theirs: "Loro",
    ours: "Noi",
    gap: (gap: number) => `${gap > 0 ? "+" : gap < 0 ? "−" : ""}${Math.abs(gap).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`,
    onSale: "in saldo",
    notPublished: "non pubblicato",
    paired: "abbinato a mano",
    pairedNone: "segnato come non nel negozio",
    inCatalog: "nel catalogo dell'Hub",
    noSku: "senza codice",
    several: "più prodotti possibili",
    notInShop: "non nel negozio",
    empty: {
      prices: "Nessun prezzo si scosta oltre la soglia.",
      pricesUnknown:
        "La classifica non ha prezzi: chiedili all'LLM (le istruzioni ora li includono) e sostituisci la classifica con la nuova risposta.",
      missing: "Il negozio ha tutti i prodotti della classifica.",
      uncertain: "Nessun abbinamento da verificare.",
    },
    pricesIntro:
      "Il prezzo del negozio è quello della taglia più economica, come lo mostra il sito. «Allinea» porta lì la taglia più economica e sposta le altre della stessa cifra: sui prodotti dell'Hub come prezzi bloccati, che la sincronizzazione mantiene.",
    missingIntro:
      "«Importa» li crea nel negozio con Publish: le taglie con i prezzi del motore e dei margini, le foto in coda. Quelli senza codice si cercano prima su KicksDB.",
    uncertainIntro: "Più prodotti del negozio potrebbero essere questi: scegli quale, o segnali come non nel negozio.",
    allIntro: "Tutta la classifica, nel suo ordine. Tocca una voce per cambiarne l'abbinamento.",
    selectAll: "Seleziona tutti",
    selectNone: "Deseleziona",
    selected: (count: number) => (count === 1 ? "1 selezionato" : `${n(count)} selezionati`),
    alignTitle: "Allinea i prezzi",
    align: (count: number) => (count === 1 ? "Allinea 1 prezzo" : `Allinea ${n(count)} prezzi`),
    import: (count: number) => (count === 1 ? "Importa 1 prodotto" : `Importa ${n(count)} prodotti`),
    useOrder: "Disponi tutto il catalogo così",
    lookup: "Cerca su KicksDB",
    lookingUp: "Cerco su KicksDB…",
    lookupNone: "KicksDB non ha un prodotto con un nome così.",
    lookupPick: "Quale è?",
    chosen: (sku: string) => `Da importare: ${sku}`,
    pairAction: "Abbina a mano",
    more: (count: number) => `Mostra altri ${n(count)}`,
    failed: "Non riesco a confrontare la classifica.",
    retry: "Riprova",
    later: "I prodotti creati entrano nel confronto entro un paio di minuti: la copia del negozio si aggiorna da sola.",
    demo: "Sul negozio di prova il confronto si vede, ma non si importa.",
    pair: {
      title: "Quale prodotto è?",
      subtitle: (name: string) => `«${name}», nella classifica`,
      candidates: "Nomi simili nel negozio",
      search: "Cerca nel negozio",
      searchEmpty: "Nessun prodotto del negozio con questo nome.",
      current: "Abbinato ora",
      none: "Non è nel negozio",
      noneHint: "Va tra i mancanti: lo si può importare.",
      auto: "Abbinamento automatico",
      autoHint: "Per codice e per nome, come fa l'Hub da solo.",
      done: (name: string) => `Abbinato a «${name}»`,
      doneNone: "Segnato come non nel negozio",
      doneAuto: "Torna l'abbinamento automatico",
    },
    importSheet: {
      title: (count: number) => (count === 1 ? "Importa 1 prodotto" : `Importa ${n(count)} prodotti`),
      intro:
        "Vengono creati nel negozio con Publish, come dalla sua scheda: le taglie con i prezzi del motore e dei margini, le foto in coda. Un codice che KicksDB non conferma non viene pubblicato; uno già nel negozio resta com'è.",
      start: "Importa",
      progress: (done: number, total: number) => `Importo… ${n(done)} di ${n(total)}`,
      created: "Creati",
      skipped: "Lasciati come sono",
      notFound: "KicksDB non li conosce",
      unreachable: "KicksDB non ha risposto: riprova",
      failed: "Non creati",
      reasons: {
        alreadyOnStore: "già nel negozio",
        feedDelisted: "fuori dal feed del fornitore",
        inProgress: "già in pubblicazione",
        hiddenNoPhoto: "già nel negozio, nascosto per la foto",
      },
      sizes: (count: number) => (count === 1 ? "1 taglia" : `${n(count)} taglie`),
      stop: "Interrompi",
      close: "Fine",
    },
  },

  /** What an LLM is told, to write a source from a web page. */
  llmPrompt: `Sei un assistente che ricava l'ordine dei prodotti dalla pagina di una collezione o di una categoria di un negozio online.

Ti do il link di una pagina che elenca i prodotti di UNA collezione o categoria (o uno screenshot di quella pagina: leggilo allo stesso modo): su Shopify è un indirizzo con /collections/… (es. https://negozio.com/collections/sneakers); sugli altri negozi è la pagina di una categoria (es. …/categoria/sneakers, …/c/sneakers). Mi serve l'ordine in cui il negozio mostra i prodotti in quella pagina con il suo ordinamento predefinito ("In evidenza", "Consigliati", "Featured"): non riordinarli tu e non scegliere un altro ordinamento.

Se il link è la homepage, la pagina di un singolo prodotto o una ricerca, non darmi il JSON: rispondi con una sola frase che mi chiede il link della collezione o della categoria. La homepage non dice in che ordine il negozio mette i suoi prodotti.

Se i prodotti continuano su altre pagine (?page=2, "Pagina successiva", "Carica altri"), leggile in ordine e continua l'elenco da dove eri arrivato.

Con il link di una collezione o di una categoria rispondi SOLO con un JSON valido, senza testo prima o dopo, con questa struttura:

{
  "format": "woo-hub.order-source/1",
  "name": "<negozio — collezione, es. Kith — Nike Dunk>",
  "origin": "<il link della collezione o della categoria>",
  "items": [
    { "sku": "<codice stile del produttore>", "name": "<nome completo del prodotto>", "price": 129.99 }
  ]
}

Regole:
1. "items" segue l'ordine della pagina: il primo prodotto mostrato è il primo dell'elenco. In una griglia leggi da sinistra a destra, dall'alto in basso.
2. "sku" è il codice stile del produttore (es. DD1391-100 per Nike, IE3437 per adidas, 1203A537-100 per ASICS, U9060ZGB per New Balance). Mettilo solo se compare sulla pagina o nel link del prodotto; se non c'è, ometti il campo: non inventarlo.
3. "name" è il nome come scritto sulla pagina: brand, modello e colorway (es. "Nike Dunk Low Retro White Black Panda").
4. Ogni prodotto una volta sola, anche se la pagina lo ripete.
5. "price" è il prezzo che la pagina mostra per quel prodotto, come numero (es. 129.99): quello a cui si compra adesso — se è scontato, il prezzo scontato; se è "da 129 €", 129. Se la pagina non lo mostra, ometti il campo.
6. Niente taglie o altri campi: solo "sku", "name" e "price".
7. Se i prodotti sono più di 150, dammi i primi 150 e chiudi il JSON; quando ti scrivo "continua", dammi un nuovo JSON con i successivi 150, e così via fino all'ultimo.`,
};
