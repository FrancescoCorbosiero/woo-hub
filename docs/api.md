# Programmatic API (`/api/v1`)

The Vetrina's actions for a script, another service or an assistant: the
same code the Vetrina's screens run (`src/server/vetrina/operations/`), with
the same preview, the same log and the same "Annulla". How the pieces fit —
actions, the log, proposals — is in [operations.md](operations.md).

- **Reads**: the homepage (`/homepage`), the products (`/catalog/products`),
  the categories and brands (`/catalog/terms`), a term's order on the shop
  (`/catalog/order`), the site's navigation menus and pages (`/menus`,
  `/pages`), the log (`/operations`).
- **Every action, described**: `/actions` — the catalog's on products (hide,
  sale, tags, categories, a place on the homepage, a margin, the shop's
  order, delete…), the homepage's on its sections and blocks, the menus' on
  their items ([menus.md](menus.md)), and the taxonomy's on the store's
  categories, brands and tags ([taxonomy.md](taxonomy.md)).
- **Proposals**, the safe way to act: `/proposals` previews an action and
  keeps it; `/proposals/{id}/confirm` runs it, only if the shop still gives
  that preview, only once, and only on a person's word ([tokens](#tokens)).
- **Shortcuts** that act in one call (they predate proposals): placing
  products in a term's order (`POST /catalog/order`) and using an order
  source (`POST /order-sources/{id}/apply`, [order-sources.md](order-sources.md)) —
  in one call for a caller with `admin`; for any other they make the
  proposal instead.
- **Undo**: `/operations/{id}/undo`, for any action in the log.

## Setup

