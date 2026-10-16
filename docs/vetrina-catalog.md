# Vetrina — the catalog (design + spec, v1)

Status: **all four phases done** (this branch): the Hub's Catalog tab is
gone, the store index stays fresh with what a catalog lists, every live price
write reads the store first, and the Vetrina has its Catalogo tab — browsing
by category and brand, search, quick views, the product sheet's place in the
shop — acts on one product or many (hide and show, sales, tags, categories,
homepage pins), each with a preview and "Annulla", and sets a margin on a
category or a brand that the Hub's engine applies ("Ricarico"). See
[Phases](#7-phases).

The Vetrina gets a second tab, **Catalogo**, next to the homepage editor: the
shop by **category and brand** — the store's own `product_cat` and
`product_brand` — with search everywhere, and actions on one product or many.
It is the owner's tool, on the phone. The Hub's old Catalog tab browsed the
*source* catalog (KicksDB, the supplier feed) through the Hub's own family
tree; that is the operator's view, and it is gone.

- [1. Decisions](#1-decisions)
- [2. Where things live](#2-where-things-live)
- [3. Prices: one engine, one way in](#3-prices-one-engine-one-way-in)
- [4. The screens](#4-the-screens)
- [5. Homepage ↔ catalog](#5-homepage--catalog)
- [6. Data and writes](#6-data-and-writes)
- [7. Phases](#7-phases)
- [8. Open questions](#8-open-questions)

## 1. Decisions

| Topic | Decision |
|---|---|
| Where | The Vetrina (`/vetrina/catalogo/…`), so it is served on the Vetrina's own address too. Konsta UI, the Vetrina's stack. |
| Navigation | **Categorie** and **Brand**, the store's two taxonomies. Tags are not a third axis: they are one of the things an automatic category's rule can read (with brand, category, attribute, name, price, sale, stock and the date a product was added), and what an action adds or removes ("Tag +/−"). The catalog's lists do not filter by tag yet: a tag's products are listed through an automatic category on it. Quick views cover the rest: sold out, on sale, hidden, without photo, without category. |
| The Hub's Catalog tab | **Removed.** The product drawer stays, on every Hub page (`?product=SKU`): it is the only home of a few operator tools (re-sync from KicksDB, the price-source switch). |
| Hiding a category | **Its products are hidden, everywhere** (`catalog_visibility = hidden`), those that join it later too, and "Mostra" restores exactly what was hidden: a product already hidden before stays hidden. No plugin change. A product also in other categories disappears there too, and the sheet says so before acting. |
| Plugins | **woo-hub only.** See [§2](#2-where-things-live). |
| Prices | The Hub engine stays the only writer of regular prices. The catalog's price actions are inputs to it. See [§3](#3-prices-one-engine-one-way-in). |
| Sales | **The owner's own call.** A sale is a percentage off the regular price, rounded down, with no end date unless the owner picks one. No cost checks, no price history, no monitors: the owner answers for his prices, the app just makes them quick to set and to undo. |

## 2. Where things live

Two WordPress plugins appear in this project's history, and they are different
things:

- **golden-hive-plugin** (`golden-hive`, `hive-sync`) — a WordPress admin
  toolbox (Filter & Act, bulk actions, a sorter, smart taxonomy). The catalog
  takes **ideas** from it and nothing else: its features run as admin-ajax
  calls behind a WordPress cookie, not as an API, and calling a second engine
  that writes prices and categories would be exactly the two-writers mess
  [hub-and-plugin.md](hub-and-plugin.md) rules out. Nothing here depends on it.
- **golden-hive-blocks** — the storefront plugin. It renders the homepage and
  already exposes the `wc-gh/v1` endpoints the Vetrina calls (homepage, rails,
  product cards, block writes, history). That is the "lightweight caller"
  pattern, and the catalog uses those endpoints **as they are**. No change to
  it is planned.

What that rules out, for now: an order of its own for a category that no
homepage section shows (only WordPress can apply an order to a category page),
and pointing a homepage section at a different category. The first keeps the
shop's default order, with "sold out last" (the storefront already does it);
the second has a woo-hub answer: make that section's category automatic with
the rule you want — from the section editor or the category's screen, in the
rule's own sheet ([§5](#5-homepage--catalog)).

Ideas taken from golden-hive-plugin, and what we do differently:

| There | Here |
|---|---|
| Filter & Act: conditions → select all → act | A term's screen with its chips (stock, visibility, sale, the other taxonomy's terms) and search, "Seleziona tutti" over what they match, then act; the screen's filters can be saved as a new automatic category, whose rule language is richer (tags, price, age). A tag, a price or a date is not a list filter yet |
| Bulk sale % / remove sale / rounding | Saldo and Togli saldo, with a preview and "Annulla" ([§3.4](#34-the-catalogs-price-actions)) |
| "Saldo fittizio" (raise the regular price, sell at the old one) | **Not ported**: art. 17-bis of the Codice del Consumo measures an announced discount from the lowest price of the previous 30 days |
| A sorter writing one global `menu_order` | Not ported: one number per product, shared by every category, last sort wins |
| No undo; snapshots without restore | Every bulk action logged with the previous values; "Annulla" restores them |
| Smart taxonomy that only adds | Automatic categories add **and** remove, with a safety net |
| hive-sync's hide with memory (`catalog_visibility`, previous state kept) | The model for "Nascondi categoria" |

## 3. Prices: one engine, one way in

The Hub writes regular prices from the sources (StockX via KicksDB, the
supplier feed) through the margin rules: every quarter of an hour for the
feed's products, daily for the rest with `AUTO_SYNC=on`, and whenever the
operator applies the Sync tab. The catalog adds a person changing prices from a
phone, at any moment, possibly while the Sync tab is open and the feed cycle is
writing. This section is the contract that keeps the two from fighting.

### 3.1 Who owns which field

| Field | Owner | How the other side treats it |
|---|---|---|
| Regular price of a size the engine prices | **The engine** | A person changes it through the engine: a lock (a size's price), a margin rule. The Vetrina never writes it directly. |
| Sale price | **The shop owner** | The engine never writes it on an existing product. A size with a sale price keeps its regular price while its product follows the sale rule (the default): the plan holds it, and so does the last look before the write. |
| Stock of a feed product | The feed, through the sync | Not a catalog action. |
| Price and stock of a store-only product | The owner | Written directly; no engine prices it. |
| Visibility, categories, tags | The owner (categories: also the automatic categories' rules) | The price engine never writes them. |

### 3.2 One way in for every price write

Every write of a regular price over one the store already has — the
scheduler's, the Sync tab's, the Vetrina's "Salva e pubblica", the list's "use
the Hub's price" — goes through the same path: **plan → read the product again
→ write → record**. (Publish creates products, after a live SKU lookup; the
rebuild recreates a product's sizes on an explicit, dry-run-first operator
action. Both record what they write in the ledger.)

1. **Plan** from the snapshot (the store as last read), with the locks and
   margin rules, and the ledger of what the Hub last wrote.
2. **Read the product again**, right before writing it (`liveCheck`, see
   `src/server/woo/live-check.ts`). Per size:
   - the store shows what the plan was made against → written;
   - the store moved since → **kept**, and listed under "Prices changed on
     WordPress" — unless that price is the Hub's own newer write (another Hub
     write landed meanwhile), which is simply left alone;
   - the size went on sale since → **left alone** when the product follows the
     sale rule and the size has no lock;
   - the size's price was decided by a person just now (a lock set or cleared
     in the sheet, a size handed back to the rules) → written, whatever the
     store shows: that decision is the newer word.
   - the size's lock was set, moved or cleared after the plan was made (a lock
     saved in the Hub drawer, which does not write it) → **not written** at
     the plan's price: the next plan writes the lock, or the rules' price.
3. **Write**, per product, one batch.
4. **Record**: the ledger takes every price written as soon as its product is
   written (the Hub's last word, which tells a later WordPress edit apart —
   and which a plan made meanwhile reads: a whole-store apply runs for many
   minutes); the snapshot learns the products as the store answered (a sale
   started meanwhile included) at the end of the run, each dated by its own
   write, so a newer write's copy is never put back to an older one. A plan
   reads a ledger price written after the snapshot's copy of the product as
   what the store holds.

### 3.3 The races, and what pins each one down

Each row is a test against real SQL and a stand-in store — in
`src/server/sync/ledger.db.test.ts` unless the row names another — except the
last two, which say how the design behaves.

| Situation | What happens |
|---|---|
| The owner locks size 42 in the Vetrina; someone changed size 43 in WordPress since the Hub last read the store | 42 is written; 43 keeps the WordPress price and is listed |
| The owner locks size 42; WordPress had changed 42 itself since the last read | 42 is written: the owner's lock is the newer word |
| The operator applies a Sync preview made before the owner's Vetrina lock | The lock stands; the older computed price is not written |
| The operator applies a Sync preview made before a lock saved in the drawer (not written), or before a lock was cleared | Neither the preview's price nor the old lock price is written; the next sync writes the lock (or the rules' price) |
| The Vetrina writes a product while the feed cycle is between its plan and its write | The cycle leaves the Hub's newer price alone, lists nothing, and counts nothing as changed on WordPress |
| A newer plan (the feed cycle, a Vetrina margin, "Salva e pubblica") runs while a whole-store apply is still going, on a product that apply already wrote | The newer plan reads the apply's write from the ledger and writes over it; nothing is listed; at its end the apply does not put its older copy over the newer one in the snapshot (nor over a sale learnt meanwhile) |
| A sale is started (in WordPress, or the Vetrina) after the snapshot was read | The size's regular price is left alone; its stock still syncs; the snapshot learns the sale |
| A locked size goes on sale | The lock is written: a lock wins over a sale price, as in the plan |
| "Use the Hub's price" on 42 while 43 was changed in WordPress meanwhile | 42 is written; 43 is kept and listed |
| A Vetrina margin is applied while a size was changed in WordPress and another put on sale since the snapshot (`src/server/vetrina/operations/margin.db.test.ts`) | Neither is written: the edit is listed, the sale is learnt by the snapshot |
| Two editors save the rule list at once — the Margins tab, the pricing bar, a Vetrina margin (`margin.db.test.ts`, `src/server/pricing/store-term-margins.db.test.ts`) | One lock on the list (`src/server/config/rule-list.ts`, `updateActiveConfig`): each change is made to the list as it is now; a Margins tab opened before another editor's save is refused as stale, and reloads |
| The store's categories and brands cannot be read while a store-term margin exists (`store-term-margins.db.test.ts`) | Prices held: the sync writes none it could price without them (the feed's stock still syncs), the Publisher and the rebuild leave the product for later, the Vetrina refuses a margin, the drawer flags its prices |
| A new product is published into a category with a margin (`store-term-margins.db.test.ts`) | It is priced by the categories and brand it is being filed under, from its first write |
| Two writers change locks at once — the owner's sheet, the operator's drawer, "Mantieni" on the list (`src/server/overrides/repo.db.test.ts`) | One lock on the overrides: neither loses the other's locks |
| The store-wide "reprice discounted" switch is on and the owner runs a Saldo | The engine keeps pricing those sizes' regular price, as the switch says; the sale price stays the owner's. The Saldo's preview says so before it runs |
| A store-only product, priced by hand, later gets a source | The engine prices it from then on, like any product with a source; a lock keeps the owner's price |

### 3.4 The catalog's price actions

The catalog offers prices by **intention**, never by field:

| Action | Mechanism | What it takes care of |
|---|---|---|
| **Metti in saldo** (x %, until a date or not) | The sale price of each size, read live and written through the store's batch endpoints; the sizes' previous sale prices and dates kept for "Annulla", with the regular price they belong to | Rounded down — to ,99 from 10 € up, or to the cent — so the discount is never smaller than announced. A size with no regular price, or where the sale would not be lower, is skipped and named. Where the store's answer shows the engine wrote a new regular price between the sale's read and its write, the size is planned again from it (or put back, if the sale no longer lowers it). The end date is WooCommerce's own (`date_on_sale_to`). "Cambia lo sconto" at the same percent only moves the end, and says so (the rows, the label, the undo's words). Preview naming the products, background run, log, "Annulla". The regular price is never written. |
| **Togli il saldo** | Clears the sale price and dates; the next plan prices the sizes again | Logged; "Annulla" puts the sale back — only on sizes whose regular price is still the one the sale belonged to: over a regular price the engine moved since, the old sale price would announce another discount, and the size is left as it is |
| **Cambia il ricarico** (a category or a brand) | A pricing rule scoped to the store term, applied by the engine on every sync — as built, below | Never a supplier's (GoldenSneakers) nor a store-only price; preview, background run, log and "Annulla" like every action |
| **Fissa il prezzo** (one product) | Locks, as the product sheet does today | Below-market warning (exists) |

**Cambia il ricarico, as built** (`src/server/vetrina/operations/margin.ts`,
`margin-plan.ts`; the row and the sheet in
`src/components/vetrina/catalog/margins/`):

- **Who it applies to**: the term's products and its sub-terms' that the Hub
  prices from the market (KicksDB) and that no more specific rule takes — a
  SKU rule, a deeper term's margin. The supplier's products (GoldenSneakers)
  keep the supplier's price and store-only products their own: neither ever
  takes a store-term rule, and the preview and the row count them apart. The
  term's "Ricarico" row says the margin it follows (its own, a term above
  it's, the standard, other rules of the Hub) and how many products it
  applies to.
- **The rule**: `storeCategory` / `storeBrand` (the term's id, sub-terms
  included) with `storeTermName` as its label, saved into the Hub's rule list
  under the list's lock; "Togli ricarico" removes it, and the term follows
  the margin above it, or the Hub's rules. Precedence: lock > sale held > SKU
  rule > store-term rule (the deeper term first, then the later rule) > every
  other rule. The Hub's Margins tab shows and edits the same rule.
- **Preview**: each product priced by the engine itself under the rules in
  force and under the draft, from what the store shows, moved only as the
  sync's plan would move it: up, down, unchanged, the average change, the
  products it moves most, and the sizes it leaves — locked, on sale (their
  new full price comes when the sale ends), within the minimum change, past
  the maximum, changed on WordPress.
- **Apply and undo through the operation runner**: one action of the log,
  queued like the others. The rule it replaces is filed before the save (a
  run cut off after it stays undoable); then the term's SKUs are repriced by
  `runPriceSync({ skus, liveCheck: true })`, a hundred at a time (§3.2), the
  progress pill moving after each. "Annulla" puts the rule from before back
  where it was in the list and reprices the same way; it is refused when the
  term's rule was changed since (here or on the Margins tab): the newer word
  stands. The engine keeps the margin on every sync after.
- **Refused** on the demo shop (its terms are not the real shop's), without a
  snapshot (nothing to reprice), and while the store's categories and brands
  cannot be read (the sync would hold those prices anyway).
- **A product moved between categories** from the Vetrina ("Categoria +/−",
  a pin into a manual category's section, or their undo) under another
  margin is repriced right after the move, the same way; the categorize
  preview says how many change margin. A new product published into a
  category with a margin takes it from its first write.

No cost checks, no 30-day price history, no sale monitors: the owner sets his
own prices ([§1](#1-decisions)).

## 4. The screens

The Vetrina becomes a two-tab app: **Homepage** (today's editor) and
**Catalogo**. Konsta's native pieces throughout: grouped lists, the search bar
in the navbar, segmented controls, a tab bar and an action toolbar, action
sheets, a slider, chips.

**Catalogo**: search at the top of every screen (categories, brands and
products by name or SKU, at once, results grouped by kind); `Categorie | Brand`;
quick views as chips; then the categories behind a homepage section, the
automatic ones (their rule in words), and all of them as a tap-through
hierarchy with counts, the empty ones folded away. Brands: an A–Z list. "+"
creates an automatic category.

**A category or a brand**: a header that is its control panel — "Visibile nel
negozio" (the hide toggle), its rule, its homepage section, its sale, its
order — then its products, with chips to filter (in stock, sold out, hidden, on
sale, sub-categories, the brands inside it) and a sort. Products hidden one by
one get "Mostra i N nascosti"; those another hidden category or brand holds
come back only with that one's switch, and the panel names it (so does the
toast of a "Mostra" that leaves them). A new discount
on a term on sale replaces the term's own: only products on a sale of their
own are warned about. "Seleziona" (or a long
press) turns the rows into a selection with an action bar; "Seleziona tutti"
takes everything the filter matches, not only the rows loaded.

**A product**: today's product sheet, with its visibility, categories, tags,
sale and where it shows on the homepage.

**Bulk actions, first version**: Saldo, Nascondi / Mostra, Tag + / −,
Categoria + / − (manual categories only: an automatic one is decided by its
rule), Metti in homepage (pin into a section). Each one: a preview naming the
products, a background run with progress, a log with the previous values,
"Annulla".

As built (phase 3, `src/components/vetrina/catalog/act/`):

- **Selection**: "Seleziona" on any list, or a long press on a row. While
  selecting, an action bar takes the tab bar's place: Saldo, Nascondi /
  Mostra, Tag, Categoria, Homepage. "Tutti (N)" takes everything the screen's
  search and chips match — a query, resolved again when the action runs — not
  only the rows loaded.
- **Sheets**: one per action, each asking the server for a preview first
  (who changes, before → after, who is left as is and why, what to know)
  and only then offering the button.
- **Progress and undo**: a pill above the tab bar while an action runs; a
  toast with "Annulla" when it ends; **Attività** (from a screen's ⋯ menu)
  lists the recent actions with their own "Annulla".
- **A term's panel**: "Visibile nel negozio" hides the whole category or
  brand, however many products it has, and switching it back on undoes
  exactly that hide. While it is hidden, a product that joins the term is
  hidden with it at the next check of the index (or at once, from the
  panel's "Nascondi i N nuovi arrivati", after which the screen reads its
  counts and rows again), filed under the same hide so "Mostra" brings it
  back too; a hide whose products were all shown another way is closed for
  good. "Metti in saldo" starts a sale filed under the term, then reads
  "Saldo −20% · fino a domenica" with "Cambia lo sconto" (its button reads
  "Sposta la fine del saldo" when only the last day moves) and "Togli il
  saldo". "Ricarico" opens the margin sheet; on a term none of whose
  products has a Hub price it stays as a quiet row saying so.
- **The product sheet**: its visibility (switched back on, as it was before
  its hide), its categories (add, remove), its tags (saved as a change over
  the product's tags as they are now), its sale, "Metti in homepage".
- **New automatic category** from the catalog's "+", or from a term's ⋯ menu
  with the screen's filters as its rule. The rule of a category a section
  shows is edited in its own sheet, from the section editor or the
  category's screen.

## 5. Homepage ↔ catalog

| Link | Through |
|---|---|
| A category's screen shows its homepage section and opens the section editor; the section editor opens the category in the catalog | The rails' terms (`wc-gh/v1/homepage`) |
| A product's sheet says where it shows ("TENDENZA #3 fissato · SALDI #12"); a ⌂ marks it in lists | The rails' rendered products |
| Ordering a category that has a section is ordering that section | The storefront already applies a section's pins to its category page |
| "Metti in homepage" from a product or a selection | A section write, as the editor does (a WordPress revision) |
| A filter becomes a new automatic category (a term's ⋯ menu); a section's category gets its rule in its own sheet | The automatic categories |
| Hiding or discounting first says which sections it touches; putting products into a hidden category says they are hidden with it | The index and the rails |
| The homepage screen flags sold-out, hidden or photo-less products in a section's visible slots; the card opens the section editor, where they are dealt with | The index and the rails |
| NUOVI ARRIVI on autopilot: "aggiunti negli ultimi 30 giorni" | An automatic category |

## 6. Data and writes

- **Reads**: `store_index` (Postgres), kept fresh by the automatic categories'
  runs — every 5 minutes one light request for what changed, a full read daily
  and at every server start. It holds every product but the binned ones, with
  categories, tags, brands, attributes, price, sale, stock, dates, and (phase
  1) the first photo, the catalog visibility, `menu_order` and the sales count.
  Each answer (`src/server/vetrina/catalog.ts`) reads the index's light
  columns once, then filters, counts and sorts in memory — names with an
  Italian collator, so "Jordan 4" comes before "Jordan 11" — and reads whole
  only the rows of the page on screen. 10 000 products take a few tens of
  milliseconds.
- **Known gap**: the 5-minute check asks WooCommerce for what changed with
  `status=any`, which leaves the bin out, so a product trashed or deleted in
  WordPress keeps its last state in the index (and in the catalog's counts and
  quick views) until the daily full read drops it. The check starts from its
  own last read, not from the newest row in the index: the Vetrina's actions
  write rows between checks.
- **Thumbnails**: never the full-size photo on mobile data: the storefront's
  own `woocommerce_thumbnail` through the existing `wc-gh/v1/products` cards
  (one request per page of rows, as the section editor does).
- **What the screens remember** (the site and the store are slow; what they
  show changes rarely). Every write still reads the store or the page again
  first, so a screen a little behind can never cause a wrong write — at worst
  a preview shows a change the write then skips, or a publish is refused as
  "changed meanwhile":
  - the homepage (`home-cache.ts`), shared by the Homepage tab, the catalog's
    marks and the pin sheet: read at most once a minute, then answered at
    once while a new read runs behind (never more than ten minutes old); a
    failed read is not retried for half a minute;
  - product cards (`card-cache.ts`): ten minutes each;
  - the categories and brands the screens show: five minutes, then answered
    at once while new ones are read (half an hour at most); actions read
    them through the five-minute term cache, as before;
  - a sale preview's live sizes: one minute;
  - the product sheet's tags come from the index (saving applies only the
    sheet's change, over the tags read live).

  Forgotten at once by what the Hub itself changes: a published section or
  block (the homepage), a finished action (the homepage, every card, the
  previews), a sync's write or a change the 5-minute check learns of (that
  product's card), a term the Hub creates (the screens' categories). **↻**
  forgets all of it, and on Catalogo first asks the store what changed
  (waited for up to six seconds).
- **Writes** (`src/server/vetrina/operations/`): WooCommerce's batch
  endpoints, in a background runner — one action at a time, in order, in the
  server process; it outlives the request, writes its progress as it goes,
  and an action found running after a restart is marked interrupted (what it
  changed can still be undone). Each product is read again before it is
  written; the index and the snapshot are patched from the store's answer.
  Tag and category writes run in the automatic categories' own queue, so
  they never race a rule's decision, and ask the rules to look again after;
  the product sheet's tag save goes there too, as a change over the
  product's tags read then, so a bulk "Tag +" running meanwhile keeps its tag.
- **The log**: `vetrina_operations` (the action, its input, label, progress,
  status) and `vetrina_operation_items` (per product, or per size for a
  sale: the field, the value before, the value written), each item filed
  **before** its write. "Annulla" (within 7 days) writes the value before
  back only where the store still shows what the action wrote; a value
  changed since is left alone and counted, one word per product. Undoing a
  term's hide keeps hidden what another standing hide still covers (the
  toast names it), and what a newer hide hid since. A sale price goes back
  only over the regular price it belongs to. A homepage pin is filed before
  its write and undone only while the section is as the pin left it (a
  section deleted since: the categories it added still come off). Rows are
  kept 30 days, except an action that still stands on a whole term — its
  hide while it hides something, its sale — but not the sales and ends of
  sale behind an end past its undo, which the screen can no longer reach.
  The scheduler's daily retention pass (`src/server/retention.ts`) cuts the
  rest.
- **Whole terms**: a term's own hide or sale takes all of its products (up to
  the index's 50 000), never the 2 000 a selection's action is capped at. A
  hide hides the products that join the term later (the scheduler asks after
  each check of the index; an action that moves products between categories
  asks after it), and is closed (`ended_at`) once nothing it hid is hidden
  any more, or a new hide of the term takes over: it never stands again.
- **Sales on the store**: `sale_price` with `date_on_sale_from` cleared and
  `date_on_sale_to` at the end of the last day, shop time
  (`YYYY-MM-DDT23:59:59`), or none; ending a sale writes them empty. Sizes
  of a variable product through `products/{id}/variations/batch`, a product
  sold as one item through `products/batch`. The regular price is never
  written.

## 7. Phases

| Phase | Scope | State |
|---|---|---|
| 1 · Foundations | The Hub's Catalog tab removed (drawer on every page); the store index fresh whatever the rules, with photo, visibility, order and sales; every live price write reads the store first | **Done** |
| 2 · Browse | The tab bar; Catalogo; a category's and a brand's screen; search; quick views; the product sheet extended; homepage ↔ catalog links | **Done** |
| 3 · Act | Selection and bulk actions; the operations log and "Annulla"; new automatic category, filter → category; Saldo and Togli saldo (§3.4); hide and show a whole category or brand | **Done** |
| 4 · Margins | A margin rule per store category or brand, previewed, applied by the engine: the "Ricarico" row and sheet (`src/components/vetrina/catalog/margins/`), the action (`src/server/vetrina/operations/margin*.ts`), store terms read for every price (`src/server/pricing/store-terms.ts`), the Hub's Margins tab editing the same rules under one lock (`src/server/config/rule-list.ts`) | **Done** |

## 8. Open questions

1. **iPhone or Android** (Konsta's theme: `ios` today).

Answered: sales work on every product and come first, margins (phase 4) never
change a GoldenSneakers price; a sale has no end date unless the owner picks
one; and the owner, not the app, answers for what a sale announces.
