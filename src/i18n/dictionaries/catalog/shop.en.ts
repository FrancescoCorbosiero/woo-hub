import type { shopIt } from "./shop.it";

/** English strings for the Vetrina's "Store" tab; same shape as ./shop.it.ts. */

const n = (count: number) => count.toLocaleString("en-GB");

export const shopEn: typeof shopIt = {
  title: "Store",
  intro: "Your store keeps itself up to date from the supplier's list. Here you update it right now, and find what is waiting for you.",
  notConnected:
    "The store is not connected: it needs the WooCommerce keys (WOO_BASE_URL, WOO_CONSUMER_KEY and WOO_CONSUMER_SECRET). Ask whoever runs the server.",
  back: "Store",

  when: {
    today: (time) => `today at ${time}`,
    yesterday: (time) => `yesterday at ${time}`,
    tomorrow: (time) => `tomorrow at ${time}`,
    onDay: (day, time) => `${day} at ${time}`,
  },

  sync: {
    now: "Sync now",
    step: {
      pull: "Reading the store…",
      gs: "Downloading the supplier's list…",
      feedSync: "Updating prices and stock…",
      kicksdb: "Updating the KicksDB prices…",
      storeSync: "Writing the KicksDB prices…",
      collections: "Updating the automatic categories…",
      repair: "Fixing products…",
      backfill: "Completing product details…",
      recategorize: "Tidying the categories…",
    },
    working: "Syncing…",
    stepOf: (step, of) => `Step ${step} of ${of}`,
    scheduled: "The scheduled update has started: follow it here.",
    last: (when) => `Last updated ${when}`,
    lastFailed: (when) => `Last updated ${when}: not everything worked`,
    never: "Not updated yet",
    next: (when) => `Next ${when}`,
    autoOff: "Automatic updates are off: the store changes only when you press here.",
    devOff: "Scheduled updates are off on this server (development).",
    nothing: "There is nothing to sync: no supplier list is connected, and the KicksDB prices are not included.",
    notWriter: "This server does not write to the store: the sync starts only from the main one.",
    running: "A sync is already going: follow it here.",
    failed: "Did not start:",

    result: {
      title: (when) => `Synced ${when}`,
      titleFailed: (when) => `Synced ${when}, with some problems`,
      feed: (products, added, removed) =>
        `Supplier list: ${n(products)} products` +
        (added > 0 ? `, ${n(added)} new` : "") +
        (removed > 0 ? `, ${removed === 1 ? "1 no longer available" : `${n(removed)} no longer available`}` : ""),
      written: (count) =>
        count === 0 ? "Prices and stock were already up to date" : count === 1 ? "1 price or stock level updated" : `${n(count)} prices and stock levels updated`,
      writtenKicks: (count) =>
        count === 0 ? "The KicksDB prices were already up to date" : count === 1 ? "1 KicksDB price updated" : `${n(count)} KicksDB prices updated`,
      added: (count) => (count === 1 ? "1 size added" : `${n(count)} sizes added`),
      kept: (count) =>
        count === 1
          ? "1 price changed on WordPress left as it is: your call"
          : `${n(count)} prices changed on WordPress left as they are: your call`,
      deferred: (count) => `${n(count)} more at the next sync`,
      held: (count) => (count === 1 ? "1 size to add from the Hub's Sync tab" : `${n(count)} sizes to add from the Hub's Sync tab`),
      failed: (count) => (count === 1 ? "1 change did not go through" : `${n(count)} changes did not go through`),
      capped: (planned, limit) =>
        `Too many changes at once (${n(planned)}; the limit is ${n(limit)}): nothing written. It is usually a broken list — check them in the Hub's Sync tab.`,
      pullRunning: "The Hub was reading the store: nothing written. Try again in a few minutes.",
      stepFailed: (step) => `${step}: did not work`,
      stepName: {
        gs: "Supplier list",
        feedSync: "Prices and stock",
        kicksdb: "KicksDB prices",
        storeSync: "KicksDB prices in the store",
      },
      details: "Details",
    },
  },

  todo: {
    title: "To do",
    orders: "Orders to fulfil",
    storeEdits: "Prices changed on WordPress",
    toPublish: "New products to publish",
    none: "None",
  },

  prices: {
    title: "Changed prices",
    intro:
      "Someone changed these prices on WordPress after the last update. The Hub left them as they are: you choose which price to keep.",
    empty: "Nothing to decide: no price was changed on WordPress.",
    more: (shown, total) => `You see ${n(shown)} of ${n(total)}: the choices for all apply to the others too.`,
    size: (size) => `Size ${size}`,
    row: (store, hub) => `On WordPress ${store} · the Hub's ${hub}`,
    keep: (price) => `Keep ${price} (WordPress)`,
    reprice: (price) => `Put back ${price} (Hub)`,
    keepAll: "Keep all of WordPress's",
    repriceAll: "Put back all the Hub's prices",
    keepAllConfirm: (count) =>
      count === 1
        ? "WordPress's price stays, and the Hub locks it on that size: from now on the Hub writes it."
        : `WordPress's ${n(count)} prices stay, and the Hub locks them on their sizes: from now on the Hub writes them.`,
    repriceAllConfirm: (count) =>
      count === 1 ? "The Hub's price is written to the store now." : `The Hub's ${n(count)} prices are written to the store now.`,
    confirm: "Confirm",
    notLockable: "This size cannot be locked: you can only put back the Hub's price.",
    kept: (count) => (count === 1 ? "WordPress's price kept" : `${n(count)} of WordPress's prices kept`),
    repriced: (count) => (count === 1 ? "The Hub's price put back" : `${n(count)} of the Hub's prices put back`),
    failed: "Did not work:",
  },

  publish: {
    title: "New products",
    intro:
      "Products from the supplier's list and the catalog that the store does not have yet. Published, they are created hidden, and show on the site as soon as their first photo arrives.",
    empty: "Nothing to publish: the store already has every product of the catalog.",
    noSnapshot: "The Hub has not read the store yet: wait for the first full update, then come back.",
    sources: { all: "All", goldensneakers: "Supplier", kicksdb: "KicksDB" },
    sizes: (count) => (count === 1 ? "1 size" : `${n(count)} sizes`),
    publishAll: (count) => (count === 1 ? "Publish 1 product" : `Publish all ${n(count)}`),
    publishSome: (count) => (count === 1 ? "Publish the chosen product" : `Publish the ${n(count)} chosen`),
    confirmTitle: "Publish to the store?",
    confirmAll: (count) =>
      count === 1
        ? "The product is created hidden, and shows on the site with its first photo."
        : `The ${n(count)} products are created hidden, and show on the site with their first photo. It takes a few minutes: keep this page open.`,
    confirm: "Publish",
    progress: (done, total) => `Published ${n(done)} of ${n(total)}…`,
    minutesLeft: (minutes) => (minutes <= 1 ? "about a minute" : `about ${n(minutes)} minutes`),
    keepOpen: "Keep this page open until it ends.",
    stop: "Stop",
    stopping: "Stopping after this batch…",
    done: (created) => (created === 0 ? "No product created" : created === 1 ? "1 product created" : `${n(created)} products created`),
    photosNext: "They show on the site as soon as their photos arrive.",
    skipped: (count) => (count === 1 ? "1 was already there" : `${n(count)} were already there`),
    failedCount: (count) => (count === 1 ? "1 did not work" : `${n(count)} did not work`),
    stopped: (done, total) => `Stopped after ${n(done)} of ${n(total)}: the others are still to publish.`,
    unanswered: (count) => `${n(count)} did not answer in time: they were most likely created anyway. Check again shortly.`,
    proxyGaveUp: "The server does not answer: stopped. Try again in a few minutes.",
    unexpected: (status) => `Unexpected answer from the server (HTTP ${status}): the session may have expired. Reload the page.`,
    failed: "Publishing did not work:",
    more: (shown, total) => `You see ${n(shown)} of ${n(total)}: "Publish all" publishes them all.`,
    select: "Choose",
    selectDone: "Done",
  },

  orders: {
    title: "Orders",
    intro: "The store's orders: take them on, add the tracking when you ship.",
    filters: { open: "To do", shipped: "Shipped", all: "All" },
    empty: { open: "No order to fulfil.", shipped: "No shipped order.", all: "No orders." },
    neverPulled: "The Hub has not downloaded the orders yet.",
    pull: "Update the orders",
    pulled: (count) => (count === 1 ? "1 order updated" : `${n(count)} orders updated`),
    number: (number) => `Order #${number}`,
    call: "Call",
    write: "Write",
    reopen: "Reopen",
    cancelConfirm: "Cancel the order? Its status changes here: on WooCommerce it has to be cancelled by hand.",
    shipTitle: "Shipped",
    shipIntro: "The parcel's tracking, if you have it: it stays with the order.",
    saved: "Saved",
  },

  settings: {
    title: "Automatic updates",
    storeSync: "Update the store on its own",
    storeSyncHint: "Prices and stock from the supplier's list, without you doing anything.",
    every: "Every",
    everyTitle: "How often to update the store",
    interval: (minutes) => (minutes % 60 === 0 ? (minutes === 60 ? "1 hour" : `${minutes / 60} hours`) : `${minutes} minutes`),
    kicksdb: "The KicksDB prices too",
    kicksdbHint: "Once a day, with the full update: they move by thousands of sizes, so they are written a batch at a time.",
    daily: "Full update",
    dailyHint: "Every day: the copy of the store, the supplier's list and the prices. Best at night, when the store is quiet.",
    times: (times) => times.join(", "),
    timesTitle: "Full update",
    timesIntro: "At what time, every day. You can set more than one.",
    time: (index) => `Time ${index + 1}`,
    addTime: "Add a time",
    removeTime: "Remove this time",
    save: "Save",
    saved: "Saved: it applies right away",
    failed: "Not saved:",
    invalidTimes: "Check the times: hours and minutes, for example 04:30.",
    more: "More settings in the Hub",
  },
};
