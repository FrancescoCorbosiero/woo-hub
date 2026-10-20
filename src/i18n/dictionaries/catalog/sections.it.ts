/**
 * The Vetrina's strings for the homepage's sections themselves: what a
 * section shows and choosing another, a new section, their order on the
 * page, a section taken away or switched off, and adding products to a
 * section from the catalog. Italian is the source of truth (see ./it.ts).
 */

/** A count as the owner reads it: "1.234". */
const n = (count: number) => count.toLocaleString("it-IT");

const products = (count: number) => (count === 1 ? "1 prodotto" : `${n(count)} prodotti`);

export const sectionsIt = {
  /** What a section shows, in words: its card on the editor and the home screen. */
  shows: {
    label: "Mostra",
    category: (name: string) => `Categoria «${name}»`,
    brand: (name: string) => `Brand «${name}»`,
    tag: (name: string) => `Prodotti con il tag «${name}»`,
    terms: (names: string) => `Più categorie: ${names}`,
    fixed: "Una lista fissa di prodotti",
    list: {
      recent: "Le novità di tutto il negozio",
      best_selling: "I più venduti di tutto il negozio",
      sale: "Tutto quello che è in saldo",
      featured: "I prodotti in evidenza",
      top_rated: "I più votati del negozio",
    } as Record<string, string>,
    count: (all: number, visible: number) =>
      all === visible ? products(all) : `${products(all)} · ${n(visible)} ${visible === 1 ? "visibile" : "visibili"}`,
    visible: (count: number) => (count === 1 ? "1 prodotto visibile" : `${n(count)} prodotti visibili`),
    change: "Cambia",
    changeLabel: (title: string) => `Cambia cosa mostra «${title}»`,
  },

  /** On and off: the section stays on the page, and the site shows it or not. */
  switch: {
    label: "Visibile sul sito",
    on: "La sezione si vede sulla homepage.",
    off: "Spenta: resta qui con i suoi prodotti, ma sul sito non si vede.",
    offBadge: "Spenta",
    turnOff: "Spegni sul sito",
    turnOn: "Riaccendi sul sito",
    turnedOff: (title: string) => `«${title}» spenta: non si vede più sul sito`,
    turnedOn: (title: string) => `«${title}» di nuovo sul sito`,
    draftOff: "Sezione spenta: pubblica per toglierla dal sito",
    draftOn: "Sezione accesa: pubblica per rimetterla sul sito",
  },

  /** Choosing what a section shows: for a new section, or another for one. */
  pick: {
    title: "Cosa mostra la sezione",
    tabs: { category: "Categorie", brand: "Brand", list: "Liste" },
    tabsLabel: "Scegli tra",
    search: { category: "Cerca una categoria", brand: "Cerca un brand" },
    lists: {
      recent: { title: "Novità", hint: "Gli ultimi arrivati di tutto il negozio: si aggiorna da sola." },
      best_selling: { title: "Più venduti", hint: "I prodotti che vendono di più: si aggiorna da sola." },
      sale: { title: "In saldo", hint: "Tutto quello che è in saldo in questo momento." },
      featured: { title: "In evidenza", hint: "I prodotti segnati «in evidenza» su WordPress." },
      top_rated: { title: "Più votati", hint: "I prodotti con le recensioni migliori." },
    } as Record<string, { title: string; hint: string }>,
    listsIntro: "Una lista prende i prodotti da tutto il negozio, senza categorie da tenere aggiornate.",
    current: "Ora",
    automatic: "Automatica",
    empty: "Niente con questo nome",
    loading: "Carico categorie e brand…",
    failed: "Non riesco a leggere categorie e brand.",
    products,
    inHomepage: (titles: string) => `Già in homepage: ${titles}`,
  },

  /** Another source for a section. */
  change: {
    title: "Cambia cosa mostra",
    loading: "Guardo cosa cambia…",
    failed: "Non riesco a vedere cosa cambia.",
    keptPins: (count: number) =>
      count === 1 ? "1 prodotto fissato c'è anche lì: resta al suo posto." : `${n(count)} prodotti fissati ci sono anche lì: restano al loro posto.`,
    droppedPins: (count: number) =>
      count === 1 ? "1 prodotto fissato non c'è: torna libero." : `${n(count)} prodotti fissati non ci sono: tornano liberi.`,
    droppedHidden: (count: number) =>
      count === 1 ? "1 prodotto nascosto non c'è più: non serve nasconderlo." : `${n(count)} prodotti nascosti non ci sono più: non serve nasconderli.`,
    alsoIn: (titles: string) => `La homepage lo mostra già in: ${titles}.`,
    button: (text: string, name: string) => `Il pulsante «${text}» porterà alla pagina di «${name}».`,
    titleField: "Titolo della sezione",
    suggest: (title: string) => `Usa «${title}»`,
    draftLost: (count: number) =>
      count === 1 ? "Hai 1 modifica non pubblicata: andrà persa." : `Hai ${n(count)} modifiche non pubblicate: andranno perse.`,
    start: (name: string) => `Mostra «${name}»`,
    done: (name: string) => `La sezione ora mostra «${name}»`,
    undone: "Sezione com'era prima",
  },

  /** A new section. */
  add: {
    open: "Nuova sezione",
    title: "Nuova sezione",
    where: "Dove",
    whereTop: "In cima, prima di tutte",
    whereAfter: (title: string) => `Dopo «${title}»`,
    eyebrowField: "Sopratitolo (facoltativo)",
    eyebrowPlaceholder: "Es. Selezione esclusiva",
    size: "Prodotti mostrati",
    start: "Aggiungi alla homepage",
    done: (title: string) => `«${title}» aggiunta alla homepage`,
    removedAgain: "Sezione tolta",
    hint: "La sezione appare subito sul sito. Poi scegli quali prodotti mettere in cima.",
  },

  /** A section taken away. */
  remove: {
    open: "Togli dalla homepage",
    confirm: (title: string) =>
      `Togliere «${title}» dalla homepage? I prodotti restano nel negozio, e con «Annulla» la sezione torna com'era.`,
    yes: "Togli",
    no: "Annulla",
    done: (title: string) => `«${title}» tolta dalla homepage`,
    back: (title: string) => `«${title}» di nuovo in homepage`,
  },

  /** Their order on the page. */
  arrange: {
    open: "Sposta le sezioni",
    title: "Sposta le sezioni",
    intro:
      "Trascina dalla maniglia, o usa le frecce. Le sezioni si scambiano di posto: banner, slider e loghi restano dove sono.",
    up: (title: string) => `Sposta su «${title}»`,
    down: (title: string) => `Sposta giù «${title}»`,
    moveUp: "Sposta su",
    moveDown: "Sposta giù",
    save: "Salva",
    nothing: "Sposta una sezione per cambiarne il posto.",
    done: "Sezioni spostate",
    undone: "Sezioni di nuovo come prima",
    off: "spenta",
  },

  /** The section editor's card for what follows the pinned products. */
  auto: {
    title: "Dopo i fissati, in automatico",
    /** "Negozio" follows the term's own positions in the shop: set them from here. */
    shop: (name: string) => `«Negozio» segue le posizioni dei prodotti nella pagina «${name}» del negozio.`,
    shopAny: "«Negozio» segue le posizioni che i prodotti hanno nel negozio.",
    arrange: (name: string) => `Disponi «${name}» a mano`,
    ranking: "Disponi come una classifica…",
    moved: (label: string) => `Dopo i fissati, ora in automatico: ${label}`,
  },

  /** A section's card on the home screen: its menu and its quick action. */
  menu: {
    open: (title: string) => `Azioni per «${title}»`,
    edit: "Apri la sezione",
    addProducts: "Aggiungi prodotti",
    change: "Cambia cosa mostra…",
    addBelow: "Nuova sezione qui sotto",
    viewSite: "Vedi sul sito",
    cancel: "Annulla",
  },
  quick: {
    add: "Aggiungi prodotti",
    edit: "Modifica",
  },

  /** What a write of the page says when it fails or is undone. */
  undo: "Annulla",
  undoFailed: "Non riesco ad annullare: la homepage è cambiata nel frattempo.",
  /** The site's plugin can do none of this yet: for whoever runs the site. */
  outdated: "Per aggiungere, spostare e cambiare le sezioni da qui serve il plugin Golden Hive Blocks 5.15.0 sul sito.",
};
