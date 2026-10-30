# Store Hub

*(repo name `kicks-js-proxy` is historical — the app is branded Store Hub.)*

The middleware between a WooCommerce shop and its non-technical vendor: one
place to **see and manage the whole store inventory**. Built around an
**ever-increasing, multi-source catalog** that mirrors everything the store
sells — StockX-priced products (via the KicksDB API), supplier-feed products,
and plain store-only products with no feed linked. The operator explores the
catalog, locks manual prices, edits store-only products directly, and syncs
the WooCommerce store **live over REST** — pull store state, preview a
per-variant repricing plan, apply the selected changes (dry-run first).

Next.js (App Router) · TypeScript · Tailwind + shadcn-style primitives · Drizzle/Postgres
· Redis (optional KicksDB cache) · Zod. **No `@tanstack/*`** (enforced in CI).

## Setup

```bash
npm ci
cp .env.example .env            # KicksDB key, Woo REST creds, DB/Redis URLs
docker compose up -d            # local Postgres + Redis (dev only)
npm run db:migrate              # apply migrations (creates all tables)
npm run serve                   # http://localhost:3000 (operator dashboard)
```

All secrets live in env (typed + Zod-validated in `src/lib/env.ts`); none are persisted.

**Production** runs in Docker behind Caddy: the app with Postgres and Redis,
the Hub and the Vetrina on their own addresses. See [docs/deploy.md](docs/deploy.md).

