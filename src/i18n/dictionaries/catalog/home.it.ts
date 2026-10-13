import type { QuickView } from "@/lib/vetrina/catalog";

/**
 * The Vetrina catalog's strings: the tab bar and the catalog's home (lists,
 * quick views, search). Italian is the source of truth (see ../catalog/it.ts).
 */
export const homeIt = {
  title: "Catalogo",
  tabs: { homepage: "Homepage", catalog: "Catalogo" },
  search: "Cerca nel catalogo",
  segments: { category: "Categorie", brand: "Brand" },

  views: {
    soldout: "Esauriti",
    onsale: "In saldo",
    hidden: "Nascosti",
    nophoto: "Senza foto",
    nocategory: "Senza categoria",
    unpublished: "Non pubblicati",
  } satisfies Record<QuickView, string>,
  viewsLabel: "Viste rapide",

  groups: {
    inHomepage: "In homepage",
    automatic: "Automatiche",
    allCategories: "Tutte le categorie",
  },
  inHomepageMark: "In homepage",
  order: {
    name: "A–Z",
    count: "Per numero",
    toName: "Ordina dalla A alla Z",
    toCount: "Ordina per numero di prodotti",
  },
  showEmpty: (n: number) => (n === 1 ? "Mostra 1 vuota" : `Mostra ${n} vuote`),
  hideEmpty: "Nascondi le vuote",
  showEmptyBrands: (n: number) => (n === 1 ? "Mostra 1 brand vuoto" : `Mostra ${n} brand vuoti`),
  hideEmptyBrands: "Nascondi i brand vuoti",
  noCategories: "Nel negozio non ci sono ancora categorie.",
  noBrands: "Nel negozio non ci sono ancora brand.",
  soldOut: (n: number) => (n === 1 ? "1 esaurito" : `${n} esauriti`),
  hidden: (n: number) => (n === 1 ? "1 nascosto" : `${n} nascosti`),

  firstRead: {
    title: "Sto leggendo il negozio…",
    body: "La prima volta ci vuole qualche secondo. La pagina si aggiorna da sola.",
    retry: "Riprova",
  },

  results: {
    categories: "Categorie",
    brands: "Brand",
    products: "Prodotti",
    none: (q: string) => `Nessun risultato per «${q}»`,
    hint: "Cerca per nome o per SKU: contano tutte le parole, in qualsiasi ordine.",
    showAll: (n: number) => `Mostra tutti i ${n} prodotti`,
    showMore: (n: number) => (n === 1 ? "Mostra l'ultimo" : `Mostra altri ${n}`),
    failed: "La ricerca non è andata a buon fine.",
    retry: "Riprova",
  },
};
