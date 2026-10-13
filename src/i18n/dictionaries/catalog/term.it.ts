/**
 * The Vetrina catalog's strings: a category's or a brand's screen, the quick
 * views and the product list they share. Italian is the source of truth (see
 * ../catalog/it.ts).
 */
/** A count as the owner reads it: "1.234". */
const n = (count: number) => count.toLocaleString("it-IT");

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
    makeHint: "I prodotti entrano ed escono da soli, secondo una regola: per esempio tutti quelli col tag «saldi».",
    inHomepage: (section: string) => `In homepage: ${section}`,
    notInHomepage: "Non è in homepage",
    soldOut: (count: number) => (count === 1 ? "1 esaurito" : `${n(count)} esauriti`),
    hidden: (count: number) => (count === 1 ? "1 nascosto" : `${n(count)} nascosti`),
    onSale: (count: number) => `${n(count)} in saldo`,
    allGood: "Tutto disponibile e visibile",
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

  sort: {
    button: (label: string) => `Ordina: ${label}`,
    title: "Ordina per",
    cancel: "Annulla",
    options: {
      shop: "Negozio",
      newest: "Novità",
      bestselling: "Più venduti",
      priceAsc: "Prezzo crescente",
      priceDesc: "Prezzo decrescente",
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

  errors: {
    category: "Questa categoria non c'è più nel negozio.",
    brand: "Questo brand non c'è più nel negozio.",
  },
};
