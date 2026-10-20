/**
 * The Vetrina's strings for adding products to a homepage section from the
 * catalog: the picker sheet, and what the section editor says of the
 * products added until they are published. Italian is the source of truth
 * (see ./it.ts).
 */

/** A count as the owner reads it: "1.234". */
const n = (count: number) => count.toLocaleString("it-IT");

export const pickerIt = {
  open: "Aggiungi",
  /** The section editor's list, above its products. */
  listTitle: "Prodotti della sezione",
  openLong: "Aggiungi prodotti dal catalogo",
  openLabel: (section: string) => `Aggiungi prodotti a «${section}»`,
  title: (section: string) => `Aggiungi a «${section}»`,
  /** What may join the section, by what fills it. */
  intro: {
    category: (name: string) => `Scegli dal catalogo: quelli che non sono in «${name}» ci entrano quando pubblichi.`,
    automatic: (name: string) =>
      `In «${name}» entra chi rispetta la sua regola: qui scegli tra i suoi prodotti quelli da mettere in cima.`,
    brand: (name: string) => `La sezione mostra «${name}»: scegli tra i suoi prodotti quelli da mettere in cima.`,
    sale: "La sezione mostra i prodotti in saldo: scegli quelli da mettere in cima.",
    list: "Scegli dal catalogo: vanno in cima alla sezione.",
  },
  search: "Cerca per nome o SKU",
  sortLabel: "Mostra prima",
  sort: { newest: "Novità", bestselling: "Più venduti", name: "A–Z" },
  filters: { instock: "Disponibili", onSale: "In saldo" },
  filtersLabel: "Filtri",
  /** On a row. */
  shown: (position: number) => `In sezione · #${position}`,
  pinned: "Fissato qui",
  joins: (name: string) => `Entra in «${name}»`,
  soldOut: "Esaurito: si vedrà quando torna disponibile",
  hidden: "Nascosto dal negozio: non si vedrà",
  picked: (count: number) => (count === 1 ? "1 scelto" : `${n(count)} scelti`),
  clear: "Togli tutti",
  loading: "Carico i prodotti…",
  loadMore: "Carica altri",
  loadingMore: "Carico altri prodotti…",
  failed: "Non riesco a caricare i prodotti.",
  retry: "Riprova",
  empty: "Nessun prodotto qui",
  emptySearch: (q: string) => `Nessun prodotto per «${q}»`,
  place: { label: "Dove vanno", top: "In cima", afterPins: "Dopo i fissati" },
  start: (count: number) =>
    count === 0 ? "Scegli i prodotti" : count === 1 ? "Aggiungi 1 prodotto" : `Aggiungi ${n(count)} prodotti`,
  room: (max: number) => `Al massimo ${max} prodotti fissati per sezione.`,
  added: (count: number) =>
    count === 1 ? "1 prodotto aggiunto: pubblica per vederlo sul sito" : `${n(count)} prodotti aggiunti: pubblica per vederli sul sito`,

  /** In the section editor's list, until published. */
  newBadge: "Nuovo",
  willJoin: (name: string) => `Entra in «${name}» quando pubblichi`,
  /** Publishing with products that join the category first. */
  joining: (name: string) => `Aggiungo a «${name}»…`,
  joinFailed: "Non sono riuscito a metterli nella categoria: la sezione non è stata pubblicata. Riprova.",
};
