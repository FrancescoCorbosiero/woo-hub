/**
 * The Vetrina's "Menu" tab: the site's navigation menus (WordPress's
 * Aspetto › Menu), each item's place, and adding, moving, renaming and
 * taking items away — each with "Annulla" (src/components/vetrina/menus).
 */

import type { VetrinaErrorCode } from "@/lib/vetrina/types";

const n = (count: number) => count.toLocaleString("it-IT");
const items = (count: number) => (count === 1 ? "1 voce" : `${n(count)} voci`);

export const menusIt = {
  title: "Menu",
  intro: "I menu del tuo sito, come li mostra il tema: tocca un menu per sistemarne le voci.",
  shownIn: (places: string) => `Sul sito in: ${places}`,
  shownNowhere: "Il tema non lo mostra da nessuna parte",
  items,
  empty: "Il sito non ha menu: crealo da WordPress (Aspetto › Menu), poi torna qui.",
  /** What went wrong reading or writing a menu, by the Vetrina's codes; the rest in the Vetrina's own words. */
  errors: {
    not_configured:
      "I menu del sito non sono collegati: servono l'accesso a WordPress (WP_APP_USER e WP_APP_PASSWORD) e WordPress 5.9 o successivo. Chiedi a chi gestisce il server.",
    unauthorized: "WordPress ha rifiutato l'accesso: la password applicazione non è valida, o il suo utente non è un amministratore.",
    not_found: "Questo menu non c'è più sul sito.",
    failed: "WordPress non risponde. Riprova tra poco.",
  } as Partial<Record<VetrinaErrorCode, string>>,
  back: "Menu",

  /** One menu's screen. */
  menu: {
    add: "Aggiungi voci",
    emptyMenu: "Il menu è vuoto: aggiungi la prima voce.",
    kinds: { category: "Categoria", brand: "Brand", page: "Pagina", link: "Link", other: "Da WordPress" },
    renamed: "nome cambiato",
    invalid: "Non c'è più: il sito non la mostra",
    actionsFor: (title: string) => `Azioni per «${title}»`,
  },

  /** An item's "⋯". */
  actions: {
    moveUp: "Sposta su",
    moveDown: "Sposta giù",
    indent: (above: string) => `Metti sotto «${above}»`,
    outdent: (parent: string) => `Porta fuori da «${parent}»`,
    addBelow: "Aggiungi voci qui sotto",
    rename: "Rinomina",
    open: "Apri sul sito",
    remove: "Togli dal menu",
    cancel: "Chiudi",
  },

  remove: {
    title: "Togli dal menu",
    confirm: (title: string, children: number) =>
      children === 0 ? `«${title}» esce dal menu. Ciò a cui porta resta nel negozio.` : `«${title}» esce dal menu; le sue ${items(children)} salgono al suo posto.`,
    yes: "Togli",
    no: "Lascia",
  },

  /** What the toasts say. */
  done: {
    added: (names: readonly string[]) => (names.length === 1 ? `«${names[0]}» aggiunta al menu` : `${items(names.length)} aggiunte al menu`),
    moved: (title: string) => `«${title}» spostata`,
    removed: (title: string) => `«${title}» tolta dal menu`,
    renamed: (title: string) => `Ora si chiama «${title}»`,
    ownName: "Torna al suo nome",
    undone: "Menu com'era prima",
  },
  undo: "Annulla",

  /** "Aggiungi voci". */
  add: {
    title: "Aggiungi voci",
    whereEnd: "In fondo al menu",
    whereUnder: (parent: string) => `Sotto «${parent}», in fondo`,
    tabs: { category: "Categorie", brand: "Brand", page: "Pagine", link: "Link" },
    tabsLabel: "Cosa aggiungere",
    search: { category: "Cerca una categoria", brand: "Cerca un brand", page: "Cerca una pagina" },
    inMenu: "già nel menu",
    empty: "Niente da mostrare.",
    loading: "Carico…",
    failed: "Non riesco a leggere l'elenco.",
    link: {
      url: "Indirizzo",
      urlHint: "https://…, un percorso del negozio (/saldi/) o # per una voce che apre solo le sue voci",
      label: "Nome nel menu",
      badUrl: "Scrivi un indirizzo che inizi con https://, / oppure #.",
      needLabel: "Scrivi il nome che il menu mostrerà.",
    },
    button: (count: number) => (count === 0 ? "Scegli cosa aggiungere" : `Aggiungi ${items(count)}`),
  },

  /** "Rinomina". */
  rename: {
    title: (title: string) => `Rinomina «${title}»`,
    label: "Nome nel menu",
    own: (name: string) => `Usa il suo nome: «${name}»`,
    save: "Salva",
    needLabel: "Scrivi il nome che il menu mostrerà.",
  },
};
