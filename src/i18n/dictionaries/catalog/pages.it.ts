/**
 * The Vetrina's "Pagine" tab: a WordPress page's block markup copied out, a
 * new version pasted in, checked, compared and saved
 * (src/components/vetrina/pages, docs/pages.md).
 */

import type { PageProblem, RailRule, ValueKind } from "@/lib/pages/types";
import type { VetrinaErrorCode } from "@/lib/vetrina/types";

const n = (count: number) => count.toLocaleString("it-IT");
const plural = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${n(count)} ${many}`);
/** A block's name as the owner reads it: WordPress's own without "core/". */
export const blockName = (name: string) => name.replace(/^core\//, "");
const list = (items: readonly string[]) => items.join(", ");

const TYPE: Record<string, string> = {
  string: "un testo",
  number: "un numero",
  integer: "un numero intero",
  boolean: "true o false",
  array: "una lista",
  object: "un oggetto",
  null: "null",
};
const GOT: Record<ValueKind, string> = { text: "un testo", number: "un numero", boolean: "true/false", list: "una lista", object: "un oggetto", null: "null" };

const RAIL: Record<RailRule, (attr: string, value: string) => string> = {
  type: (_a, v) => `type="${v}" non è recent, featured, best_selling, sale o top_rated: mostrerebbe i più recenti.`,
  fallback: (_a, v) => `fallback="${v}" non è menu_order, date, popularity, price, price-desc o rating.`,
  fit: (_a, v) => `fit="${v}" non è cover o contain.`,
  ratio: (_a, v) => `ratio="${v}" non è square, portrait, tall, landscape, wide o N/N: la foto tornerebbe quadrata.`,
  limit: (_a, v) => `limit="${v}" non è un numero intero da 1 in su.`,
  columns: (a, v) => `${a}="${v}" dev'essere un numero intero da 1 a 8.`,
  ids: (a, v) => `${a}="${v}" devono essere ID di prodotti separati da virgole.`,
  slugs: (a, v) => `${a}="${v}" devono essere slug (minuscole e trattini), non nomi.`,
};

/** What a problem means, in a sentence. */
function problem(p: PageProblem): string {
  switch (p.kind) {
    case "empty":
      return "La pagina è vuota: incolla il codice dei blocchi.";
    case "tooLarge":
      return `Il codice è troppo lungo (${(p.bytes / 1e6).toFixed(1)} MB; al massimo ${(p.max / 1e6).toFixed(1)} MB).`;
    case "badJson":
      return "Gli attributi di questo blocco non sono JSON valido: WordPress li scarterebbe tutti, senza dirlo. Di solito è una \" dentro un testo: va scritta \\u0022.";
    case "freeform":
      return "HTML fuori da un blocco: WordPress lo trasforma in un blocco Classico. Mettilo dentro un blocco <!-- wp:html -->.";
    case "strayCloser":
      return `Chiusura <!-- /wp:${blockName(p.name)} --> senza un blocco aperto: WordPress trasforma tutto quello che segue in un unico blocco Classico.`;
    case "wrongCloser":
      return `Questa chiusura nomina «${blockName(p.name)}», ma il blocco aperto è «${blockName(p.open)}»: WordPress chiude «${blockName(p.open)}» lo stesso.`;
    case "unclosed":
      return "Blocco aperto e mai chiuso: WordPress lo chiude in fondo alla pagina, e ci finisce dentro tutto quello che segue.";
    case "registryUnavailable":
      return `Non ho potuto leggere i blocchi ${p.namespace} registrati sul sito, quindi non posso controllarli. Riprova tra poco; se succede ancora, il plugin potrebbe essere disattivato.`;
    case "unknownBlock":
      return "Il sito non ha questo blocco: non verrebbe mostrato.";
    case "unknownAttr":
      return `Il blocco non ha l'attributo «${p.attr}»: lo ignorerebbe. Quelli che ha: ${list(p.known)}.`;
    case "wrongType":
      return `«${p.attr}» dev'essere ${p.expected.map((t) => TYPE[t] ?? t).join(" o ")}, non ${GOT[p.got]}: WordPress userebbe il valore predefinito.`;
    case "notAllowed":
      return `«${p.attr}» può essere solo: ${list(p.allowed)}.`;
    case "innerHtml":
      return "Questo blocco lo disegna il server: l'HTML scritto dentro viene ignorato. Scrivilo come un solo commento che si chiude con /-->.";
    case "railAttr":
      return `[${p.shortcode}] non ha l'attributo «${p.attr}»: verrebbe ignorato. Quelli che ha: ${list(p.known)}.`;
    case "railValue":
      return `[gh_product_rail] ${RAIL[p.rule](p.attr, p.value)}`;
    case "railOutsideWrapper":
      return "[gh_product_rail] fuori da un blocco Shortcode Wrapper: si vede sul sito, ma la Vetrina non la vede e non la può modificare.";
    case "motion":
      return `${p.attr}="${p.value}" non è un valore che le animazioni conoscono.`;
  }
}

