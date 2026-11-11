/**
 * The Vetrina's "Negozio" tab (src/components/vetrina/shop): the store kept
 * in step with the supplier's list — now, with one button, and on its own,
 * every so many minutes — and what waits for the owner: orders to fulfil,
 * prices changed on WordPress, new products to publish.
 */

const n = (count: number) => count.toLocaleString("it-IT");

export const shopIt = {
  title: "Negozio",
  intro: "Il negozio si aggiorna da solo dal listino del fornitore. Qui lo aggiorni subito, e trovi quello che aspetta te.",
  notConnected:
    "Il negozio non è collegato: servono le chiavi di WooCommerce (WOO_BASE_URL, WOO_CONSUMER_KEY e WOO_CONSUMER_SECRET). Chiedi a chi gestisce il server.",
  back: "Negozio",

  /** When something happened, in the shop's time zone. */
  when: {
    today: (time: string) => `oggi alle ${time}`,
    yesterday: (time: string) => `ieri alle ${time}`,
    tomorrow: (time: string) => `domani alle ${time}`,
    onDay: (day: string, time: string) => `${day} alle ${time}`,
  },

  sync: {
    now: "Sincronizza ora",
    /** The step a run is on, as the button says it while it goes. */
    step: {
      pull: "Leggo il negozio…",
      gs: "Scarico il listino del fornitore…",
      publish: "Pubblico i nuovi prodotti…",
      feedSync: "Aggiorno prezzi e disponibilità…",
      kicksdb: "Aggiorno i prezzi KicksDB…",
      storeSync: "Scrivo i prezzi KicksDB…",
      collections: "Aggiorno le categorie automatiche…",
      repair: "Sistemo i prodotti…",
      backfill: "Completo le schede…",
      recategorize: "Riordino le categorie…",
    } as Record<string, string>,
    working: "Sincronizzazione in corso…",
    stepOf: (step: number, of: number) => `Passo ${step} di ${of}`,
    scheduled: "È partito l'aggiornamento programmato: lo segui da qui.",
    last: (when: string) => `Ultimo aggiornamento ${when}`,
    lastFailed: (when: string) => `Ultimo aggiornamento ${when}: non è riuscito del tutto`,
    never: "Non ancora aggiornato",
    next: (when: string) => `Prossimo ${when}`,
    autoOff: "L'aggiornamento automatico è spento: il negozio cambia solo quando premi qui.",
    devOff: "Su questo server gli aggiornamenti programmati sono spenti (sviluppo).",
    nothing: "Non c'è niente da sincronizzare: nessun listino fornitore collegato, e i prezzi KicksDB non sono inclusi.",
    notWriter: "Questo server non scrive sul negozio: la sincronizzazione parte solo da quello principale.",
    running: "Una sincronizzazione è già in corso: la segui qui.",
    failed: "Non è partita:",

    /** The last run by hand: what it did, in plain words. */
    result: {
      title: (when: string) => `Sincronizzato ${when}`,
      titleFailed: (when: string) => `Sincronizzato ${when}, con qualche problema`,
      feed: (products: number, added: number, removed: number) =>
        `Listino: ${n(products)} prodotti` +
        (added > 0 ? `, ${added === 1 ? "1 nuovo" : `${n(added)} nuovi`}` : "") +
        (removed > 0 ? `, ${removed === 1 ? "1 non più disponibile" : `${n(removed)} non più disponibili`}` : ""),
      written: (count: number) =>
        count === 0
          ? "Prezzi e disponibilità erano già in pari"
          : count === 1
            ? "1 prezzo o disponibilità aggiornato"
            : `${n(count)} prezzi e disponibilità aggiornati`,
      writtenKicks: (count: number) =>
        count === 0 ? "I prezzi KicksDB erano già in pari" : count === 1 ? "1 prezzo KicksDB aggiornato" : `${n(count)} prezzi KicksDB aggiornati`,
      added: (count: number) => (count === 1 ? "1 taglia aggiunta" : `${n(count)} taglie aggiunte`),
      published: (count: number) =>
        count === 1 ? "1 nuovo prodotto pubblicato: compare con la prima foto" : `${n(count)} nuovi prodotti pubblicati: compaiono con la prima foto`,
      publishFailed: (count: number) => (count === 1 ? "1 nuovo prodotto non pubblicato" : `${n(count)} nuovi prodotti non pubblicati`),
      publishWaiting: (count: number) => `Altri ${n(count)} nuovi prodotti alla prossima sincronizzazione`,
      kept: (count: number) =>
        count === 1
          ? "1 prezzo cambiato su WordPress lasciato com'è: decidi tu"
          : `${n(count)} prezzi cambiati su WordPress lasciati come sono: decidi tu`,
      deferred: (count: number) => `Altri ${n(count)} alla prossima sincronizzazione`,
      held: (count: number) =>
        count === 1 ? "1 taglia da aggiungere dalla scheda Sync del Hub" : `${n(count)} taglie da aggiungere dalla scheda Sync del Hub`,
      failed: (count: number) => (count === 1 ? "1 modifica non riuscita" : `${n(count)} modifiche non riuscite`),
      capped: (planned: number, limit: number) =>
        `Troppe modifiche in una volta (${n(planned)}; il limite è ${n(limit)}): non ho scritto nulla. Di solito è un listino rotto — controllale nella scheda Sync del Hub.`,
      pullRunning: "Il Hub stava leggendo il negozio: niente scritto. Riprova tra qualche minuto.",
      /** A step that failed: which, then the technical reason, folded. */
      stepFailed: (step: string) => `${step}: non riuscito`,
      stepName: {
        gs: "Listino del fornitore",
        publish: "Nuovi prodotti",
        feedSync: "Prezzi e disponibilità",
        kicksdb: "Prezzi KicksDB",
        storeSync: "Prezzi KicksDB nel negozio",
      } as Record<string, string>,
      details: "Dettagli",
    },
  },

  todo: {
    title: "Da fare",
    orders: "Ordini da evadere",
    storeEdits: "Prezzi cambiati su WordPress",
    toPublish: "Nuovi prodotti da pubblicare",
    none: "Nessuno",
  },

  /** "Prezzi cambiati su WordPress": the sizes whose price someone changed on the store, for the owner to decide. */
  prices: {
    title: "Prezzi cambiati",
    intro:
      "Qualcuno ha cambiato questi prezzi su WordPress dopo l'ultimo aggiornamento. Il Hub li ha lasciati come sono: scegli tu quale prezzo tenere.",
    empty: "Niente da decidere: nessun prezzo è stato cambiato su WordPress.",
    more: (shown: number, total: number) => `Ne vedi ${n(shown)} di ${n(total)}: le scelte per tutti valgono anche per gli altri.`,
    size: (size: string) => `Taglia ${size}`,
    row: (store: string, hub: string) => `Su WordPress ${store} · del Hub ${hub}`,
    keep: (price: string) => `Tieni ${price} (WordPress)`,
    reprice: (price: string) => `Rimetti ${price} (Hub)`,
    keepAll: "Tieni tutti quelli di WordPress",
    repriceAll: "Rimetti tutti i prezzi del Hub",
    keepAllConfirm: (count: number) =>
      count === 1
        ? "Il prezzo di WordPress resta, e il Hub lo blocca su quella taglia: da ora lo scrive lui."
        : `I ${n(count)} prezzi di WordPress restano, e il Hub li blocca sulle loro taglie: da ora li scrive lui.`,
    repriceAllConfirm: (count: number) =>
      count === 1 ? "Il prezzo del Hub viene scritto ora sul negozio." : `I ${n(count)} prezzi del Hub vengono scritti ora sul negozio.`,
    confirm: "Conferma",
    notLockable: "Questa taglia non si può bloccare: puoi solo rimettere il prezzo del Hub.",
    kept: (count: number) => (count === 1 ? "Prezzo di WordPress tenuto" : `${n(count)} prezzi di WordPress tenuti`),
    repriced: (count: number) => (count === 1 ? "Prezzo del Hub rimesso" : `${n(count)} prezzi del Hub rimessi`),
    failed: "Non riuscito:",
  },

  /** "Nuovi prodotti": catalog products the store does not have yet, published from the phone. */
  publish: {
    title: "Nuovi prodotti",
    intro:
      "Prodotti del listino e del catalogo che il negozio non ha ancora. Pubblicandoli vengono creati nascosti, e compaiono sul sito appena arriva la loro prima foto.",
    empty: "Niente da pubblicare: il negozio ha già tutti i prodotti del catalogo.",
    noSnapshot: "Il Hub non ha ancora letto il negozio: aspetta il primo aggiornamento completo, poi torna qui.",
    sources: { all: "Tutti", goldensneakers: "Fornitore", kicksdb: "KicksDB" } as Record<string, string>,
    sizes: (count: number) => (count === 1 ? "1 taglia" : `${n(count)} taglie`),
    publishAll: (count: number) => (count === 1 ? "Pubblica 1 prodotto" : `Pubblica tutti i ${n(count)}`),
    publishSome: (count: number) => (count === 1 ? "Pubblica il prodotto scelto" : `Pubblica i ${n(count)} scelti`),
    confirmTitle: "Pubblicare sul negozio?",
    confirmAll: (count: number) =>
      count === 1
        ? "Il prodotto viene creato nascosto, e compare sul sito con la sua prima foto."
        : `I ${n(count)} prodotti vengono creati nascosti, e compaiono sul sito con la loro prima foto. Ci vuole qualche minuto: tieni aperta questa pagina.`,
    confirm: "Pubblica",
    progress: (done: number, total: number) => `Pubblicati ${n(done)} di ${n(total)}…`,
    minutesLeft: (minutes: number) => (minutes <= 1 ? "circa un minuto" : `circa ${n(minutes)} minuti`),
    keepOpen: "Tieni aperta questa pagina finché finisce.",
    stop: "Ferma",
    stopping: "Mi fermo dopo questo blocco…",
    done: (created: number) =>
      created === 0 ? "Nessun prodotto creato" : created === 1 ? "1 prodotto creato" : `${n(created)} prodotti creati`,
    photosNext: "Compaiono sul sito appena arrivano le foto.",
    skipped: (count: number) => (count === 1 ? "1 c'era già" : `${n(count)} c'erano già`),
    failedCount: (count: number) => (count === 1 ? "1 non riuscito" : `${n(count)} non riusciti`),
    stopped: (done: number, total: number) => `Fermato dopo ${n(done)} di ${n(total)}: gli altri restano da pubblicare.`,
    unanswered: (count: number) =>
      `${n(count)} non hanno risposto in tempo: probabilmente sono stati creati lo stesso. Ricontrolla tra poco.`,
    proxyGaveUp: "Il server non risponde: mi sono fermato. Riprova tra qualche minuto.",
    unexpected: (status: number) => `Risposta inattesa dal server (HTTP ${status}): forse la sessione è scaduta. Ricarica la pagina.`,
    failed: "Pubblicazione non riuscita:",
    more: (shown: number, total: number) => `Ne vedi ${n(shown)} di ${n(total)}: «Pubblica tutti» li pubblica tutti.`,
    select: "Scegli",
    selectDone: "Fine",
  },

  /** "Ordini": the orders to fulfil, on the phone — the Hub's workflow, its words (t.orders) for statuses and fields. */
  orders: {
    title: "Ordini",
    intro: "Gli ordini del negozio: prendili in carico, aggiungi il tracking quando spedisci.",
    filters: { open: "Da fare", shipped: "Spediti", all: "Tutti" } as Record<string, string>,
    empty: { open: "Nessun ordine da evadere.", shipped: "Nessun ordine spedito.", all: "Nessun ordine." } as Record<string, string>,
    neverPulled: "Il Hub non ha ancora scaricato gli ordini.",
    pull: "Aggiorna gli ordini",
    pulled: (count: number) => (count === 1 ? "1 ordine aggiornato" : `${n(count)} ordini aggiornati`),
    number: (number: string) => `Ordine #${number}`,
    /** The address card's: short, beside "Chiama" and "Scrivi" on a phone's width. */
    copy: "Copia",
    call: "Chiama",
    write: "Scrivi",
    reopen: "Riapri",
    cancelConfirm: "Annullare l'ordine? Lo stato cambia qui: su WooCommerce va annullato a mano.",
    shipTitle: "Spedito",
    shipIntro: "Il tracking del pacco, se ce l'hai: resta con l'ordine.",
    saved: "Salvato",
  },

  settings: {
    title: "Aggiornamento automatico",
    storeSync: "Aggiorna il negozio da solo",
    storeSyncHint: "Prezzi e disponibilità dal listino del fornitore, senza che tu faccia nulla.",
    autoPublish: "Pubblica i nuovi prodotti",
    autoPublishHint: "I nuovi del listino vanno online da soli, appena arriva la loro prima foto.",
    every: "Ogni",
    everyTitle: "Ogni quanto aggiornare il negozio",
    interval: (minutes: number) =>
      minutes % 60 === 0 ? (minutes === 60 ? "1 ora" : `${minutes / 60} ore`) : `${minutes} minuti`,
    kicksdb: "Anche i prezzi KicksDB",
    kicksdbHint: "Una volta al giorno, con l'aggiornamento completo: si muovono di migliaia di taglie, vengono scritti un blocco alla volta.",
    daily: "Aggiornamento completo",
    dailyHint: "Ogni giorno: la copia del negozio, il listino e i prezzi. Meglio di notte, quando il negozio è tranquillo.",
    times: (times: string[]) => times.join(", "),
    timesTitle: "Aggiornamento completo",
    timesIntro: "A che ora, ogni giorno. Puoi metterne più di uno.",
    time: (index: number) => `Orario ${index + 1}`,
    addTime: "Aggiungi un orario",
    removeTime: "Togli questo orario",
    save: "Salva",
    saved: "Salvato: vale da subito",
    failed: "Non salvato:",
    invalidTimes: "Controlla gli orari: ore e minuti, per esempio 04:30.",
    more: "Altre impostazioni nel Hub",
  },

  add: {
    title: "Aggiungi prodotti",
    homeHint: "Con un codice, una lista o a mano",
    intro: "Scrivi o incolla i codici dei prodotti (SKU), anche tanti insieme: il Hub capisce da solo come aggiungere ciascuno.",
    label: "Codici",
    placeholder: "Es. DD1391-100 — uno per riga, o incollati da Excel",
    search: "Cerca",
    searching: (done: number, total: number) => `Cerco… ${n(done)} di ${n(total)}`,
    tooMany: (max: number) => `Al massimo ${n(max)} codici alla volta: cerca prima questi, poi gli altri.`,
    none: "Scrivi almeno un codice.",
    withoutCode: "Crea a mano",
    file: "Prendi i codici da un file",
    fileHint: "CSV o testo: una colonna di codici, da Excel o Google Fogli",
    fileEmpty: "Nel file non ci sono codici.",
    fileUnreadable: "Il file non si legge: salvalo come CSV e riprova.",
    kicksdbOff: "Il Hub non ha KicksDB: i codici che non conosce si creano a mano.",
    groups: {
      ready: (count: number) => `Pronti da aggiungere (${n(count)})`,
      byHand: (count: number) => `Da creare a mano (${n(count)})`,
      onStore: (count: number) => `Già nel negozio (${n(count)})`,
      unreachable: (count: number) => `KicksDB non ha risposto (${n(count)})`,
    },
    readyHint: "Taglie, prezzi e foto arrivano da soli: tocchi un bottone e basta.",
    byHandHint: "Nessuno li conosce, o non hanno taglie EU: li crei tu, con foto, taglie e prezzi.",
    route: {
      feed: "Dal fornitore",
      catalog: "Da KicksDB",
      kicksdb: "Da KicksDB",
      noSizes: "Senza taglie EU",
      delisted: "Il fornitore non lo vende più",
      unknown: "Nessuno lo conosce",
      unreachable: "KicksDB non ha risposto",
      onStore: "Già nel negozio",
    },
    hidden: "Nascosto finché arriva la foto",
    sizes: (count: number) => (count === 1 ? "1 taglia" : `${n(count)} taglie`),
    addAll: (count: number) => (count === 1 ? "Aggiungi al negozio" : `Aggiungi tutti e ${n(count)} al negozio`),
    confirmTitle: "Aggiungere al negozio?",
    confirmBody: (count: number) =>
      count === 1
        ? "Viene creato nascosto, e va online con la sua prima foto."
        : `I ${n(count)} prodotti vengono creati nascosti, e vanno online con la loro prima foto. Ci vuole qualche minuto: tieni aperta questa pagina.`,
    confirm: "Aggiungi",
    progress: (done: number, total: number) => `Aggiunti ${n(done)} di ${n(total)}…`,
    done: (count: number) => (count === 0 ? "Nessun prodotto aggiunto" : count === 1 ? "1 prodotto aggiunto" : `${n(count)} prodotti aggiunti`),
    added: "Aggiunto: va online con la prima foto",
    already: "Era già nel negozio",
    notOnKicksdb: "KicksDB non lo conosce: crealo a mano",
    kicksdbUnreachable: "KicksDB non ha risposto: riprova",
    notAdded: "Non aggiunto",
    make: "Crea",
    retry: "Riprova",
    open: "Apri",
    again: "Cerca altri codici",
    failed: "Non è andata:",
  },

  handmade: {
    title: "Nuovo prodotto",
    intro: "Lo crei tu: foto, nome, taglie e prezzi. Resta tuo: nessun listino lo cambierà.",
    photos: "Foto",
    photosHint: "La prima è la principale. Senza foto il prodotto resta nascosto.",
    addPhoto: "Aggiungi foto",
    uploading: "Carico…",
    photoFailed: "Non caricata",
    main: "Principale",
    makeMain: "Metti per prima",
    remove: "Togli",
    photoLink: "Aggiungi il link di una foto",
    photoLinkPlaceholder: "https://…",
    photoLinkInvalid: "Il link deve iniziare con https://",
    photosNoUpload:
      "Per caricare foto dal telefono serve la password applicazione di WordPress (WP_APP_USER e WP_APP_PASSWORD): chiedila a chi gestisce il server. Intanto puoi aggiungere i link delle foto.",
    tooManyPhotos: (max: number) => `Al massimo ${n(max)} foto.`,
    details: "Prodotto",
    name: "Nome",
    namePlaceholder: "Es. Nike Dunk Low Panda",
    sku: "Codice (SKU)",
    skuPlaceholder: "Es. DD1391-100",
    generate: "Generane uno",
    brand: "Marca",
    brandPlaceholder: "Es. Nike",
    categories: "Categorie",
    categoriesNone: "Nessuna",
    categoriesSearch: "Cerca una categoria",
    categoriesEmpty: "Nessuna categoria con questo nome.",
    categoriesMax: (max: number) => `Al massimo ${n(max)} categorie.`,
    done: "Fatto",
    description: "Descrizione",
    descriptionPlaceholder: "Racconta il prodotto: materiali, condizioni, cosa c'è nella scatola…",
    sizes: "Taglie e prezzi",
    withSizes: "Con taglie",
    oneSize: "Taglia unica",
    sizeColumn: "Taglia",
    addSizes: "Aggiungi taglie",
    shoes: "Scarpe (EU)",
    clothes: "Abbigliamento",
    otherSize: "Un'altra taglia",
    otherSizePlaceholder: "Es. 43 1/3 o 2XL",
    add: "Aggiungi",
    priceAll: "Prezzo per tutte",
    stockAll: "Pezzi per tutte",
    apply: "Applica",
    price: "Prezzo",
    stock: "Pezzi",
    barcode: "Codice a barre",
    barcodes: "Codici a barre",
    barcodesHint: "Facoltativi: servono a Google Shopping e ai marketplace.",
    size: (label: string) => `Taglia ${label}`,
    removeSize: "Togli la taglia",
    noSizes: "Aggiungi almeno una taglia, con il suo prezzo.",
    twice: (labels: string[]) => `Taglie ripetute: ${labels.join(", ")}`,
    google: "Su Google",
    googleHint: "Come il prodotto appare nei risultati: il titolo e la descrizione si scrivono da soli, cambiali se vuoi.",
    seoTitle: "Titolo per Google",
    seoDescription: "Descrizione per Google",
    slug: "Indirizzo",
    chars: (count: number, max: number) => `${n(count)}/${n(max)}`,
    noPlugin: "Il negozio non ha un plugin SEO (Yoast o Rank Math): Google usa il nome e la descrizione del prodotto.",
    plugin: (name: string) => `Scritti per ${name}`,
    visible: "In vendita subito",
    visibleHint: "Con almeno una foto va online appena creato; senza, resta nascosto finché non ne ha una.",
    hiddenHint: "Resta nascosto: lo metti in vendita da WordPress quando vuoi.",
    create: "Crea prodotto",
    creating: "Creo il prodotto…",
    uploadingWait: "Aspetta che le foto finiscano di caricarsi.",
    invalid: "Controlla:",
    fields: {
      sku: "il codice",
      title: "il nome",
      brand: "la marca",
      categoryIds: "le categorie",
      description: "la descrizione",
      photos: "le foto",
      sizes: "le taglie e i prezzi",
      seo: "i campi per Google",
      visible: "la visibilità",
    },
    skuTaken: (title: string) => `Il negozio ha già un prodotto con questo codice: ${title}.`,
    openIt: "Aprilo in WordPress",
    failed: "Il prodotto non è stato creato:",
    leave: "Hai iniziato un prodotto: se esci, lo perdi.",
    created: "Prodotto creato",
    createdLive: "È in vendita.",
    createdHidden: "È nascosto: va online con la sua prima foto.",
    createdHiddenByChoice: "È nascosto, come hai scelto: lo metti in vendita da WordPress.",
    createdPhotos: (count: number) => (count === 1 ? "1 foto in arrivo dal link." : `${n(count)} foto in arrivo dai link.`),
    gtinsRejected: (count: number) =>
      count === 1 ? "1 codice a barre non valido non è stato scritto." : `${n(count)} codici a barre non validi non sono stati scritti.`,
    sizesRefused: (labels: string[]) => `WooCommerce ha rifiutato le taglie ${labels.join(", ")}: aggiungile da WordPress.`,
    viewOnSite: "Vedi nel negozio",
    editInWp: "Apri in WordPress",
    another: "Aggiungi un altro prodotto",
    backToCodes: "Torna ai codici",
  },
};
