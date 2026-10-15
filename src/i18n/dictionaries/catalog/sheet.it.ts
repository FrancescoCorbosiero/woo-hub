/**
 * The Vetrina catalog's strings: the product sheet's "Nel negozio" (where the
 * product lives in the shop, and the actions on this one product) and the
 * section editor's way into the catalog. Italian is the source of truth (see
 * ../catalog/it.ts).
 */
export const sheetIt = {
  title: "Nel negozio",
  loading: "Carico dove si trova nel negozio…",
  failed: "Non riesco a vedere dove si trova nel negozio.",
  notFound: "Questo prodotto non è ancora nel catalogo: se l'hai appena creato, compare tra pochi minuti.",
  retry: "Riprova",

  // The same words as the catalog's rows, so a status reads the same everywhere.
  status: {
    draft: "Bozza",
    pending: "In revisione",
    private: "Privato",
    future: "Programmato",
    other: "Non pubblicato",
  } as Record<string, string>,
  unpublished: "I clienti non lo vedono sul sito.",

  // The switch, and under it what is true now: "Visibile · esaurito".
  visibleSwitch: "Visibile nel negozio",
  shown: {
    visible: "Visibile",
    catalog: "Solo nelle categorie, non nella ricerca",
    search: "Solo nella ricerca",
    hidden: "Nascosto",
    // Not published yet: the switch says how it will show once it is.
    unpublished: "Visibile appena pubblicato",
  },
  stock: {
    instock: "disponibile",
    outofstock: "esaurito",
    onbackorder: "su ordinazione",
  } as Record<string, string>,
  linkOnly: "Si apre solo dal suo link.",
  hiding: "Lo nascondo…",
  showing: "Lo rimetto in vista…",

  categories: "Categorie",
  noCategories: "In nessuna categoria",
  automatic: "automatica, decisa dalla sua regola",
  automaticHint: "Automatica: decisa dalla sua regola. Il prodotto entra ed esce da solo, non si toglie a mano.",
  addCategory: "Categoria",
  addCategoryLabel: "Aggiungi a una categoria",
  removeCategory: (name: string) => `Togli da «${name}»`,
  removing: (name: string) => `Lo tolgo da «${name}»…`,
  brands: "Brand",
  noBrands: "Nessun brand",
  homepage: "Homepage",
  notInHomepage: "Non è in homepage",
  pin: "Metti in homepage",
  section: (title: string, position: number) => `${title} #${position}`,
  sectionLabel: (title: string, position: number, pinned: boolean) =>
    `In homepage: ${title}, posizione ${position}${pinned ? ", fissato" : ""}`,
  // A group whose action is running: said next to its name.
  working: "in corso…",

  sale: {
    title: "Saldo",
    none: "Non è in saldo",
    on: "In saldo",
    price: (price: string) => `Sul sito: ${price}`,
    // Just put on sale, before the site's new price is read.
    onNow: "Prezzo scontato sul sito",
    start: "Metti in saldo",
    stop: "Togli il saldo",
    working: "Aggiorno il saldo…",
  },

  // Before an action that is worth a second thought, from this sheet.
  confirm: {
    cancel: "Annulla",
    loading: "Guardo cosa cambia…",
    starting: "Avvio…",
    nothing: (why: string | null) => (why ? `Non cambia niente: ${why}.` : "Non cambia niente."),
    hide: {
      title: "Nascondere il prodotto?",
      body: "Sparisce dal negozio, dalle categorie e dalla ricerca; il suo link continua a funzionare.",
      confirm: "Nascondi",
    },
    uncategorize: {
      title: (name: string) => `Togliere da «${name}»?`,
      body: (name: string) => `Non compare più tra i prodotti di «${name}».`,
      confirm: "Togli",
    },
  },

  // The section editor's menu.
  openInCatalog: "Apri nel catalogo",
};
