import type { QuickView } from "@/lib/vetrina/catalog";

/**
 * The Vetrina catalog's strings: a category's or a brand's screen, the quick
 * views and the product list they share. Italian is the source of truth (see
 * ../catalog/it.ts).
 */
/** A count as the owner reads it: "1.234". */
const n = (count: number) => count.toLocaleString("it-IT");

/** "«Adidas»", "«Adidas» e «Nike»", "«Adidas», «Nike» e altri 2". */
function quoted(names: readonly string[], shown = 2): string {
  const list = names.slice(0, shown).map((name) => `«${name}»`);
  const more = names.length - list.length;
  if (more > 0) return `${list.join(", ")} e ${more === 1 ? "un altro" : `altri ${n(more)}`}`;
  return list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}

export const termIt = {
  catalog: "Catalogo",
  back: "Indietro",
  products: (count: number) => (count === 1 ? "1 prodotto" : `${n(count)} prodotti`),
  backTo: (name: string) => `Torna a ${name}`,
  backToCatalog: "Torna al catalogo",
  searchIn: (name: string) => `Cerca in ${name}`,
  // A quick view's name is not a place: "Cerca in Senza categoria" reads badly.
  searchView: "Cerca in questa lista",
  searchAll: (q: string) => `Cerca «${q}» in tutto il catalogo`,

  panel: {
    automatic: (rule: string) => `Automatica: ${rule}`,
    /** A rule as the skeleton draws it, unseen: only its length matters. */
    automaticSample: "con il tag «saldi» e disponibili",
    makeHint: "I prodotti entrano ed escono da soli, secondo una regola: per brand, prezzo, saldo, tag e altro.",
    inHomepage: (section: string) => `In homepage: ${section}`,
    notInHomepage: "Non è in homepage",
    soldOut: (count: number) => (count === 1 ? "1 esaurito" : `${n(count)} esauriti`),
    hidden: (count: number) => (count === 1 ? "1 nascosto" : `${n(count)} nascosti`),
    onSale: (count: number) => `${n(count)} in saldo`,
    allGood: "Tutto disponibile e visibile",

    // "Visibile nel negozio": the whole term's products, hidden or shown again in one go.
    visible: "Visibile nel negozio",
    visibleHint: "Spegnilo e i suoi prodotti spariscono dal negozio; i loro link restano.",
    hiddenOneByOne: (count: number) => (count === 1 ? "1 nascosto uno per uno" : `${n(count)} nascosti uno per uno`),
    allHiddenOneByOne: "Tutti nascosti uno per uno: riaccendilo per mostrarli.",
    /** Hidden by another category or brand the owner hid: that one's switch brings them back. */
    heldBy: (count: number, terms: readonly string[]) =>
      `${count === 1 ? "1 resta nascosto" : `${n(count)} restano nascosti`} da ${quoted(terms)}`,
    hiding: (done: number, total: number) => `${total === 1 ? "Lo nascondo" : "Li nascondo"}… ${n(done)}/${n(total)}`,
    waiting: "In attesa: parte appena finisce l'azione prima.",
    hiddenSince: (when: string, count = 2): string =>
      count === 1
        ? `Nascosto da te · ${when}. Riaccendilo e torna com'era.`
        : `Nascosti da te · ${when}. Riaccendilo e tornano com'erano.`,
    hiddenPartly: (changed: number, total: number) =>
      `Nascosti in parte: ${n(changed)} su ${n(total)}. Riaccendilo e tornano com'erano.`,
    showing: (count = 2): string => (count === 1 ? "Lo rimetto com'era…" : "Li rimetto com'erano…"),
    showingAll: (done: number, total: number) => `${total === 1 ? "Lo rimetto" : "Li rimetto"} in vista… ${n(done)}/${n(total)}`,
    showHidden: (count: number) => (count === 1 ? "Mostra l'unico nascosto" : `Mostra i ${n(count)} nascosti`),
    /** Under the term's hide: products that joined it since and still show (the next check hides them). One line at 390px. */
    hideAdded: (count: number) => (count === 1 ? "Nascondi il nuovo arrivato" : `Nascondi i ${n(count)} nuovi arrivati`),
    hideAddedHint: "Arrivati dopo: si nascondono da soli entro pochi minuti, o subito da qui.",
    hidingAdded: "Li nascondo…",
    hiddenOf: (count: number, name: string) =>
      `${count === 1 ? "1 prodotto nascosto" : `${n(count)} prodotti nascosti`} di «${name}»`,

    // "Saldo": a sale on the whole term.
    sale: "Saldo",
    saleStart: "Metti in saldo",
    saleHint: "Uno sconto su tutti i suoi prodotti, con o senza data di fine.",
    saleOthers: (count: number) => (count === 1 ? "1 già in saldo per conto suo" : `${n(count)} già in saldo per conto loro`),
    saleOn: (percent: number) => `Saldo −${percent}%`,
    saleUntil: (day: string) => `Fino a ${day}`,
    saleNoEnd: "Senza data di fine: resta finché non lo togli",
    saleRunning: (done: number, total: number) => `Lo applico… ${n(done)}/${n(total)}`,
    saleUndoing: "Lo tolgo…",
    saleMenu: (percent: number, name: string) => `Saldo −${percent}% su «${name}»`,
    saleChange: "Cambia lo sconto",
    saleStop: "Togli il saldo",
    saleStopHint: "Togliendolo, tutti i suoi prodotti tornano a prezzo pieno.",
    /** Undo the term's latest sale: its prices go back to what they were before it. */
    saleUndo: "Annulla questo saldo",
    /** …which replaced an earlier sale of the term: that one comes back. */
    saleUndoBack: (percent: number) => `Annulla il cambio: torna a −${percent}%`,
    /** …at the same percent, only its end moved: the earlier end comes back. */
    saleUndoBackEnd: (day: string | null) => (day ? `Annulla il cambio: di nuovo fino a ${day}` : "Annulla il cambio: di nuovo senza fine"),
    cancel: "Annulla",
    stateFailed: "Non riesco a leggere se è nascosta o in saldo.",
    retry: "Riprova",
  },

  /**
   * "Posizioni nel negozio": where the term's products stand on its page in
   * the shop (WooCommerce's menu_order, then the name) — set by hand, from a
   * ranking, or a few products at a time. Never "ordine": in a shop that is a
   * customer's order.
   */
  positions: {
    title: "Posizioni nel negozio",
    hint: (name: string) => `Come la pagina «${name}» del negozio mette in fila i suoi prodotti.`,
    arrange: "Disponi a mano",
    arrangeHint: "Trascina i prodotti nei posti che vuoi.",
    ranking: "Disponi come una classifica",
    rankingHint: (count: number) =>
      count === 0 ? "Copia come un altro negozio mette in fila gli stessi prodotti." : count === 1 ? "1 classifica pronta." : `${count} classifiche pronte.`,
    place: "Metti in cima dei prodotti",
    placeHint: "Scegli i prodotti, poi «Posiziona».",
    selecting: "Scegli i prodotti da spostare, poi tocca «Posiziona».",
  },

  /** The "⋯" in the navbar. */
  menu: {
    open: "Altre azioni",
    saveRule: "Salva come categoria automatica",
    reorder: "Disponi a mano",
    activity: "Attività",
    cancel: "Annulla",
  },

  children: { category: "Sottocategorie", brand: "Linee del brand" },

  filters: {
    label: "Filtri",
    all: "Tutti",
    instock: "Disponibili",
    outofstock: "Esauriti",
    hidden: "Nascosti",
    onsale: "In saldo",
    withinLabel: { category: "Brand", brand: "Categorie" },
    withinAll: { category: "Tutti i brand", brand: "Tutte le categorie" },
  },

  /** How the list on screen is sorted — the app's own view, which changes nothing in the shop. */
  sort: {
    button: (label: string) => label,
    /** The button's whole words, for a screen reader. */
    label: (label: string) => `Elenco per: ${label}. Cambia`,
    title: "Elenca i prodotti per",
    cancel: "Annulla",
    options: {
      shop: "Posizione nel negozio",
      newest: "Novità",
      bestselling: "Più venduti",
      priceAsc: "Prezzo crescente",
      priceDesc: "Prezzo decrescente",
      name: "Nome",
    },
    /** The shop's positions, set by hand: also under "Posizioni nel negozio". */
    reorder: "Disponi a mano…",
    /** On the list's button, beside the count and "Seleziona": short, so the count keeps its room on a phone. */
    short: {
      shop: "Negozio",
      newest: "Novità",
      bestselling: "Più venduti",
      priceAsc: "Prezzo ↑",
      priceDesc: "Prezzo ↓",
      name: "Nome",
    },
  },

  list: {
    loadMore: "Carica altri",
    loadingMore: "Carico altri prodotti…",
    failed: "Non riesco a caricare i prodotti.",
    moreFailed: "Non riesco a caricare altri prodotti.",
    retry: "Riprova",
    reloadFailed: "Non riesco ad aggiornare la lista: riprova tra poco.",
    empty: "Nessun prodotto qui",
    emptySearch: (q: string) => `Nessun prodotto per «${q}»`,
    emptyFiltered: "Con questi filtri non resta nessun prodotto.",
    clearFilters: "Togli i filtri",
  },

  row: {
    section: (title: string, position: number) => `${title} #${position}`,
    sectionLabel: (title: string, position: number, pinned: boolean) =>
      `In homepage: ${title}, posizione ${position}${pinned ? ", fissato" : ""}`,
    moreSections: (count: number) => `+${count}`,
    locked: "Prezzo bloccato",
    noPhoto: "Senza foto",
    hidden: "Nascosto",
    soldOut: "Esaurito",
    onSale: "In saldo",
    status: {
      draft: "Bozza",
      pending: "In revisione",
      private: "Privato",
      future: "Programmato",
      other: "Non pubblicato",
    } as Record<string, string>,
  },

  views: {
    soldout: { title: "Esauriti", hint: "Nessuna taglia disponibile: sul sito non si possono comprare." },
    onsale: { title: "In saldo", hint: "I prodotti con un prezzo scontato in questo momento." },
    hidden: { title: "Nascosti", hint: "Nascosti dal negozio: sul sito non compaiono né nelle liste né nella ricerca." },
    nophoto: { title: "Senza foto", hint: "Sul sito compaiono con un'immagine vuota: aggiungi una foto da WordPress." },
    nocategory: { title: "Senza categoria", hint: "Sul sito non si trovano sfogliando le categorie." },
    unpublished: { title: "Non pubblicati", hint: "Bozze, prodotti in revisione e privati: sul sito non si vedono." },
  },

  /** A quick view with nothing in it, said as the good news it mostly is. */
  viewsEmpty: {
    soldout: { title: "Nessun prodotto esaurito", text: "Tutto quello che è nel negozio si può comprare." },
    onsale: { title: "Nessun prodotto in saldo", text: "Per un saldo, scegli i prodotti da una categoria o da un brand." },
    hidden: { title: "Nessun prodotto nascosto", text: "Nel negozio si vede tutto." },
    nophoto: { title: "Tutti i prodotti hanno una foto", text: "Nel negozio nessuna immagine vuota." },
    nocategory: { title: "Tutti i prodotti hanno una categoria", text: "Si trovano tutti sfogliando il negozio." },
    unpublished: { title: "Nessun prodotto da pubblicare", text: "Niente bozze né prodotti in attesa: è tutto online." },
  } satisfies Record<QuickView, { title: string; text: string }>,

  errors: {
    category: "Questa categoria non c'è più nel negozio.",
    brand: "Questo brand non c'è più nel negozio.",
  },
};
