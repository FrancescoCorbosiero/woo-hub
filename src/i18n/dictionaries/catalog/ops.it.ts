/**
 * The Vetrina catalog's server-side words for acting on products: an
 * action's label (built from its stored parameters each time it is shown,
 * so it reads in the owner's language), a preview's reasons, before → after
 * and warnings, and the refusals. The server picks them in the language of
 * the request (src/server/vetrina/operations/words.ts). Italian is the
 * source of truth (see ./it.ts).
 */

import { MAX_OPERATION_PRODUCTS, MAX_TERM_PRODUCTS } from "@/lib/vetrina/catalog-ops";

/** A sale's last day as the owner reads it: "31 ottobre". */
const longDay = (day: string) =>
  new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

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
  /** A price as the owner reads it: "102,99 €" (in English, "€102.99"). */
  money: (amount: number): string => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(amount),
  products,
  nameList,

  /** An action in the log, the toasts and the activity sheet. */
  label: {
    hide: (count: number, term: string | null) =>
      `${agreed(count, "prodotto nascosto", "prodotti nascosti")}${term ? ` · ${term}` : ""}`,
    show: (count: number) => agreed(count, "prodotto di nuovo visibile", "prodotti di nuovo visibili"),
    /** `what`: the whole term's name, or the products' count. */
    sale: (percent: number, what: string) => `Saldo −${percent}% · ${what}`,
    /** The same discount, another last day: what "Cambia lo sconto" did when only the end moved. */
    saleEnds: (percent: number, what: string, endsOn: string | null) =>
      `Saldo −${percent}% · ${what}: ${endsOn ? `ora fino al ${longDay(endsOn)}` : "ora senza fine"}`,
    unsale: (what: string) => `Saldo tolto · ${what}`,
    tag: (tag: string, count: number) => `Tag «${tag}» a ${products(count)}`,
    untag: (tag: string, count: number) => `Tag «${tag}» tolto da ${products(count)}`,
    categorize: (category: string, count: number) => `Categoria «${category}» a ${products(count)}`,
    uncategorize: (category: string, count: number) => `Categoria «${category}» tolta da ${products(count)}`,
    pin: (count: number, section: string) => `${agreed(count, "prodotto fissato", "prodotti fissati")} in ${section}`,
    /** A category's or brand's margin; no percent: its own margin taken away (back to the one above it, or the standard). */
    margin: (percent: number | null, what: string) => (percent == null ? `Ricarico tolto · ${what}` : `Ricarico ${percent}% · ${what}`),
    /** Products placed among a category's or brand's positions; position null: at the end. */
    order: (count: number, term: string, position: number | null) =>
      `${agreed(count, "prodotto", "prodotti")} ${position === 1 ? "in cima" : position == null ? "in fondo" : `alla posizione ${n(position)}`} · ${term}`,
    /** Products dragged to places apart among a category's or brand's positions ("Disponi a mano"). */
    reorder: (count: number, term: string) => `Disposti a mano · ${term}: ${agreed(count, "prodotto spostato", "prodotti spostati")}`,
    /** "Disponi come «X»" on a term, or on the whole catalog (`what`). */
    sourceOrder: (count: number, source: string, what: string) =>
      `Come «${source}» · ${what}: ${agreed(count, "prodotto spostato", "prodotti spostati")}`,
    /** The homepage's own actions, on its sections and blocks. */
    sectionSwitch: (section: string, on: boolean) => (on ? `«${section}» riaccesa sul sito` : `«${section}» spenta sul sito`),
    sectionMove: (section: string, position: number) => `«${section}» spostata al ${n(position)}° posto`,
    sectionsArrange: (count: number) => agreed(count, "sezione spostata", "sezioni spostate"),
    sectionAdd: (section: string) => `Nuova sezione «${section}»`,
    sectionRemove: (section: string) => `«${section}» tolta dalla homepage`,
    sectionSource: (section: string, shows: string) => `«${section}» ora mostra ${shows}`,
    sectionEdit: (section: string) => `«${section}» pubblicata`,
    blockEdit: (block: string) => `Testi di «${block}» salvati`,
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
    /** A margin's products the supplier's feed prices: its price already holds its margin, and passes through. */
    supplier: (_count: number): string => "prezzo del fornitore (GoldenSneakers)",
    /** Store-only: priced by hand in the shop, no Hub price to change. */
    storeOnly: (_count: number): string => "prezzo deciso nel negozio, non dall'Hub",
    /** A rule more specific than the term's decides them: a SKU's, a deeper category's or brand's. */
    otherRule: (count: number): string => (count === 1 ? "ha un ricarico più specifico" : "hanno un ricarico più specifico"),
    noQuote: (_count: number): string => "nessun prezzo di mercato",
    notInTerm: (count: number, term: string): string => (count === 1 ? `non è in «${term}»` : `non sono in «${term}»`),
    inPlace: (count: number): string => (count === 1 ? "già al suo posto" : "già al loro posto"),
    /** A term's products a source does not rank: after the ranked ones, in their order. */
    notRanked: (count: number, source: string): string =>
      `${count === 1 ? "non è" : "non sono"} in «${source}»: ${count === 1 ? "resta dopo, al suo posto" : "restano dopo, come sono"}`,
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
    until: (day: string) => `fino al ${longDay(day)}`,
    noEnd: "senza fine",
    addedTo: (category: string) => `In «${category}», poi fissato`,
    /** A product's place among a category's or brand's positions. */
    place: (position: number) => `#${n(position)}`,
  },

  warning: {
    /** The shop's positions are one number per product: a product moved here moves in its other categories and brands too. */
    orderElsewhere: (count: number, names: string[], total: number) =>
      `Nel negozio ogni prodotto ha una posizione sola: ${count === 1 ? "1 è" : `${n(count)} sono`} anche in ${nameList(names, total)}, e lì ${count === 1 ? "cambia" : "cambiano"} posto allo stesso modo.`,
    /** Products renumbered to make room: their place does not change. */
    orderRoom: (count: number) =>
      `Per fare spazio cambio il numero di posizione di ${count === 1 ? "1 altro prodotto: il suo posto resta lo stesso." : `altri ${n(count)} prodotti: il loro posto resta lo stesso.`}`,
    /** A homepage section shows this category: its pins come first on the category's page. */
    orderPins: (sections: string[]) =>
      `Sulla pagina della categoria vengono prima i prodotti fissati in ${nameList(sections.map((s) => `«${s}»`))}, poi queste posizioni.`,
    /** Items of a source no product of the shop matched (used on the whole catalog). */
    sourceUnmatched: (count: number, total: number) =>
      `${count === 1 ? "1 prodotto" : `${n(count)} prodotti`} della classifica su ${n(total)} non ${count === 1 ? "corrisponde" : "corrispondono"} a nessun prodotto del negozio: ${count === 1 ? "è ignorato" : "sono ignorati"}.`,
    /** The storefront's default sort is not the shop's own positions: they are saved, but the pages do not follow them. */
    orderNotUsed: (sort: string) =>
      `Il negozio mostra le pagine per «${sort}», non per le posizioni scelte a mano: le posizioni vengono salvate ma le pagine non le seguono finché in WooCommerce › Impostazioni › Prodotti l'ordinamento predefinito non è «Ordinamento personalizzato + nome».`,
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
      `${count === 1 ? "1 prodotto non è" : `${n(count)} prodotti non sono`} in «${category}»: ${count === 1 ? "lo aggiungo, così si vede" : "li aggiungo, così si vedono"} nella sezione.`,
    /** Products put into a category that is (or sits under) a hidden one: hidden with it. */
    /** Products a category move puts under another margin (a category's or brand's): repriced right after. */
    marginMoves: (count: number) =>
      count === 1
        ? "1 prodotto cambia ricarico con la categoria: il suo prezzo si aggiorna subito dopo."
        : `${n(count)} prodotti cambiano ricarico con la categoria: il loro prezzo si aggiorna subito dopo.`,
    intoHidden: (count: number, term: string) =>
      `«${term}» non è visibile nel negozio: ${count === 1 ? "anche il prodotto che aggiungo viene nascosto" : `anche i ${n(count)} prodotti che aggiungo vengono nascosti`}.`,
    shownAgain: (count: number) =>
      `${count === 1 ? "1 era nascosto" : `${n(count)} erano nascosti`} da questa sezione: ${count === 1 ? "torna" : "tornano"} a vedersi.`,
    dropped: (count: number, max: number) =>
      `${count === 1 ? "1 prodotto fissato prima esce" : `${n(count)} prodotti fissati prima escono`} dalle posizioni fisse (al massimo ${n(max)}).`,
    /** Sizes whose price the owner locked: a margin never moves them. */
    lockedSizes: (count: number) =>
      count === 1 ? "1 taglia ha il prezzo bloccato: lo tiene." : `${n(count)} taglie hanno il prezzo bloccato: lo tengono.`,
    /** Sizes on sale: the plan holds their regular price while the sale lasts. */
    saleSizes: (count: number) =>
      count === 1
        ? "1 taglia è in saldo: il suo prezzo pieno cambia quando finisce il saldo."
        : `${n(count)} taglie sono in saldo: il loro prezzo pieno cambia quando finisce il saldo.`,
    /** Sizes whose new price is within the rules' minimum change: the sync leaves them (no churn for cents). */
    belowMinSizes: (count: number) =>
      count === 1
        ? "1 taglia resta com'è: il nuovo prezzo è troppo vicino a quello di adesso per cambiarlo."
        : `${n(count)} taglie restano come sono: il nuovo prezzo è troppo vicino a quello di adesso per cambiarlo.`,
    /** Sizes whose change would pass the rules' maximum: the sync blocks it. */
    overMaxSizes: (count: number) =>
      count === 1
        ? "1 taglia resta com'è: cambierebbe più del massimo che le regole dell'Hub permettono."
        : `${n(count)} taglie restano come sono: cambierebbero più del massimo che le regole dell'Hub permettono.`,
    /** Sizes whose price was changed on WordPress since the Hub wrote it: kept, as by every sync. */
    editedSizes: (count: number) =>
      count === 1
        ? "1 taglia ha il prezzo cambiato su WordPress: lo tiene."
        : `${n(count)} taglie hanno il prezzo cambiato su WordPress: lo tengono.`,
  },

  error: {
    tooMany: (total: number) =>
      `Sono ${n(total)} prodotti: al massimo ${n(MAX_OPERATION_PRODUCTS)} alla volta. Restringi con i filtri.`,
    /** A whole term's own action over more products than the store index holds: it cannot be narrowed. */
    termTooBig: (total: number) =>
      `Sono ${n(total)} prodotti: più di quanti il catalogo ne tiene (${n(MAX_TERM_PRODUCTS)}). Agisci su una sottocategoria alla volta.`,
    empty: "Nessun prodotto scelto.",
    /** "Posiziona" with nothing to move. */
    inOrder: "Sono già in queste posizioni.",
    notInTerm: (term: string) => `Nessuno di questi prodotti è in «${term}».`,
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
      `La sezione «${title}» è cambiata dopo: rimetti a posto i prodotti dall'editor della sezione.`,
    /** A request that failed on the server (a query, the store's own text): never shown, its log keeps it. */
    unexpected: "Non riuscito, per un problema del server: riprova tra poco.",
    interrupted: "Interrotta: il server si è riavviato prima della fine.",
    /** A failure the run did not foresee (the store not answering, the database): its own words after ours. */
    stopped: (message: string) => `Interrotta da un errore: ${message}`,
    undoInterrupted: "Annullamento interrotto: il server si è riavviato. Riprova.",
    undoFailed: (message: string) => `Annullamento non riuscito: ${message}`,
    /** The demo shop's terms are not the Hub's: a margin there would land on real prices. */
    marginDemo: "Nella demo il ricarico non si cambia: finirebbe sui prezzi veri dell'Hub.",
    marginSame: (term: string, percent: number) => `«${term}» ha già il ricarico al ${percent}%.`,
    marginNone: (term: string) => `«${term}» non ha un ricarico suo da togliere.`,
    /** The rule list is full: one cap for the Vetrina and the Hub's Margins tab. */
    marginFull: (max: number) => `L'Hub ha già ${n(max)} regole di prezzo, il massimo: togline una dalla scheda Margini dell'Hub, poi riprova.`,
    /** The store's categories and brands cannot be read: no margin set half-blind. */
    marginTermsUnknown: "Adesso non riesco a leggere categorie e brand del negozio: riprova tra poco.",
    /** The rule is saved; KicksDB did not answer for some products, so their prices wait. */
    repriceUnanswered: (count: number) =>
      `Ricarico salvato, ma per ${products(count)} il mercato (KicksDB) non ha risposto: il prossimo aggiornamento dei prezzi li allinea.`,
    marginNoSnapshot: "L'Hub non ha ancora letto il negozio: aggiornalo dalla scheda Sync, poi riprova.",
    marginChanged: (term: string) => `Il ricarico di «${term}» è cambiato dopo: cambialo di nuovo da qui.`,
    /** The rule is saved; the prices could not all be written now. */
    repriceFailed: (message: string) =>
      `Ricarico salvato, ma i prezzi non si sono aggiornati tutti (${message}): il prossimo aggiornamento dei prezzi li allinea.`,
  },

  /** Order sources ("classifiche"): what the server says of one. */
  source: {
    /** The whole shop, where a source's ranking is used on all of it. */
    wholeCatalog: "tutto il catalogo",
    parse: {
      empty: "Il testo è vuoto: incolla la classifica o carica il file.",
      invalidJson: "Il JSON non si legge: controlla parentesi e virgolette (o incolla la risposta dell'LLM così com'è).",
      noItems: "Non trovo prodotti nel testo: servono un elenco «items» con «sku» e/o «name», o un prodotto per riga.",
      tooMany: (max: number) => `Sono più di ${n(max)} prodotti: dividili in più classifiche.`,
    },
    nameMissing: "Dai un nome alla classifica.",
    nameTaken: (name: string) => `Esiste già una classifica «${name}»: scegli un altro nome, o sostituisci quella.`,
    tooManySources: (max: number) => `Ci sono già ${n(max)} classifiche, il massimo: eliminane una.`,
    gone: "Questa classifica non c'è più.",
    /** None of the term's products is in the source. */
    noneInTerm: (term: string, source: string) => `Nessun prodotto di «${term}» è nella classifica «${source}».`,
    noneInShop: (source: string) => `Nessun prodotto della classifica «${source}» è nel negozio.`,
    inOrder: (source: string) => `È già disposto come «${source}».`,
  },

  /**
   * The homepage's own actions (src/server/vetrina/operations/page.ts): a
   * preview in sentences, for a reader without the screens (the API, an
   * assistant), and the refusals.
   */
  page: {
    switchOff: (title: string) => `«${title}» resta nella homepage ma non si vede più sul sito.`,
    switchOn: (title: string) => `«${title}» torna visibile sul sito.`,
    moved: (title: string, from: number, to: number) => `«${title}» passa dal ${n(from)}° al ${n(to)}° posto tra le sezioni.`,
    order: (titles: readonly string[]) => `Le sezioni, dall'alto: ${titles.map((title, i) => `${i + 1}. «${title}»`).join(" · ")}.`,
    add: (title: string, shows: string, limit: number) => `Nuova sezione «${title}»: ${shows}, ${products(limit)}.`,
    addPlace: (place: "after" | "before", anchor: string) => `${place === "after" ? "Va dopo" : "Va prima di"} «${anchor}».`,
    remove: (title: string) => `«${title}» esce dalla homepage; i suoi prodotti restano nel negozio.`,
    source: (title: string, from: string, to: string) => `«${title}» mostrerà ${to} invece di ${from}.`,
    keptPins: (count: number) =>
      count === 1 ? "1 prodotto in posizione fissa resta al suo posto." : `${n(count)} prodotti in posizione fissa restano al loro posto.`,
    droppedPins: (count: number) =>
      count === 1
        ? "1 prodotto in posizione fissa non c'è nella nuova scelta: torna come gli altri."
        : `${n(count)} prodotti in posizione fissa non ci sono nella nuova scelta: tornano come gli altri.`,
    buttonFollows: "Il pulsante della sezione porterà alla nuova pagina.",
    alsoIn: (titles: readonly string[]) => `È già nella homepage in ${nameList(titles.map((title) => `«${title}»`))}.`,
    pins: (count: number) => (count === 0 ? "Nessun prodotto in posizione fissa." : `In cima, in posizione fissa: ${products(count)}.`),
    hidden: (count: number) => (count === 0 ? "Nessun prodotto nascosto dalla sezione." : `Nascosti dalla sezione: ${products(count)}.`),
    fallback: (name: string) => `Dopo quelli fissi, in automatico: ${name}.`,
    fields: (names: readonly string[]) => `Cambiano: ${nameList(names)}.`,
    limit: (count: number) => `Mostra ${products(count)}.`,
    /** Refusals. */
    stale: "La homepage è stata modificata nel frattempo: ricarica.",
    unchanged: "Non cambia niente: è già così.",
    alreadyOn: (title: string) => `«${title}» è già accesa.`,
    alreadyOff: (title: string) => `«${title}» è già spenta.`,
    samePlace: (title: string, position: number) => `«${title}» è già al ${n(position)}° posto.`,
    sameSequence: "Le sezioni sono già messe così.",
    notFound: "Sezione non trovata: forse è stata tolta dalla homepage.",
    blockNotFound: "Blocco non trovato: forse la homepage è cambiata.",
    changedSince: (title: string) => `«${title}» è cambiata dopo: annullare toglierebbe le modifiche più recenti.`,
    sectionsChanged: "Le sezioni della homepage sono cambiate dopo: annullare toglierebbe le modifiche più recenti.",
    neighbourGone: (title: string) => `Non trovo più la sezione accanto a cui stava «${title}»: rimettila da «Nuova sezione».`,
    notUndoable: "Questa sezione mostrava una lista fissa o dei tag: da qui non si rimette com'era.",
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
    marginPercent: "Il ricarico va da 0 a 200%.",
  },
};
