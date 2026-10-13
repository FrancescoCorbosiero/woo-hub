/**
 * The Vetrina catalog's strings: the product sheet's "Nel negozio" (where the
 * product lives in the shop) and the section editor's way into the catalog.
 * Italian is the source of truth (see ../catalog/it.ts).
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
  visible: "Visibile nel negozio",
  hidden: "Nascosto dal negozio — si apre solo dal suo link",
  // Not published yet, so not even its link opens it: only the hiding is worth saying.
  hiddenUnpublished: "Nascosto dal negozio",

  categories: "Categorie",
  noCategories: "In nessuna categoria",
  automatic: "automatica",
  automaticHint: "Automatica: il prodotto entra ed esce da solo, secondo la regola della categoria.",
  brands: "Brand",
  noBrands: "Nessun brand",
  homepage: "Homepage",
  notInHomepage: "Non è in homepage",
  section: (title: string, position: number) => `${title} #${position}`,
  sectionLabel: (title: string, position: number, pinned: boolean) =>
    `In homepage: ${title}, posizione ${position}${pinned ? ", fissato" : ""}`,

  // The section editor's menu.
  openInCatalog: "Apri nel catalogo",
};