1. Make a token for each caller and list them in the Hub's `.env`
   (`deploy/.env` on the server), each with what it may do ([tokens](#tokens)):

   ```sh
   echo "HUB_API_TOKENS=assistant:$(openssl rand -hex 32):read+propose,phone:$(openssl rand -hex 32):read+confirm+undo" >> deploy/.env
   ```

   `HUB_API_TOKEN`, the single token from before, keeps working: it is the
   caller `legacy`, with every scope. With neither set, the API answers `503`
   to every call; a wrong list stops the app at boot, saying which entry and
   why.
2. To call it from outside the server, let `^/api/v1/` through Authelia on the
   Hub's address, as for `/api/cron/` ([auth.md](auth.md#programmatic-api)).
   The app checks the token whatever Authelia does. On the Vetrina's address
   the API does not exist (`404`).
3. Restart the app.

Every call carries a token:

```sh
export HUB=https://hub.example.com HUB_API_TOKEN=...
curl -H "Authorization: Bearer $HUB_API_TOKEN" "$HUB/api/v1/catalog/terms"
```

Answers are JSON: `{ "ok": true, "data": … }`, or
`{ "ok": false, "code": "invalid" | "not_found" | "stale" | "unauthorized" | "forbidden" | "not_configured" | "failed", "error": "…" }`
with a matching HTTP status (400, 404, 409, 401, 403, 503, 500) — and `data` when
the refusal has something to go on with (a confirmation over a shop that
changed: the new proposal). The words inside
(labels, previews, refusals) are Italian; send `Accept-Language: en` for
English.

## Tokens

Every token is a caller with a name — the log files it as who asked,
`token:<name>` — and the scopes it may use:

| Scope | Opens |
|---|---|
| `read` | every read, `/actions`, a proposal (`GET`), a shortcut's `dryRun` preview |
| `propose` | `POST /proposals`; the shortcuts, as proposals; uploading an order source |
| `confirm` | `POST /proposals/{id}/confirm` |
| `undo` | `POST /operations/{id}/undo` |
| `admin` | the shortcuts in one call; deleting an order source |

`HUB_API_TOKENS` is `name:token:scopes`, entries apart by commas, scopes
joined by `+`: names of letters, digits, `.`, `_`, `-`; tokens of 24
characters or more, one per caller. A call without the scope its endpoint
needs answers `403` (`forbidden`), saying what it needs and what the token
has (`src/lib/actors.ts`, `src/server/api/v1.ts`).

**`confirm` is a person's.** A proposal's yes is the owner's: give `confirm`
only to a token a person keeps — the phone client they confirm from, their
own script — never to the program that proposes. `HUB_API_TOKEN` has every
scope, `confirm` included: a program holding it could say yes to its own
proposals, so an assistant never gets it. An assistant gets a token of its own,
`read+propose`: its confirm is refused (`403`), and so is a `confirm` passed
to the server's own function by anything that is not a person
(`confirmProposal`, `operations/proposals.ts`). The log says who did what:
a proposal's `actor` (who proposed) and `confirmedBy` (who decided it), an
action's `actor` (who started it — for a proposal's, who confirmed) and
`undoneBy`. On the screens, the person signed in is the actor of what they
do there: Authelia's `Remote-User`, which never reaches `/api/v1`.

## How the shop's order works

WooCommerce sorts a category's or brand's page by `menu_order` ascending, then
by name, when **WooCommerce › Settings › Products › Default product sorting**
is "Custom ordering + name" (`menu_order`). `GET /catalog/order` says which
sorting the store uses (`storefrontSort`); with another one the order is
saved but the pages do not follow it.

`menu_order` is **one number per product**, shared by every category and brand
the product is in. Placing products writes as few numbers as it can (moving
one product usually writes one), so the other categories keep their order but
for the products moved — which move there the same way. The storefront also
puts a homepage section's pinned products first on its category's page, and
sold-out products last.

## Endpoints

### `GET /api/v1/homepage`

The homepage, top to bottom. Each product section (`kind: "section"`) with
its `key` (what the actions take), `position`, `title`, `eyebrow`, what it
`shows` (`{taxonomy, slug, name}`, `{list}`, or null for a fixed list or
tags), whether an automatic rule fills its category, `switchedOff`, `limit`,
`fallback` (the automatic order after the pinned ones), `pinned` and
`hidden` product ids, and the first `products` the site shows. The other
blocks (`kind: "block"`) with their `path`, `name` and the `fields` the
owner may edit. `powers` says what the sections themselves may do on this
site (`source`, `add`, `move`, `remove`, `switchOff`, the `lists`).

### `GET /api/v1/catalog/products?q=dunk&taxonomy=brand&termId=7&onSale=true&offset=0&limit=40`

The products a catalog query matches, a page at a time (`limit` up to 100):
`id`, `sku`, `name`, `price`, `onSale`, `stockStatus`, `visibility`,
`status`, `source` (where it comes from: `goldensneakers` — the supplier's
feed carries it, and a delete refuses it — `kicksdb`, `delisted` — the feed
dropped it — or `woo`, made in the shop), their categories, brands and tags
by name, and the homepage `sections` showing them (key, title, place,
pinned). The query is the one an action's `target: { "kind": "query",
"query": … }` takes: `taxonomy` + `termId` (a category's or brand's
products, sub-terms' included), `view` (`soldout`, `onsale`, `hidden`,
`nophoto`, `nocategory`, `unpublished`), `q` (name or SKU), `stock`,
`visibility`, `onSale`, `within` (a term of the other taxonomy), `source`,
`sort`. The hidden products a delete may take:
`?view=hidden&source=kicksdb`. A delete on a query acts on what it matches
when the action is filed, not when its turn comes.

### `GET /api/v1/catalog/terms?taxonomy=category|brand|tag`

Every category (default), brand or tag: `id`, `name`, `slug`, `parent` (0 at
the top; always 0 for a tag), `path` ("Saldi › Nike"), `count` (its products,
sub-terms' included; a tag's as the store counts them).

### The store's taxonomies

`termCreate`, `termRename`, `termMove`, `termMerge` and `termDelete` (scope
`taxonomy`; `GET /actions` describes each) make, rename, move, merge and
delete the store's categories, brands and tags, proposed and confirmed like
any other action. The first three are done at once; a merge and a deletion
move the term's products one by one in the background (follow them at
`/operations/{id}`). A rename keeps the term's slug; a renamed, moved or
merged category or brand leaves its old name as an alias for Publish. See
[taxonomy.md](taxonomy.md).

```json
{ "action": { "kind": "termMerge", "taxonomy": "category", "termId": 45, "into": 12 } }
```

### `GET /api/v1/catalog/order?taxonomy=category&id=12&offset=0&limit=100`

The term's products (sub-terms' included, every status but the bin) in the
shop's order, a page at a time (`limit` up to 1000).

```json
{
  "ok": true,
  "data": {
    "term": { "taxonomy": "category", "id": 12, "name": "Sneakers" },
    "total": 1495,
    "offset": 0,
    "storefrontSort": "menu_order",
    "products": [
      { "position": 1, "id": 4810, "sku": "DD1391-100", "name": "Nike Dunk Low Panda",
        "menuOrder": -10, "stockStatus": "instock", "visibility": "visible", "status": "publish" }
    ]
  }
}
```

It reads the Hub's copy of the store (the store index, kept fresh every few
minutes and by every write the Hub makes).

### `POST /api/v1/catalog/order`

Place products, in the order given, in a term's order.

| Field | | |
|---|---|---|
| `taxonomy` | `"category"` (default) or `"brand"` | |
| `id` | the term's id | required |
| `ids` | product ids, in the order wanted | `ids` and/or `skus` |
| `skus` | SKUs, in the order wanted (after `ids`) | an unknown SKU is refused |
| `position` | `"top"` (default), `"bottom"`, or a 1-based place among the term's other products | |
| `dryRun` | `true`: only the preview, nothing written | |

Products not in the term are left out (the preview counts them). At most
2,000 products per call.

```sh
# What would happen?
curl -H "Authorization: Bearer $HUB_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"id":12,"skus":["DD1391-100","FD6475-001"],"position":"top","dryRun":true}' \
  "$HUB/api/v1/catalog/order"