export const pagesIt = {
  title: "Pagine",
  intro: "Le pagine pubblicate del sito. Aprine una per copiarne il codice dei blocchi, incollarne una nuova versione, controllarla e salvarla.",
  empty: "Il sito non ha pagine pubblicate.",
  /** The page the Vetrina's homepage editor works on. */
  vetrinaBadge: "Homepage · la modifica anche la Vetrina",
  back: "Pagine",
  /** What went wrong reading a page or talking to WordPress, by the Vetrina's codes; the rest in the Vetrina's own words. */
  errors: {
    not_configured:
      "Le pagine del sito non sono collegate: serve l'accesso a WordPress (WP_APP_USER e WP_APP_PASSWORD). Chiedi a chi gestisce il server.",
    unauthorized: "WordPress ha rifiutato l'accesso: la password applicazione non è valida, o il suo utente non può modificare le pagine.",
    not_found: "Questa pagina non c'è più sul sito.",
    invalid: "La richiesta non è valida: ricarica la pagina e riprova.",
    failed: "WordPress non risponde. Riprova tra poco.",
  } as Partial<Record<VetrinaErrorCode, string>>,

  /** One page's screen. */
  page: {
    modified: (when: string) => `Modificata il ${when}`,
    open: "Apri sul sito",
    current: "Il codice di adesso",
    currentHint: (lines: number, chars: number) => `${plural(lines, "riga", "righe")} · ${plural(chars, "carattere", "caratteri")}`,
    copy: "Copia",
    copied: "Codice copiato",
    copyFailed: "Non riesco a copiare: seleziona il testo e copialo a mano.",
    next: "La nuova versione",
    nextHint: "Incolla qui tutta la pagina: sostituisce quella di adesso.",
    placeholder: "<!-- wp:… -->",
    check: "Controlla",
    save: "Aggiorna",
    checking: "Controllo…",
    vetrina:
      "Questa è la homepage: la modifica anche la Vetrina (prodotti fissati, sezioni, titoli). Parti sempre da una copia appena fatta, o perderai le sue ultime modifiche.",
    noAccess: (user: string, caps: readonly string[]) =>
      `L'utente WordPress «${user}» non può salvare le pagine: gli manca ${list(caps)}. Dagli il ruolo Editor (o queste capacità), poi ricarica.`,
    filtered: (user: string) =>
      `L'utente WordPress «${user}» non ha unfiltered_html: salvando, WordPress toglie script, iframe e altro HTML che non considera sicuro.`,
    accessUnknown: "Non ho potuto chiedere a WordPress cosa può fare il suo utente: se non può salvare le pagine, te lo dirà al salvataggio.",
  },

  /** What "Controlla" says. */
  check: {
    title: "Controllo",
    ok: "Nessun errore: si può salvare.",
    errors: (count: number) => plural(count, "errore", "errori"),
    warnings: (count: number) => plural(count, "avviso", "avvisi"),
    blocked: "Ci sono errori: correggili, poi riprova.",
    warningsOnly: "Gli avvisi non bloccano il salvataggio, ma vale la pena leggerli.",
    error: "Errore",
    warning: "Avviso",
    where: (line: number | null, path: readonly number[], name: string) =>
      [line != null ? `Riga ${n(line)}` : null, path.length > 0 ? `blocco ${path.join(" › ")}` : null, blockName(name)].filter(Boolean).join(" · "),
    page: "La pagina",
    problem,
    stale: "La pagina è cambiata da quando l'hai aperta (dalla Vetrina, da WordPress o da un'altra scheda). Ricaricala, poi riprova: quello che hai incollato resta.",
    reload: "Ricarica la pagina",
  },

  /** What saving would change. */
  diff: {
    title: "Cosa cambia",
    identical: "È identica alla pagina di adesso: niente da salvare.",
    none: "Nessun blocco cambia: cambiano solo spazi o a capo tra i blocchi.",
    unchanged: (count: number) => (count === 1 ? "1 blocco resta uguale" : `${n(count)} blocchi restano uguali`),
    added: "Aggiunto",
    removed: "Tolto",
    changed: "Cambiato",
    at: (path: readonly number[]) => `posizione ${path.join(" › ")}`,
    was: (path: readonly number[]) => `era in posizione ${path.join(" › ")}`,
    attrs: (keys: readonly string[]) => `attributi: ${list(keys)}`,
    content: "contenuto",
    more: (count: number) => `…e altri ${n(count)}`,
  },

  /** The confirmation before the write. */
  confirm: {
    title: "Salvare la pagina?",
    subtitle: (title: string) => `«${title}» su WordPress`,
    front:
      "Questa è la homepage. Incollando tutta la pagina sostituisci le ultime modifiche della Vetrina (prodotti fissati, sezioni, titoli), a meno che il codice non parta da una copia appena fatta.",
    revisions: "WordPress tiene la versione di adesso nelle revisioni della pagina.",
    yes: "Salva su WordPress",
    saving: "Salvo…",
  },

  /** After the write. */
  saved: {
    toast: "Pagina salvata",
    title: "Pagina salvata",
    body: "La versione di prima è nelle revisioni della pagina, su WordPress.",
    revisions: (count: number) => `La pagina ha ${plural(count, "revisione", "revisioni")}.`,
    openRevisions: "Vedi le revisioni",
    open: "Apri la pagina",
    altered:
      "WordPress ha salvato il codice con qualche differenza da quello incollato (di solito toglie l'HTML che non considera sicuro). Il codice di adesso, qui sopra, è quello salvato.",
    unchanged: "La pagina contiene già esattamente questo codice: niente da salvare.",
    stale: "Non ho salvato: la pagina è cambiata da quando l'hai aperta. Ricaricala, poi riprova.",
    noAccess: "Non ho salvato: l'utente WordPress non può modificare le pagine.",
    failed: "Il salvataggio non è riuscito, o WordPress non ha risposto in tempo. Ricarica la pagina per vedere se è stato salvato prima di riprovare.",
  },
};
