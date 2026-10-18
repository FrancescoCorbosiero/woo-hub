/**
 * The Vetrina catalog's strings for acting on products: the selection and its
 * bar, the sheets (saldo, nascondi e mostra, tag, categoria, homepage), the
 * progress of an action, "Annulla" and the activity log. Italian is the
 * source of truth (see ./it.ts). The server's own words — an action's label,
 * a preview's reasons and warnings, a refusal — are in ./ops.it.ts.
 */
/** A count as the owner reads it: "1.234". */
const n = (count: number) => count.toLocaleString("it-IT");

/** "in «Nike»", "in «Nike» e «Adidas»", "in «Nike», «Adidas» e altri 2". */
function inTerms(names: readonly string[]): string {
  const list = names.slice(0, 2).map((name) => `«${name}»`);
  const more = names.length - list.length;
  const said = more > 0 ? `${list.join(", ")} e ${more === 1 ? "un altro" : `altri ${n(more)}`}` : list.join(" e ");
  return `in ${said},`;
}
const products = (count: number) => (count === 1 ? "1 prodotto" : `${n(count)} prodotti`);
/** "1 prodotto rifiutato", "3 prodotti rifiutati": the count and a word that agrees with it. */
const agreed = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${n(count)} ${many}`);
/** "Saldi", "Saldi e Nike", "Saldi, Nike e Outlet". */
const names = (list: readonly string[]) =>
  list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;

export const actIt = {
  select: {
    button: "Seleziona",
    buttonLabel: "Seleziona dei prodotti per agire su tutti insieme",
  },

  bar: {
    label: "Azioni sui prodotti scelti",
    cancel: "Annulla",
    none: "Scegli i prodotti",
    count: (count: number) => (count === 1 ? "1 selezionato" : `${n(count)} selezionati`),
    all: (count: number) => (count === 1 ? "1 selezionato" : `Tutti i ${n(count)} selezionati`),
    selectAll: (count: number) => `Seleziona tutti (${n(count)})`,
    selectAllShort: (count: number) => `Tutti (${n(count)})`,
    deselect: "Deseleziona",
    tooMany: (max: number) => `Troppi: al massimo ${n(max)} alla volta`,
    /** A row tapped under "Seleziona tutti" while not every match is loaded: one cannot be left out of what is not on screen. */
    allButOne: "Per sceglierli uno per uno, prima tocca «Deseleziona».",
    actions: {
      sale: "Saldo",
      hide: "Nascondi",
      show: "Mostra",
      tag: "Tag",
      category: "Categoria",
      pin: "Homepage",
      order: "Ordina",
    },
  },

  /** What an action acts on, under a sheet's title. */
  target: {
    products,
    /** "Tutti i 120 prodotti di «Nike»": what "Seleziona tutti" took, the list's name when it has one. */
    all: (count: number, list: string | null) => {
      const what = count === 1 ? "1 prodotto" : `Tutti i ${n(count)} prodotti`;
      return list ? `${what} di «${list}»` : `${what} della lista`;
    },
    /** The same, with the list narrowed by a search or a chip: what it found, not the whole term. */
    found: (count: number, list: string | null) => {
      const what = count === 1 ? "L'unico prodotto trovato" : `I ${n(count)} prodotti trovati`;
      return list ? `${what} in «${list}»` : `${what} nella lista`;
    },
  },

  sheet: {
    close: "Chiudi",
    clear: "Cancella",
    retry: "Riprova",
    change: "Cambia",
    network: "Non riesco a raggiungere il server: riprova tra poco.",
    starting: "Avvio…",
  },

  preview: {
    loading: "Guardo cosa cambia…",
    changes: (count: number) =>
      count === 0 ? "Non cambia niente" : count === 1 ? "Cambia 1 prodotto" : `Cambiano ${n(count)} prodotti`,
    more: (count: number) => `e ${count === 1 ? "un altro" : `altri ${n(count)}`}`,
    untouched: "Restano come sono",
    /** A list's before and after (tags, categories), one per line. */
    before: "Prima",
    after: "Dopo",
    sampled: (count: number) =>
      `Ho letto i prezzi dal negozio per ${count === 1 ? "il primo" : `i primi ${n(count)}`}: per gli altri è una stima, l'azione li ricontrolla uno per uno.`,
    failed: "Non riesco a vedere cosa cambierebbe.",
  },

  sale: {
    title: "Saldo",
    modes: { sale: "Metti in saldo", unsale: "Togli il saldo" },
    percentLabel: "Sconto sul prezzo pieno",
    percent: (percent: number) => `−${percent}%`,
    presets: "Sconti veloci",
    rounding: "Arrotondamento",
    roundings: { charm: "Arrotonda a ,99", exact: "Esatto" },
    roundingHint: {
      charm: "Da 10 € in su scende al ,99: 129 € −20% fa 102,99 €. Lo sconto non è mai meno di quello annunciato.",
      exact: "Al centesimo, sempre per difetto.",
    },
    end: "Fine del saldo",
    // Short, so the four fit side by side on the narrowest phone; the line under them says the day.
    ends: { none: "Nessuna", sunday: "Domenica", week: "7 giorni", pick: "Scegli…" },
    endsNever: "Nessuna data: resta finché non lo togli tu.",
    endsOn: (day: string) => `Finisce ${day}, a fine giornata.`,
    endsToday: "Finisce stasera, a fine giornata.",
    pickLabel: "Ultimo giorno",
    pickFirst: "Scegli il giorno qui sopra.",
    pickPast: "Scegli un giorno da oggi in poi.",
    regularNote: "Il prezzo pieno non cambia: lo decide sempre l'Hub.",
    unsaleHint: "Torna il prezzo pieno e la data di fine si cancella. «Annulla» rimette il saldo com'era.",
    start: (count: number) => `Metti in saldo ${products(count)}`,
    startPlain: "Metti in saldo",
    /** "Cambia lo sconto" moving only the running sale's last day: the button says that, not a new sale. */
    endChange: {
      endAdded: "Metti la data di fine",
      endMoved: "Sposta la fine del saldo",
      endRemoved: "Togli la data di fine",
    },
    stop: (count: number) => `Togli il saldo a ${products(count)}`,
    stopPlain: "Togli il saldo",
  },

  visibility: {
    title: { hide: "Nascondi", show: "Mostra" },
    hint: {
      hide: (count: number): string =>
        count === 1
          ? "Sparisce dal negozio, dalle categorie e dalla ricerca; il suo link continua a funzionare. «Annulla» lo rimette com'era."
          : "Spariscono dal negozio, dalle categorie e dalla ricerca; il loro link continua a funzionare. «Annulla» li rimette com'erano.",
      show: (count: number): string =>
        count === 1
          ? "Torna visibile nel negozio, nelle categorie e nella ricerca."
          : "Tornano visibili nel negozio, nelle categorie e nella ricerca.",
    },
    start: {
      hide: (count: number) => `Nascondi ${products(count)}`,
      show: (count: number) => `Mostra ${products(count)}`,
    },
    plain: { hide: "Nascondi", show: "Mostra" },
  },

  tag: {
    title: "Tag",
    modes: { add: "Aggiungi", remove: "Togli" },
    search: { add: "Cerca o scrivi un tag", remove: "Cerca un tag" },
    create: (name: string) => `Crea il tag «${name}»`,
    createHint: "Non c'è ancora: lo creo sul negozio.",
    readBy: (list: readonly string[]) => `${list.length === 1 ? "Lo legge" : "Lo leggono"}: ${list.join(", ")}`,
    readByNote: (list: readonly string[]) =>
      list.length === 1
        ? `La categoria automatica ${names(list)} legge questo tag: i prodotti possono entrare o uscire da lì.`
        : `Le categorie automatiche ${names(list)} leggono questo tag: i prodotti possono entrare o uscire da lì.`,
    none: "Nessun tag con questo nome.",
    more: (count: number) => (count === 1 ? "Ancora 1 tag: scrivi per trovarlo." : `Altri ${n(count)} tag: scrivi per trovarli.`),
    empty: "Il negozio non ha ancora tag.",
    loading: "Carico i tag del negozio…",
    failed: "Non riesco a leggere i tag del negozio.",
    start: {
      add: (tag: string, count: number) => `Aggiungi «${tag}» a ${products(count)}`,
      remove: (tag: string, count: number) => `Togli «${tag}» da ${products(count)}`,
    },
    plain: { add: "Aggiungi il tag", remove: "Togli il tag" },
  },

  category: {
    title: "Categoria",
    modes: { add: "Aggiungi a", remove: "Togli da" },
    search: "Cerca una categoria",
    automatic: "Decisa dalla sua regola",
    /** The product (one, from its sheet) is in it already. */
    here: "Già qui",
    none: "Nessuna categoria con questo nome.",
    more: (count: number) =>
      count === 1 ? "Ancora 1 categoria: scrivi per trovarla." : `Altre ${n(count)} categorie: scrivi per trovarle.`,
    empty: "Il negozio non ha categorie.",
    loading: "Carico le categorie…",
    failed: "Non riesco a leggere le categorie.",
    start: {
      add: (category: string, count: number) => `Aggiungi ${products(count)} a «${category}»`,
      remove: (category: string, count: number) => `Togli ${products(count)} da «${category}»`,
    },
    plain: { add: "Aggiungi alla categoria", remove: "Togli dalla categoria" },
  },

  pin: {
    title: "Metti in homepage",
    intro: "Scegli la sezione: i prodotti vanno in cima, fissati, nell'ordine della lista.",
    fill: {
      category: (name: string) => `Categoria «${name}»: chi non c'è viene aggiunto.`,
      automatic: (name: string) => `Automatica «${name}»: solo i prodotti della sua regola.`,
      brand: (name: string) => `Brand «${name}»: solo i suoi prodotti.`,
      other: "Solo i prodotti che mostra già.",
    },
    pinned: (count: number) => (count === 0 ? "Nessuno fissato" : count === 1 ? "1 fissato" : `${n(count)} fissati`),
    notPinnable: "Qui non si fissano prodotti dalla Vetrina.",
    /** The section the editor behind the sheet is changing: pinned from there, or its unsaved order would fight this one. */
    editing: "La stai modificando: fissalo dall'editor della sezione.",
    /** None of the chosen products can be in this section (another brand's, say). */
    takesNone: (count: number): string => (count === 1 ? "Questo prodotto non può stare qui." : "Nessuno di questi prodotti può stare qui."),
    empty: "La homepage non ha sezioni di prodotti.",
    loading: "Carico le sezioni della homepage…",
    failed: "Non riesco a leggere la homepage.",
    start: (section: string, count: number) =>
      count === 1 ? `Fissa in cima a ${section}` : `Fissa ${n(count)} in cima a ${section}`,
    plain: "Fissa in cima",
  },

  /** "Ordina": the chosen products placed in the category's or brand's order — the one its page on the shop follows. */
  order: {
    title: (term: string) => `Ordina in «${term}»`,
    intro: "Decidi dove vanno nella pagina del negozio, nell'ordine della lista.",
    modes: { top: "In cima", position: "Posizione", bottom: "In fondo" },
    positionLabel: "Posizione",
    positionHint: (total: number) => `Da 1 a ${n(total)}`,
    start: (count: number) => (count === 1 ? "Sposta 1 prodotto" : `Sposta ${n(count)} prodotti`),
    plain: "Sposta",
  },

  /** "Riordina": a category's or brand's first products, dragged into the order its page shows. */
  reorder: {
    title: "Riordina",
    subtitle: (term: string, shown: number, total: number) =>
      shown < total ? `${term} · i primi ${n(shown)} di ${n(total)}` : term,
    intro: "Trascina dalla maniglia: è l'ordine della pagina della categoria nel negozio. Gli altri prodotti seguono, come sono.",
    loading: "Carico i prodotti…",
    failed: "Non riesco a leggere i prodotti.",
    empty: "Nessun prodotto da ordinare.",
    dragHandle: "Trascina per spostare",
    toTop: "Porta in cima",
    soldOut: "Esaurito",
    hidden: "Nascosto",
    reset: "Ripristina",
    moved: (count: number) => (count === 1 ? "1 prodotto spostato" : `${n(count)} prodotti spostati`),
    save: "Salva l'ordine",
    nothing: "Trascina un prodotto per cambiare l'ordine.",
    back: "Torna all'ordine",
  },

  activity: {
    title: "Attività",
    open: "Attività",
    intro: "Le ultime azioni sui prodotti. «Annulla» rimette i valori di prima, dove nessuno li ha cambiati dopo.",
    empty: "Ancora nessuna azione.",
    loading: "Carico le attività…",
    failed: "Non riesco a leggere le attività.",
    undo: "Annulla",
    status: {
      running: (done: number, total: number) => `In corso · ${n(done)}/${n(total)}`,
      queued: "In attesa",
      done: "Fatta",
      failed: "Non riuscita",
      undoing: "La sto annullando",
      undone: "Annullata",
    },
    refused: (count: number) => agreed(count, "prodotto rifiutato dal negozio", "prodotti rifiutati dal negozio"),
    /** A margin's reprice counts sizes, not products. */
    refusedSizes: (count: number) => agreed(count, "taglia rifiutata dal negozio", "taglie rifiutate dal negozio"),
  },

  /** The pill above the tab bar while an action runs. */
  pill: {
    kinds: {
      hide: "Nascondo",
      show: "Rimetto in vista",
      sale: "Metto in saldo",
      unsale: "Tolgo il saldo",
      tag: "Aggiungo il tag",
      untag: "Tolgo il tag",
      categorize: "Aggiungo alla categoria",
      uncategorize: "Tolgo dalla categoria",
      pin: "Fisso in homepage",
      margin: "Cambio il ricarico",
      order: "Riordino",
      sourceOrder: "Applico l'ordine",
    },
    undoing: "Annullo…",
    progress: (what: string, done: number, total: number) => `${what} · ${n(done)}/${n(total)}`,
    queued: (what: string) => `${what} · in attesa`,
    more: (count: number) => `+${count}`,
    label: "Azioni in corso: tocca per vederle",
  },

  toast: {
    undo: "Annulla",
    refused: (count: number) => `${agreed(count, "prodotto rifiutato dal negozio", "prodotti rifiutati dal negozio")}.`,
    refusedSizes: (count: number) => `${agreed(count, "taglia rifiutata dal negozio", "taglie rifiutate dal negozio")}.`,
    undone: (label: string) => `Annullata: ${label}`,
    restored: (count: number) => `${products(count)} come prima`,
    kept: (count: number) =>
      count === 1 ? "1 prodotto lasciato com'era: cambiato nel frattempo" : `${n(count)} prodotti lasciati com'erano: cambiati nel frattempo`,
    undoRefused: (count: number) => agreed(count, "prodotto rifiutato dal negozio", "prodotti rifiutati dal negozio"),
    undoRefusedSizes: (count: number) => agreed(count, "taglia rifiutata dal negozio", "taglie rifiutate dal negozio"),
    /** An undone hide left these hidden: another category or brand the owner hid still holds them (named, when known). */
    held: (count: number, terms: readonly string[] = []) => {
      const where = terms.length > 0 ? inTerms(terms) : "in una categoria o un brand";
      return count === 1
        ? `1 resta nascosto: è anche ${where} che hai nascosto`
        : `${n(count)} restano nascosti: sono anche ${where} che hai nascosto`;
    },
    undoFailed: "Annullamento non riuscito.",
    failed: "Non è andata a buon fine.",
  },
};