**Sign-in** is not the app's job: [Authelia](https://www.authelia.com) sits in
front of it, with an account per person (name and password, locked after
wrong guesses) and per-shop access (a shop's account opens its own Hub and
Vetrina; the admin's opens every shop). Caddy asks Authelia about every request and the app
trusts only what Caddy vouches for. Locally there is no sign-in. See
[docs/auth.md](docs/auth.md).

**Store Hub and Hive Suite.** One writer of product data — this app. What a
product is, costs and has in stock is decided and written here; WordPress keeps
what only it can do (email, the media library, the storefront's blocks). Where
each feature of the hive-commerce plan belongs, and why:
[docs/hub-and-plugin.md](docs/hub-and-plugin.md).

### Use `npm run serve`, not `npm run dev`

`npm run dev` is for editing the code. It keeps every module graph it has
compiled so it can hot-swap them, and it never gives that memory back — which
is fine for an hour of editing and fatal for a day of running a shop. It does
not depend on how big the shop is. Measured on a 400-product store, 706 kB of
data, hitting four pages twenty-five times:

```
                        heap at start   after 25 rounds   RSS
  npm run dev              222 MB           570 MB       1066 -> 1530 MB
  npm run serve             56 MB            55 MB        182 ->  192 MB
```

Dev climbs about 14 MB a round and keeps climbing; a few hundred rounds is an
ordinary working day, and the default 4 GB heap is where that ends — "FATAL
ERROR: Ineffective mark-compacts near heap limit", after a request too small
to have caused it. The production server does not move: same pages, same data,
flat at 56 MB.

So: `npm run dev` while changing code, `npm run serve` to actually use the app.
After pulling changes, run `npm run serve` again — it rebuilds first.

## The catalog (core domain)

`catalog_products` (`src/server/catalog/`) is unique by `(market, sku)`,
**append-only**, and **multi-source with provenance** (`source` column):

- `kicksdb` (default): added only after a `GET /stockx/products` lookup
  returns a matching product (HTTP 200) — guaranteed fetchable, re-priced by
  TTL via the refresh feed.
- `goldensneakers`: registered automatically by every feed sync for SKUs
  KicksDB doesn't carry, so supplier-only products are first-class in the
  catalog (Publish, the product drawer). Refreshed by the feed's
  own sync; a later KicksDB verification wins the row (source flips), while
  feed syncs never overwrite a `kicksdb` row.
- `woo`: the **store mirror** — registered after every snapshot refresh (REST
  pull or file upload) for store products no feed covers, so the vendor sees
  the WHOLE inventory, not just feed-linked products. Provenance precedence
  is `kicksdb` > `goldensneakers` > `woo`: a woo row flips when KicksDB
  verifies the SKU or the GS feed starts covering it. A `woo` row is
  inventory only, **never a price source** — `getFreshBySkus`/`getAnyBySkus`
  exclude it, so preview/apply/rebuild behave exactly as if it weren't there.

Entries never leave. Every route feeds it: syncs, imports, previews, pulls.

Listing columns (`image`, `min_ask`, `variant_count`, `added_at`) are
denormalized from the stored product at upsert time, so lists such as
Publish filter/sort/paginate in SQL.

## Tabs

- **Dashboard** (`/`) — the homepage is the operator dashboard: catalog size
  split by price source, stale-price count with a one-click path to refresh,
  store snapshot state, last sync outcome, and a recent-activity feed
  (ingestion runs + apply runs merged). Big plain-language action cards deep-
  link into `/sync`, `/publish` and `/import`.
- **Product drawer** (`?product=<sku>` on any Hub page; full-screen sheet on
  mobile) — a catalog product's operator tools. Feed/StockX products get:
  per-size asks + computed proposed prices, **re-sync from KicksDB**,
  prominent per-size **manual price locks** (with lock-all / unlock-all), the
  per-product **sale rule**, and — when the GS feed covers the SKU — a
  **price-source switch** that pins the product back to StockX pricing (all
  via `store_overrides`, keyed by SKU/EU size — snapshot-independent, so the
  sync honors them automatically). Store-only products instead show the LIVE
  store view — per-size shelf price and real stock — **directly editable**:
  changes are written to WooCommerce immediately and mirrored into the
  snapshot. The Feeds tab's product list opens it, and so do the Publish
  tab's rows (lock sizes before publishing: the Publisher honours locks) and
  the Sync and Preview tabs' products ("Details"); an old `/catalog` link
  lands on the dashboard with its drawer open. Browsing the shop by category
  and brand belongs to the Vetrina (see
  [docs/vetrina-catalog.md](docs/vetrina-catalog.md)).
- **Sync** (`/sync`) — the main workflow: **align sizes, then patch prices**,
  all over REST:
  1. **Pull**: walk the Woo REST API (`products` incl. attributes + variations)
     into the active store snapshot (`source: "rest"`). Cursor-driven and
     resumable (`store_pull_runs` + staging), sized for thousands of products,
     with live progress and cancel.
  2. **Preview**: the plan engine (`buildPlan`) matches StockX variants to Woo
     variations GTIN-first then by EU size, prices them through the scoped
     rules, and shows the per-variant diff (update / create / noop / skip).
  3. **Apply** — two passes per product, dry-run first (live apply unlocks only
     after a dry run of the same selection + cleanup scope):
     - **Size cleanup** (default on): the sanitize engine plans REST
       operations — DELETE orphan/ghost/duplicate variations that don't align
       with `pa_taglia` (so Woo never shows them), rewrite survivors with the
       realigned `attribute_pa_taglia`, make zero-stock sizes carried by
       KicksDB available, and PUT the parent's realigned option list. Only
       previewed products are ever touched.
     - **Prices**: the selected `update` rows via
       `products/{id}/variations/batch` (a price aimed at a deleted duplicate
       is dropped — its surviving twin carries its own row).
     - **Missing sizes**: the selected `create` rows ("new" in the tab) — a
       size the source sells that the product on the store does not have,
       typically one the supplier listed after the product was published.
       Each is created exactly as Publish would create it (same SKU,
       `pa_taglia` label, price, stock, GTIN) and added to the parent's
       `pa_taglia` options; nothing is deleted or rewritten, the product is
       read live first so a size that appeared meanwhile is not created
       twice, and a sold-out feed size is not added. The dry run lists them.
     Every run lands in `apply_audit` (the history labels Publish and rebuild
     runs, which log there too); after a live run the stored snapshot is
     patched to the post-apply state, so the next preview reflects reality
     without a re-pull. The live apply runs in the background on the server
     (`src/server/sync/apply-job.ts`), one at a time, and the tab follows it
     with a progress bar: a whole-store apply writes for many minutes, and
     behind Cloudflare one request for all of it was cut after 100 seconds
     while the server went on writing. Reloading or closing the tab doesn't
     stop it; opening Sync again picks up its progress.

  **"Stato dello store" is dated by the last full read** (the daily pull or
  "Aggiorna dallo store"), not by the patches every write leaves in the copy.
  A pull keeps the products the Hub wrote while it was walking the store: it
  may have read them before the write, and putting the older copy back made
  the Hub's own write look like a price changed on WordPress.

  **Prices changed on WordPress are kept.** The Hub records every price the
  store takes from it — the sync, Publish, the rebuild — in the price ledger
  (`src/server/sync/ledger.ts`). A store price that differs from the Hub's
  last word was changed by someone else, in wp-admin or by another plugin, and
  no sync writes over it, the automatic ones included: the plan holds that
  size (a feed product's stock still syncs) and the tab lists it under
  "Prices changed on WordPress", with both prices. A person decides: **Keep**
  locks the store's price under its size, so from then on the Hub writes that
  one; **Use the Hub's price** hands the size back to the rules and writes the
  product's prices at once. The catalog drawer and the Vetrina's product sheet
  show the store's price on the size, with the same two answers, and the
  dock's Sync station counts them. A lock set or cleared in the Hub is the
  newer word and supersedes the edit.

  **Every live write reads the product again first** — the tab's apply, the
  automatic runs, the Vetrina's "Salva e pubblica", "Use the Hub's price" —
  because a plan can be overtaken before it is written: a size whose price
  moved since is kept and listed (unless the move was the Hub's own newer
  write, from the Vetrina say, which is simply left alone); a size put on sale
  since keeps its price while its product follows the sale rule and the size
  has no lock; a size a person just decided (a lock set in the Vetrina, a size
  handed back to the rules) is written all the same; a size whose lock was set,
  moved or cleared since the plan is not written at the plan's price. The tab
  says how many it left alone. The contract, race by race:
  [docs/vetrina-catalog.md §3](docs/vetrina-catalog.md#3-prices-one-engine-one-way-in).
- **Publish** (`/publish`) — the catalog→store direction. Every other write
  path works on products the store already has (the sync walks the snapshot:
  it adjusts their sizes and adds the ones they are missing), so a supplier
  feed's new products reached the catalog and stopped there — visible to the
  operator, invisible to customers. This lists exactly that delta — products
  the feed no longer carries are left out, Publish refuses them — and creates the
  selected products on WooCommerce: parent, canonical EU `pa_taglia` sizes,
  prices from the margin rules (manual locks winning) and real feed stock.
  **Photos go through a queue** (`src/server/woo/media.ts`, table
  `media_jobs`): WordPress downloads and resizes every photo inside the request
  that attaches it, which made it the slow half of a first import. A product
  is created **hidden (draft) and without photos**, and the queue attaches
  them in the background, one request per photo — main photo first, which
  puts the product on sale with it, then the gallery. Products still hidden go
  before galleries. A photo is never sent twice: each is filed under a name of
  its own, and after a lost answer the product is looked at before anything
  is resent. A photo the store refuses is tried once more, then left out (the
  next one becomes the main photo); a product with no usable photo stays
  hidden, listed under "Photos on their way" on the tab with a Retry — and
  stays out of the list of products to publish, pulls or not: it is on the
  store, waiting for a photo added in WooCommerce, not for a publish. The
  queue is worked by the scheduler (below) or `/api/cron/media`, pauses while
  a store pull runs, and an unreachable store makes it wait without spending
  any product's tries. Variations are planned by the **rebuild
  planner** run against an empty "before", so a published product is the same
  canonical shape a rebuild produces. Safety: nothing selected by default, a
  live run without a dry run of that exact selection asks for a confirmation
  first, and a **live SKU lookup immediately before every create** (never the
  snapshot) so a stale snapshot cannot mint a duplicate parent. "Select all"
  takes every product the filters match (not just the listed rows), and the
  run goes a batch at a time — the first of 6, each next one sized from the
  shop's measured pace to take ~45 s, well inside the 100 seconds Cloudflare
  waits (`src/lib/publish-batching.ts`) — shows the time left, can be stopped
  between batches, and asks before the page is left.
  A batch the proxy gives up on (524) is still finished by the server: its
  products stay selected, the run moves on, and publishing them again is
  safe — a SKU another request is still creating is refused, not duplicated. **Force reimport** additionally targets products the store
  already has — refreshing name/size list and recreating the variation set,
  and with "replace the images" queueing new photos in place of the old —
  and is the one destructive option, so it is opt-in, separately labelled,
  and armed only by a dry run of the exact selection. Products whose feed no longer covers them
  are refused: listing a delisted supplier product as sell-on-demand at a
  stale price is worse than not listing it.
  A catalog product with no EU size at all (a StockX bundle or raffle listing,
  S–XL apparel) cannot be created — the shop's sizes are EU `pa_taglia` — so
  it is not offered either: the tab names those apart, and "select all" never
  takes them.
- **Margins** (`/pricing`) — the granular margin admin: the scoped pricing
  rules edited in place, from the banded catch-all down to a single SKU. Rules
  are scoped by source, brand, **product family / sub-family** (the catalog's
  own tree), name, SKU or size range; each card reports how many products it
  really prices and what the engine charges at three sample asks. See
  [Scoped rules](#scoped-rules-a-family-a-category-or-a-brand-with-its-own-margin).
- **Automatic categories** (`/collections`) — Shopify's automated collections,
  on WooCommerce: a category gets a rule on the products' tags, brands,
  attributes, name, price, sale, stock or age, and holds exactly the products
  that meet it — they join when they start meeting it and leave when they stop,
  whoever put them there. The membership is written to the store as real
  categories, so the category page, the menus and the Vetrina rail that shows
  it all follow. A live preview names who joins and who leaves before saving;
  an automatic run never empties a category nor moves more than
  `COLLECTIONS_MAX_CHANGES` products at once without a confirmation; every
  product moved is logged. In the Vetrina, a rail's category can be made
  automatic from the phone, and a product's tags edited from its sheet move it
  at once. See [docs/smart-collections.md](docs/smart-collections.md).
- **Import** (`/import`) — manual textarea or CSV/TXT/TSV upload. SKUs are
  extracted, chunked, GET-verified and upserted through the same pipeline;
  each operator action is one `ingestion_runs` row (added / known / rejected).
- **Feeds** (`/feeds`) — the ingestion-source registry. Built-in feed:
  **KicksDB refresh**, which re-prices the stalest entries via the bulk
  endpoint (50 SKUs/call), merging fresh offers onto stored products. And
  **GoldenSneakers**: the supplier's flat assortment (API pull with bearer
  token + DRF pagination, or manual JSON upload), stored in `feed_items`
  with scs-b2b semantics — validate everything first, abort on empty,
  deactivate-never-delete. **Product-level ownership**: a SKU covered by the
  feed is *owned* by GoldenSneakers — its variant set, final prices
  (`presented_price`, VAT/markup applied upstream via the feed URL params —
  a source-scoped passthrough rule pipes it through the engine unchanged)
  and real stock quantities all come from the feed; KicksDB sizes are
  dropped by design. A manual per-product pin (`store_overrides`) can hand
  a product back to KicksDB. The catalog stays KicksDB-pure.
- *(hidden)* `/preview` — the legacy **file round-trip** flow (upload a Woo
  export, preview, download a patched re-import JSON with sanitize folded in).
  Fully functional, just unlinked — the fallback if REST must be reversed. It
  shares the same sanitize engine as the REST cleanup
  (`src/server/store-json/sanitize.ts`), so file and live cleanup can never
  disagree.

## Scheduled runs

**The app schedules itself.** In production (`next start`, Docker) an in-app
scheduler (`src/server/scheduler.ts`, started from `src/instrumentation.ts`)
runs four cadences:

- **The daily sync**, every day at `SCHEDULER_TIMES` (default `04:30`) in
  `SCHEDULER_TIMEZONE` (default `Europe/Rome`). In order:
  1. the **store pull** (the Hub's copy of every product on WooCommerce);
  2. the GoldenSneakers complete sync;
  3. a KicksDB re-pricing pass;
  4. with `AUTO_SYNC=on`, the **store sync** of the whole store, a few at a
     time, the feed's products left to the feed cycle (below);
  5. the **automatic categories**, against a full read of the store;
  6. self-repair (with `AUTO_REPAIR=on`), metadata backfill and
     recategorization.

  A failed step doesn't stop the others and is retried an hour later, twice
  at most. `SCHEDULER_TIMES=04:30,13:30` runs it twice a day.
- **The feed cycle**, every `SCHEDULER_FEEDS_MINUTES` on the clock (`15` runs
  at :00, :15, :30 and :45). It is on by default, every 15 minutes, when the
  GoldenSneakers API is set (`GS_FEED_URL` and `GS_FEED_TOKEN`); `0` turns it
  off. It runs the GoldenSneakers sync, then the store sync of the feed's
  products (unless `AUTO_SYNC=off`), so the store follows the feed within a
  quarter of an hour. KicksDB-priced products wait for the daily sync,
  because planning them asks KicksDB about every one of them, every time. A
  cycle skips its turn while another run is going, and the daily sync waits
  for a cycle to finish. While a store pull is running (from the Sync tab, say)
  the cycle syncs the feed but leaves the store for the next one.
- **The orders pull**, every `SCHEDULER_ORDERS_MINUTES` (default 15; `0` =
  by hand only): the latest orders reach the Orders tab without a click.
- **The photo queue**, whenever something is due (looked at every minute,
  two products at a time): the photos of the products the Publisher created
  hidden (see Publish above). It pauses while a store pull runs, because a
  product put on sale as the pull assembles its copy of the store would be
  left out of it.
- **The automatic categories' check**, every `SCHEDULER_COLLECTIONS_MINUTES`
  (default 5; `0` = only in the daily sync): one light request asks the store
  what changed, then every automatic category takes in or lets go of the
  products its rule now says. The daily sync re-reads the whole store for
  them. The check runs even while no category is automatic: the store index
  it keeps is also what the Vetrina's catalog lists. It then only reads;
  nothing is written to the store.

**The store sync** does unattended what the Sync tab does with "apply all":
it plans the price and stock changes the sources call for and writes them to
WooCommerce. `AUTO_SYNC` decides where it runs:
- unset (the default): in the feed cycle, for the feed's products only. The
  feed owns them, and keeping the store in step with it is the cycle's job.
  The daily sync writes nothing;
- `AUTO_SYNC=on`: in the daily sync too, for the whole store (KicksDB prices
  and missing sizes included). While the feed cycle runs, the daily sync
  leaves the feed's products to it: the two never write the same product;
- `AUTO_SYNC=off`: nowhere. Every change is applied by hand in the Sync tab.

It is narrower than the tab on purpose:
- It writes **prices and stock, and the sizes a product is missing** (added,
  never removed): no size cleanup (which deletes variations) and no GTINs.
  The feed cycle adds the sizes of the feed's products that are in stock in
  the feed. The daily sync of `AUTO_SYNC=on` adds every missing size, as the
  Sync tab does, KicksDB-priced ones included: a size StockX started listing
  after the product was published, created as Publish creates every size it
  lists and sold on demand like the product's other sizes.
- A feed cycle that would change more than `AUTO_SYNC_MAX_CHANGES` variations
  (default 500) writes nothing. The Feeds tab shows the reason, and the change
  is reviewed and applied by hand in the Sync tab. In a quarter of an hour, a
  change that large is a new price list or a broken feed.
- The daily sync writes at most `AUTO_SYNC_STORE_MAX_CHANGES` variations a
  run (default: `AUTO_SYNC_MAX_CHANGES`), whole products, and leaves the rest
  for the next run; the Feeds tab shows how many are waiting. It used to
  write nothing past its limit, like the cycle — but a whole store's KicksDB
  prices move by thousands of sizes from one day to the next, and what a run
  refused was still there the next day, with that day's on top: past the
  limit once, the store was never synced again. Size it to what the prices
  move between two runs, or run the daily sync more often
  (`SCHEDULER_TIMES=04:30,12:30,20:30`).
- Manual price locks are honored, as in the tab.
- **A price changed on the store is never written over.** The plan keeps the
  ones the snapshot already shows; and since the snapshot is up to a day old
  between two pulls, each product is read again right before its write, which
  keeps the ones changed since — and refreshes the product's copy in the
  snapshot from the store's answer. Both wait in the Sync tab's list of prices
  changed on WordPress.
- Every automatic write appears in the Sync tab's history.

Other edits made directly in WooCommerce are seen at the next store pull,
which the daily sync runs.

The daily run also trims the run logs the cycles leave behind: stepped syncs
older than a week, ingestion runs and apply records older than 90 days.

Every run is recorded in the `scheduler_runs` table (feed cycles for a
week), so a restart knows where it stands. A daily slot that was missed while
the server was down, or whose run failed, runs a minute after the next boot.
A deploy after a good run starts nothing. The Feeds tab shows the cadences,
the last runs, whether the store is synced automatically, and any error.

**Be told when it doesn't run.** Set `SCHEDULER_HEARTBEAT_URL` to a
dead-man's-switch check (for example a free healthchecks.io check with a
1-day period and a few hours' grace). Each fully successful daily run calls
that URL. If the calls stop, because a run failed or the server is down, the
service alerts you. `SCHEDULER_FEEDS_HEARTBEAT_URL` does the same for the
feed cycle. Give that check a period matching the cycle, e.g. 15 minutes with
an hour's grace.

`SCHEDULER=on|off` overrides the default (on in production, off in dev). The
scheduler needs a long-running server — `next start`, Docker, a VPS — not a
serverless platform that freezes the process between requests. Run a
single instance, or every sync runs once per instance.

If you'd rather drive syncs from an external scheduler (crontab, systemd
timer, an uptime service), set `SCHEDULER=off` and `CRON_SECRET`, then hit
the authenticated endpoints:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://host/api/cron/pull-store           # full Woo pull
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://host/api/cron/refresh-catalog      # re-price stale entries (KicksDB)
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://host/api/cron/sync-goldensneakers  # GS complete sync
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://host/api/cron/media                # photo queue, up to 4 min
```

`scripts/trigger-cron.sh` wraps the curl with retries and timeouts, e.g. a
crontab line:

```
30 4 * * *  APP_BASE_URL=https://host CRON_SECRET=... /path/to/scripts/trigger-cron.sh sync-goldensneakers
```

## Programmatic API

`/api/v1/*`, with `Authorization: Bearer $HUB_API_TOKEN`: every action the
Vetrina can do, on products and on the homepage — described for a script or
an assistant (`/actions`), asked as **proposals** the owner confirms (the
action runs only if the shop still gives the preview they saw, and only
once), logged and undoable like the Vetrina's own — and the reads they start
from (the homepage, the products, the log). Order sources (a ranking from
elsewhere, e.g. an LLM's reading of a reference shop's page, used with
"Usa l'ordine di «…»": [docs/order-sources.md](docs/order-sources.md)) too.
See [docs/api.md](docs/api.md), and [docs/operations.md](docs/operations.md)
for how actions, the log and proposals fit — the ground for an assistant.

```bash
curl -H "Authorization: Bearer $HUB_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"id":12,"skus":["DD1391-100"],"position":"top","dryRun":true}' https://host/api/v1/catalog/order
```

## Core

- `core/core-spine.ts`, `core/config.ts` — domain model, pricing engine
  (`computePrice`/`resolveEffectiveRule`), plan/diff (`buildPlan`), the
  `SourcePort` seam, and the `WooStoreAdapter` skeleton behind the REST apply.
- `src/server/woo/` — the live Woo REST client, the resumable pull, the
  audited apply.
- `src/server/store-json/` — the store-state model (one shape, two transports:
  REST pull or file upload), EU-size matching, and the file-export patch path.

## Pricing config

KicksDB returns **raw lowest asks** — every markup is applied by this app
(`computePrice`: ask → markup → floor → optional VAT → rounding). The default
rule (`src/server/config/defaults.ts`) uses a **dynamic, price-banded markup**
on the raw ask: ≤150€ → 35%, ≤300€ → 30%, ≤500€ → 25%, above → 19%, with
charm `.99` rounding. The band is the **total shelf uplift**: VAT is
considered included in the resulting price, never stacked on top (€100 ask →
€135.99, not €135 × 1.22). Setting a VAT rate in the pricing editor
re-enables the add-on-top behaviour explicitly. Band selection happens on the
ask, so the retail price never shifts its own band.

The **Pricing** bar (on `/sync` and `/preview`) shows the live bands and the
store-wide **Reprice discounted** switch, and hosts the editor: saving a flat
markup there switches banding off; **Reset** restores the banded defaults
(scoped rules you created are kept — only the default rule goes back to
factory). After upgrading an existing DB, press **Reset** once — the stored
config row still carries the old flat rule. Precedence for any variant price:
**manual lock > sale rule > computed price**.

### Scoped rules: a family, a category or a brand with its own margin

The banded default is only the **catch-all**. The **Margins** tab (`/pricing`)
edits the whole rule list, and any rule can carve out a slice of the catalog —
by source, brand, **family / sub-family**, name, SKU or size range. The family
axes are the catalog's own navigation tree, so the shop's
`/marchio/yeezy/yeezy-foam/` is the rule scope `category: "Yeezy"`,
`secondaryCategory: "Foam RNNR"`, picked from a dropdown of what the catalog
actually holds. Feed and store-only rows get those axes from the title
classifier (`src/server/catalog/classify.ts`), so a family rule covers them
too, not just KicksDB rows.

A rule can also be scoped to one of the **shop's own categories or brands**
(`storeCategory` / `storeBrand`: a WooCommerce term **id**, never a slug, its
sub-terms included; `storeTermName` keeps the term's path as a label only) —
the Vetrina's "Ricarico" on a category or a brand, or "+ Margine per
categoria o brand del negozio" here. It applies to KicksDB-priced products
only: never to a GoldenSneakers price (the supplier's margin is already in it)
nor to a store-only product. Products get their store terms from the store
index right before every price is computed — a product being published, from
the categories and brand it is filed under — and a product the Vetrina moves
into or out of a category with a margin is repriced right after. When the
terms cannot be read, the sync holds the prices they could change rather than
write the general one.

Two properties make the list predictable:

- **The narrowest rule wins, not the one with the most fields.** For any
  size, the full order is: **manual lock > sale price held** (the product
  follows the sale rule) **> SKU rule > store category or brand rule** (the
  deeper term first — a sub-category beats its category, and a category and a
  brand meet by depth in their own trees — then the later rule in the list)
  **> every other rule** (source, brand, family, name, sizes). Among those
  other rules, scopes are weighted by how few products they describe (`sku` ⊂
  `secondaryCategory` / `model` ⊂ `category` ⊂ `brand` ⊂ `source`), and on a
  tie the later rule in the list wins. Text matching is case-insensitive.
- **One rule owns the margin.** The most specific rule that states a margin
  replaces *all three* mechanisms — percent, bands and fixed € — inherited
  from broader rules. Everything that is not the margin (rounding, VAT,
  floors, delta guards, the minimum-margin and anomaly nets) still merges
  field by field, so a family rule that only changes the markup keeps every
  house safety net. Before this, a specific percent rule left the general
  bands in place and, since their top band is unbounded, silently never
  applied.

Each rule card reports **how many catalog products it actually prices** and
the shelf price the engine returns at three sample asks — a rule that covers
nothing, or that a narrower rule outranks, says so instead of looking healthy.
The product drawer names the rule behind its proposed prices.

The list has more than one editor (this tab, the pricing bar, the Vetrina):
every save is a locked read-modify-write, and this tab refuses to save over a
list that changed since it was opened — reload, then edit.

**The Vetrina's catalog.** The owner browses the shop by its own categories
and brands on the phone (the Vetrina's Catalogo tab) and acts on one product
or many — hide and show (a whole category or brand too, its products hidden
everywhere, newcomers included, and "Mostra" restoring exactly), sales,
tags, categories, homepage pins, a category's or brand's margin — each with a
preview, a background run and "Annulla". Its price actions never write a
regular price: a sale is the sale price only, and a margin is a store-term
rule in this list, applied by the engine. The design, the decisions and the
price contract with the engine: [docs/vetrina-catalog.md](docs/vetrina-catalog.md).

**Rolling back** past the store-term rules: an older engine ignores their
scope keys and would apply them to every product, supplier prices included.
Disable or delete every rule with `storeCategory` / `storeBrand` first (see
[docs/vetrina-customer-hub.md §8.2](docs/vetrina-customer-hub.md)).

**Anti-churn threshold** (`minDeltaPercent`, default 3%): a price drift of at
most this percent stays a `noop` in the plan — tiny ask movements never turn
into store writes, so re-runs stop churning near-identical prices. Editable in
the pricing bar ("Min change %"); 0 = always reprice. Manual locks are exempt:
a locked price is applied exactly.

## Caching

Two independent best-effort layers (an outage degrades to a live fetch, never a
hard failure): the Redis TTL cache (`src/server/cache/`) for query results, and
the persistent catalog itself — the smart cache in front of every SKU lookup.

## Scripts

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint; any warning fails it (as in CI)
npm test              # vitest (pricing/plan/match/patch core)
npm run test:e2e      # Playwright on the demo shop, after `npm run build`; needs a local
                      # Postgres (E2E_DATABASE_URL, its name containing "e2e": dropped and made fresh)
npm run guard:tanstack
npm run db:generate   # drizzle migration from schema
npm run build
```