```

```json
{ "ok": true, "data": { "dryRun": true, "preview": {
  "kind": "order", "changes": 2,
  "sample": [ { "id": 4810, "name": "Nike Dunk Low Panda", "before": "#37", "after": "#1" } ],
  "untouched": [],
  "warnings": ["L'ordine del negozio è uno per prodotto: 2 sono anche in Nike, e lì cambiano posto con lo stesso criterio."]
} } }
```

Without `dryRun`, a caller with `admin` starts the action, and it runs in the
background: `202` with the operation, which shows in the Vetrina's
"Attività" like one started there. Any other caller (with `propose`) gets the
action as a proposal: `201` with `{ "dryRun": false, "proposal": … }`, to
confirm like any other ([proposals](#post-apiv1proposals)) — nothing moves
until a person says yes. Already in that order answers `400` ("Sono già in
quest'ordine.").

```json
{ "ok": true, "data": { "dryRun": false, "operation": {
  "id": "3376e826-…", "kind": "order", "label": "2 prodotti in cima · Sneakers",
  "status": "running", "progress": { "done": 0, "total": 2 }, "changed": 0, "failed": 0, …
} } }
```

To set a whole order (say the first 50 products from your own ranking), send
those products with `"position": "top"`: everything after them keeps its
order, and only the products whose number must change are written.

### Order sources

`GET`/`POST /api/v1/order-sources`, `GET`/`DELETE /api/v1/order-sources/{id}`,
`POST /api/v1/order-sources/{id}/apply`: uploading a ranking (the agreed
format, an LLM's answer as it came, a CSV…) and using it on a category, a
brand or the whole catalog. And another shop's list compared with the shop:
`GET /api/v1/order-sources/{id}/compare` (its prices against the shop's,
beyond 2%; what the shop lacks; what is uncertain), `POST …/pairs` (an item
paired by hand), `POST …/prices` (the `priceMatch` action: preview, start or
proposal), `GET …/candidates` (one item's closest products), `POST …/lookup`
(KicksDB's products for items with no code) and
`POST …/import` (the missing ones published, `admin`). See
[order-sources.md](order-sources.md#the-api).

### Navigation menus

The site's menus need WordPress's own API, signed in with an Application
Password (`WP_APP_USER`, `WP_APP_PASSWORD`; [menus.md](menus.md#setup)):
without it these answer `503 not_configured`.

`GET /api/v1/menus` — every menu: `id`, `name`, `slug`, `locations` (the
theme's places showing it, `{slug, name}`; none: not on the site), `count`
(its items).

`GET /api/v1/menus/{id}` — the menu, its items top to bottom:

```json
{ "ok": true, "data": {
  "id": 2, "name": "Menu principale", "slug": "menu-principale", "count": 8,
  "locations": [{ "slug": "primary", "name": "Menu principale" }],
  "digest": "9f2c…",
  "items": [
    { "id": 13, "parent": 0, "depth": 0, "position": 3, "title": "Brand", "label": "Brand",
      "target": { "kind": "link", "url": "#" }, "url": "#", "invalid": false },
    { "id": 14, "parent": 13, "depth": 1, "position": 1, "title": "Nike", "label": null,
      "target": { "kind": "brand", "id": 201 }, "url": "https://…/brand/nike/", "invalid": false }
  ]
} }
```

`position` is the item's 1-based place among the items under the same
`parent` (0: the top level) — what an action's `place` takes. `label` is
null when the item shows its category's, brand's or page's own name.
`target.kind` is `category`, `brand`, `page`, `link`, or `other` (something
else WordPress links to, with its `type`, `object` and `id`).

`GET /api/v1/pages` — the site's published pages (`id`, `title`, `parent`,
`url`), for an item that leads to one.

`GET /api/v1/menus/check` — is this WordPress ready for the menus: the
access, the menus, the places, the items, the pages, the batch endpoint,
step by step (`{ ok, site, steps: [{ step, ok, detail, ms }] }`), read-only.
`POST` with `{ "write": true }` (`admin`) adds a round trip of writes on a
menu of its own, deleted in the end ([menus.md](menus.md#checking-a-live-site)).

`GET /api/v1/menu-locations` — the theme's places for a menu: `slug` (what
`menuLocation` takes), `name`, and the `menu` each shows (`{ id, name }`, or
null). None at all: a block theme, whose navigation is not these menus.

The actions on items are `menuItemAdd`, `menuItemMove`, `menuItemRemove` and
`menuItemRename`; on whole menus `menuCreate` (empty, or `copyOf` a menu),
`menuRename`, `menuDelete` (refused while a place shows the menu) and
`menuLocation` (`{ location, menuId }`, null for none). `GET /actions`
describes each; they are proposed and confirmed like any other, and written
at once on the yes. Send the menu's `digest` back as `expected` — refused
(`409 stale`) if the menu changed since you read it:

```json
{ "action": { "kind": "menuItemAdd", "menuId": 2, "items": [{ "kind": "category", "id": 12 }, { "kind": "link", "url": "/saldi", "label": "Saldi" }],
              "place": { "parent": 13, "position": 1 }, "expected": { "digest": "9f2c…" } } }
