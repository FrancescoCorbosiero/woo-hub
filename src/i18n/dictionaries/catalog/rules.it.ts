/**
 * The Vetrina catalog's strings for a new automatic category, made from the
 * catalog's "+" or from a list's filters ("Salva come categoria automatica").
 * The rule's own fields speak with the Hub's editor words
 * (t.collections.editor). Italian is the source of truth (see ./it.ts).
 */
const n = (count: number) => count.toLocaleString("it-IT");

export const rulesIt = {
  title: "Nuova categoria automatica",
  /** Under the title, when it starts from a list's filters. */
  fromList: (name: string) => `Dai filtri di «${name}»`,
  intro: "Una categoria vera del negozio, che si riempie da sola: l'Hub mette e toglie i prodotti secondo la regola.",
  name: "Nome",
  namePlaceholder: "Es. Nike in saldo",
  parent: "Dentro a",
  topLevel: "Nessuna (principale)",
  rule: "La regola",

  /** What a list's filters could not carry into the rule. */
  notes: {
    hidden: "Il filtro «Nascosti» resta fuori: una regola non guarda se un prodotto è nascosto.",
    search: "La ricerca diventa «il nome contiene»: lo SKU non conta.",
    source: "Il filtro «Provenienza» resta fuori: una regola guarda solo quello che il negozio sa di un prodotto.",
  },

  nameTaken: (name: string) =>
    `C'è già «${name}» in questo punto: scegli un altro nome. Per rendere automatica quella, aprila dal catalogo.`,
  nameFirst: "Scrivi il nome della categoria",
  save: "Crea e applica",
  saving: "Creo la categoria…",
  applying: (name: string) => `Metto i prodotti in «${name}»…`,
  created: (name: string, moved: number) =>
    moved === 0
      ? `«${name}» è pronta: per ora nessun prodotto.`
      : moved === 1
        ? `«${name}» è pronta: 1 prodotto dentro.`
        : `«${name}» è pronta: ${n(moved)} prodotti dentro.`,
  slow: (name: string) => `«${name}» è salvata: i prodotti arrivano tra poco.`,
  open: "Apri",
  loading: "Carico le categorie e i tag del negozio…",
  loadFailed: "Non riesco a leggere le categorie del negozio.",
  network: "Non riesco a raggiungere il server: riprova tra poco.",
  retry: "Riprova",

  /**
   * A rule's save (here, in the section's sheet, a product's tags) that did
   * not go through, by what went wrong: never the server's own text, which
   * its log keeps.
   */
  errors: {
    failed: "Non riuscito, per un problema del server: riprova tra poco.",
    notConfigured: "Il collegamento al negozio non è configurato: chiedi a chi gestisce il server.",
    store: "Il negozio non ha accettato la modifica: controlla i permessi della sua chiave.",
    invalid: "La regola non si può salvare così: controllala e riprova.",
    notFound: "Questa categoria automatica non c'è più.",
    /** Saved, but its first run stopped: the scheduled check runs it again. */
    /** After «Anteprima non disponibile:», in place of the server's text. */
    check: "riprova tra poco.",
    moved: "Regola salvata, ma i prodotti non si sono spostati: l'Hub riprova al prossimo controllo.",
  },
};
