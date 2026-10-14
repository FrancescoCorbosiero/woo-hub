/**
 * The Vetrina catalog's server-side words for acting on products: an
 * action's label (built from its stored parameters each time it is shown,
 * so it reads in the owner's language), a preview's reasons, before → after
 * and warnings, and the refusals. The server picks them in the language of
 * the request (src/server/vetrina/operations/words.ts). Italian is the
 * source of truth (see ./it.ts).
 */

import { MAX_OPERATION_PRODUCTS } from "@/lib/vetrina/catalog-ops";

/** A count as the owner reads it: "1.234". */
const n = (count: number) => count.toLocaleString("it-IT");
const products = (count: number) => (count === 1 ? "1 prodotto" : `${n(count)} prodotti`);
/** "1 prodotto nascosto", "3 prodotti nascosti": a count and a word that agrees with it. */
const agreed = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${n(count)} ${many}`);

/** "Nike", "Nike e Adidas", "Nike, Adidas e Puma", "Nike, Adidas e altri 3". */
function nameList(names: readonly string[], total = names.length): string {
  const more = total - names.length;
  if (more > 0) return `${names.join(", ")} e ${more === 1 ? "un altro" : `altri ${n(more)}`}`;
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

export const opsIt = {
  products,
  nameList,

  /** An action in the log, the toasts and the activity sheet. */
  label: {
    hide: (count: number, term: string | null) =>
      `${agreed(count, "prodotto nascosto", "prodotti nascosti")}${term ? ` · ${term}` : ""}`,
    show: (count: number) => agreed(count, "prodotto di nuovo visibile", "prodotti di nuovo visibili"),
    /** `what`: the whole term's name, or the products' count. */
    sale: (percent: number, what: string) => `Saldo −${percent}% · ${what}`,
    unsale: (what: string) => `Saldo tolto · ${what}`,
    tag: (tag: string, count: number) => `Tag «${tag}» a ${products(count)}`,
    untag: (tag: string, count: number) => `Tag «${tag}» tolto da ${products(count)}`,
    categorize: (category: string, count: number) => `Categoria «${category}» a ${products(count)}`,
    uncategorize: (category: string, count: number) => `Categoria «${category}» tolta da ${products(count)}`,
    pin: (count: number, section: string) => `${agreed(count, "prodotto fissato", "prodotti fissati")} in ${section}`,
  },

  /** Why a preview leaves products as they are, agreeing with how many ("Già nascosto · 1", "Già nascosti · 3"). */
  untouched: {
    gone: (count: number): string => (count === 1 ? "non è più nel negozio" : "non sono più nel negozio"),
    alreadyHidden: (count: number): string => (count === 1 ? "già nascosto" : "già nascosti"),
    alreadyVisible: (count: number): string => (count === 1 ? "già visibile" : "già visibili"),
    noPrice: (_count: number): string => "senza prezzo",
    notLower: (_count: number): string => "il saldo non sarebbe più basso",
    same: (_count: number): string => "già in saldo così",
    noSale: (count: number): string => (count === 1 ? "non è in saldo" : "non sono in saldo"),
    hasTag: (count: number): string => (count === 1 ? "ha già il tag" : "hanno già il tag"),
    noTag: (count: number): string => (count === 1 ? "non ha il tag" : "non hanno il tag"),
    inCategory: (count: number): string => (count === 1 ? "è già nella categoria" : "sono già nella categoria"),
    notInCategory: (count: number): string => (count === 1 ? "non è nella categoria" : "non sono nella categoria"),
    automatic: (_count: number): string => "la categoria è automatica",
    notInSection: (count: number): string => (count === 1 ? "non è in questa sezione" : "non sono in questa sezione"),
    overMax: (_count: number, max: number): string => `oltre i ${n(max)} fissati`,
    /** Hidden by another whole category or brand the owner hid: its own "Mostra" brings them back. */
    held: (count: number, terms: string[]): string =>
      `${count === 1 ? "resta nascosto" : "restano nascosti"} da ${nameList(terms.map((t) => `«${t}»`))}`,
  },

  /** A product's state, before → after, in a preview's sample. */
  state: {
    visibility: (visibility: string): string =>
      visibility === "hidden"
        ? "Nascosto"
        : visibility === "catalog"
          ? "Solo nel catalogo"
          : visibility === "search"
            ? "Solo nella ricerca"
            : "Visibile",
    noTerms: "Nessuno",
    noPrice: "Senza prezzo",
    from: (price: string) => `da ${price}`,
    pinned: (position: number) => `#${position} fissato`,
    shown: (position: number) => `#${position}`,
    notShown: "Non in vista",
    addedTo: (category: string) => `In «${category}», poi fissato`,
  },

  warning: {
    alsoElsewhere: (count: number, names: string[], total: number) =>
      `${count === 1 ? "1 è" : `${n(count)} sono`} anche in ${nameList(names, total)}: ${count === 1 ? "sparisce" : "spariscono"} anche lì.`,
    sectionsLose: (sections: string[]) => `La homepage perde prodotti in ${nameList(sections)}.`,
    sectionsShow: (sections: string[]) => `In homepage: ${nameList(sections)}.`,
    repricing: (count: number) =>
      `Per ${products(count)} l'Hub ricalcola il prezzo anche in saldo: durante il saldo il prezzo pieno può cambiare (quello scontato resta).`,
    /** Of the products read live: their own sale is deeper than this one, so their price goes up. */
    deeperSale: (count: number) =>
      count === 1
        ? "1 ha già uno sconto più forte: con questo saldo il suo prezzo sale."
        : `${n(count)} hanno già uno sconto più forte: con questo saldo il loro prezzo sale.`,
    /** A sale with an end date over products already on sale: WooCommerce ends the whole sale on that day. */
    ownSaleEnds: (count: number) =>
      count === 1
        ? "1 è già in saldo per conto suo: alla fine di questo saldo perde anche quello sconto e torna a prezzo pieno."
        : `${n(count)} sono già in saldo per conto loro: alla fine di questo saldo perdono anche quello sconto e tornano a prezzo pieno.`,
    noCategoryLeft: (count: number) =>
      `${count === 1 ? "1 resta" : `${n(count)} restano`} senza categoria: WooCommerce ${count === 1 ? "lo mette" : "li mette"} in quella predefinita.`,
    newTag: (tag: string) => `Il tag «${tag}» non c'è ancora: lo creo.`,
    categoryAdded: (count: number, category: string) =>
      `${count === 1 ? "1 prodotto non è" : `${n(count)} prodotti non sono`} in «${category}»: ${count === 1 ? "lo aggiungo" : "li aggiungo"}, così si vede nella sezione.`,
    shownAgain: (count: number) =>
      `${count === 1 ? "1 era nascosto" : `${n(count)} erano nascosti`} da questa sezione: ${count === 1 ? "torna" : "tornano"} a vedersi.`,
    dropped: (count: number, max: number) =>
      `${count === 1 ? "1 prodotto fissato prima esce" : `${n(count)} prodotti fissati prima escono`} dalle posizioni fisse (al massimo ${n(max)}).`,
  },

  error: {
    tooMany: (total: number) =>
      `Sono ${n(total)} prodotti: al massimo ${n(MAX_OPERATION_PRODUCTS)} alla volta. Restringi con i filtri.`,
    empty: "Nessun prodotto scelto.",
    alreadyHidden: (term: string) => `I prodotti di «${term}» sono già nascosti: per rimetterli in vista usa «Mostra».`,
    automatic: (category: string) => `«${category}» è automatica: i suoi prodotti li decide la regola.`,
    categoryGone: "Questa categoria non c'è più nel negozio.",
    termGone: "Questa categoria o questo brand non c'è più nel negozio.",
    tagGone: "Questo tag non c'è più nel negozio.",
    tagRefused: (tag: string) => `Il negozio non ha creato il tag «${tag}».`,
    notPinnable: "In questa sezione non si fissano prodotti dalla Vetrina.",
    nothingToPin: (section: string) => `Nessuno di questi prodotti può stare in ${section}.`,
    notFound: "Questa azione non c'è più nel registro.",
    stillRunning: "È ancora in corso: aspetta che finisca, poi annulla.",
    alreadyUndone: "È già stata annullata.",
    undoing: "La sto già annullando.",
    nothingToUndo: "Non ha cambiato niente: non c'è niente da annullare.",
    tooOld: (days: number) => `Si può annullare solo nei primi ${days} giorni.`,
    sectionChanged: (title: string) =>
      `La sezione «${title}» è cambiata dopo: rimetti a posto l'ordine dall'editor della sezione.`,
    interrupted: "Interrotta: il server si è riavviato prima della fine.",
    /** A failure the run did not foresee (the store not answering, the database): its own words after ours. */
    stopped: (message: string) => `Interrotta da un errore: ${message}`,
    undoInterrupted: "Annullamento interrotto: il server si è riavviato. Riprova.",
    undoFailed: (message: string) => `Annullamento non riuscito: ${message}`,
  },

  /** What the screens sent, checked before anything runs: the problems the owner can fix, in his words. */
  input: {
    invalid: "Richiesta non valida.",
    operation: "Azione non valida.",
    term: "Categoria o brand non valido.",
    /** A whole term's action must act on that whole term, no filter. */
    termTarget: "Un'azione su tutta la categoria o il brand vale per tutti i suoi prodotti.",
    date: "Data non valida.",
    pastDate: "La data di fine è già passata.",
    percent: "Lo sconto va da 1 a 90%.",
    tagName: "Scrivi il nome del tag.",
  },
};