```

The proposal keeps the menu's fingerprint in its preview: a menu changed
before the confirmation makes a new proposal (`409`, as for any action).

### `GET /api/v1/actions`

Every action the Vetrina can do: `kind`, `scope` (`catalog`, `homepage`, `menu` or `taxonomy`),
`title`, `description` (what it does, what to know before asking it),
`undo` (how its "Annulla" works), a valid `example`, and its `input` as JSON
Schema (draft 2020-12) — made from the very schema the server checks
(`src/server/vetrina/operations/registry.ts`). An assistant's tools are these.

### `POST /api/v1/proposals`

```sh
curl -H "Authorization: Bearer $HUB_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":{"kind":"sale","target":{"kind":"query","query":{"taxonomy":"brand","termId":7}},"percent":20,"rounding":"charm","endsOn":null}}' \
  "$HUB/api/v1/proposals"
```

The action is checked and previewed on the shop as it is; nothing is
written. `201` with the proposal:

```json
{ "ok": true, "data": {
  "id": "5b1d…", "kind": "sale", "status": "open", "via": "api", "actor": "token:assistant", "confirmedBy": null,
  "label": "Saldo −20% · 34 prodotti",
  "summary": ["Saldo −20% · 34 prodotti", "Cambia 34 prodotti.", "Restano come sono: 2 già in saldo.",
              "Nike Dunk Low Panda: 129,00 € → 102,99 €", "…"],
  "preview": { "kind": "sale", "changes": 34, "untouched": […], "sample": […], "warnings": […] },
  "expiresAt": "…", "operationId": null, "replacedBy": null
} }
```

`summary` is the preview in sentences, for a reader without the screens:
show it to the owner before confirming. An action that could not run is
refused here, with why (`400`). A homepage action may carry `expected`
(`{ modifiedGmt, attrsHash }` from `/homepage`), a menu action
`{ digest }` from `/menus/{id}`: refused if the page or the menu changed
since you read it.

### `GET /api/v1/proposals/{id}`

The proposal: `status` is `open`, `confirming`, `confirmed` (with its
`operationId`), `changed` (with `replacedBy`), `refused`, or `expired` (15
minutes after it was made).

### `POST /api/v1/proposals/{id}/confirm`

The owner's yes — with `confirm`, a person's token ([tokens](#tokens)): the
token that proposed, a program's, gets `403`. The preview is made again: if
the shop still gives the same one, the action runs, filed as the
confirmer's — `202` with `{ "operation": … }`, the action as
the log has it (follow it at `/operations/{id}`; a homepage or menu action is
done at once). Confirmed again, it answers the same action: a retry never runs it
twice.

If the shop changed since (a price, a product, a section moved), nothing
runs: `409`, `code: "stale"`, and the new proposal in `data.proposal` —
show its summary and confirm that one instead. If the action can no longer
be done as asked, `409` with why (the proposal is `refused`); past its 15
minutes, `410`.

### `GET /api/v1/operations?limit=20`

The log, newest first (up to 100): every action, the catalog's, the
homepage's and the menus', with how it came (`via`: `app`, `api`, `assistant`,
`scheduler`), how it went, and whether it can still be undone.

### `GET /api/v1/operations/{id}`

The action as the log has it: `status` (`running`, `done`, `failed`,
`undoing`, `undone`), `via`, `actor` (who started it), `progress`,
`changed`, `failed` (refused by the store), `error`, `undoable`, and after
an undo `undo: { restored, kept, failed }` and `undoneBy`.

### `POST /api/v1/operations/{id}/undo`

"Annulla", for 7 days, with `undo`. An action on products: each value goes back where
the store still shows the value the action wrote (one changed since stays,
and is counted as `kept`) — `202`, then follow it with
`GET /operations/{id}`; refused (`409`) while the action still runs. A
homepage action: its way back is written at once, while the section is as
the action left it (found by its fingerprint wherever it is now) — refused
(`409`) when it changed since, since the newer change stands. A menu
action: the same, item by item (found by id and neighbour).

## A script

It starts the order in one call, so its token has `admin` (`HUB_API_TOKEN`
has every scope); without it, the call answers a proposal to confirm.

```sh
#!/bin/sh
# Put these SKUs at the top of "Sneakers", in this order, and wait for it.
set -eu
auth="Authorization: Bearer $HUB_API_TOKEN"
id=$(curl -fsS -H "$auth" -H "Content-Type: application/json" \
  -d '{"id":12,"skus":["DD1391-100","FD6475-001","IE3437"],"position":"top"}' \
  "$HUB/api/v1/catalog/order" | jq -r .data.operation.id)
until [ "$(curl -fsS -H "$auth" "$HUB/api/v1/operations/$id" | jq -r .data.status)" != running ]; do sleep 2; done
curl -fsS -H "$auth" "$HUB/api/v1/operations/$id" | jq .data
```

The code: the routes in `src/app/api/v1/`, each saying the scope it needs;
the callers and their scopes in `src/lib/actors.ts`; the token check and the
answers in `src/server/api/v1.ts`; the reads in `src/server/api/reads.ts`, the order in
`src/server/api/catalog-order.ts` over `src/server/vetrina/operations/order.ts`,
the actions' registry and proposals in `src/server/vetrina/operations/`
(`registry.ts`, `proposals.ts`).
