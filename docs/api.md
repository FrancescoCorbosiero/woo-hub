# Programmatic API (`/api/v1`)

The Vetrina's actions for a script, another service or an assistant: the
same code the Vetrina's screens run (`src/server/vetrina/operations/`), with
the same preview, the same log and the same "Annulla". How the pieces fit —
actions, the log, proposals — is in [operations.md](operations.md).

- **Reads**: the homepage (`/homepage`), the products (`/catalog/products`),
  the categories and brands (`/catalog/terms`), a term's order on the shop
  (`/catalog/order`), the log (`/operations`).
- **Every action, described**: `/actions` — the catalog's on products (hide,
  sale, tags, categories, a place on the homepage, a margin, the shop's
  order, delete…) and the homepage's on its sections and blocks.
- **Proposals**, the safe way to act: `/proposals` previews an action and
  keeps it; `/proposals/{id}/confirm` runs it, only if the shop still gives
  that preview, and only once.
- **Shortcuts** that act in one call (they predate proposals): placing
  products in a term's order (`POST /catalog/order`) and using an order
  source (`POST /order-sources/{id}/apply`, [order-sources.md](order-sources.md)).
- **Undo**: `/operations/{id}/undo`, for any action in the log.

## Setup

1. Make a token and put it in the Hub's `.env` (`deploy/.env` on the server):

   ```sh
   echo "HUB_API_TOKEN=$(openssl rand -hex 32)" >> deploy/.env
   ```

   Unset, the API answers `503` to every call.
2. To call it from outside the server, let `^/api/v1/` through Authelia on the
   Hub's address, as for `/api/cron/` ([auth.md](auth.md#programmatic-api)).
   The app checks the token whatever Authelia does. On the Vetrina's address
   the API does not exist (`404`).
3. Restart the app.

Every call carries the token:

```sh
export HUB=https://hub.example.com HUB_API_TOKEN=...
curl -H "Authorization: Bearer $HUB_API_TOKEN" "$HUB/api/v1/catalog/terms"
```

Answers are JSON: `{ "ok": true, "data": … }`, or
`{ "ok": false, "code": "invalid" | "not_found" | "stale" | "unauthorized" | "not_configured" | "failed", "error": "…" }`
with a matching HTTP status (400, 404, 409, 401, 503, 500) — and `data` when
the refusal has something to go on with (a confirmation over a shop that
changed: the new proposal). The words inside
(labels, previews, refusals) are Italian; send `Accept-Language: en` for
English.

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
`status`, their categories, brands and tags by name, and the homepage
`sections` showing them (key, title, place, pinned). The query is the one
an action's `target: { "kind": "query", "query": … }` takes: `taxonomy` +
`termId` (a category's or brand's products, sub-terms' included), `view`
(`soldout`, `onsale`, `hidden`, `nophoto`, `nocategory`, `unpublished`), `q`
(name or SKU), `stock`, `visibility`, `onSale`, `within` (a term of the
other taxonomy), `sort`.

### `GET /api/v1/catalog/terms?taxonomy=category|brand`

Every category (default) or brand: `id`, `name`, `slug`, `parent` (0 at the
top), `path` ("Saldi › Nike"), `count` (its products, sub-terms' included).

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

Without `dryRun` the action starts and runs in the background: `202` with the
operation, which shows in the Vetrina's "Attività" like one started there.
Already in that order answers `400` ("Sono già in quest'ordine.").

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
brand or the whole catalog. See [order-sources.md](order-sources.md#the-api).

### `GET /api/v1/actions`

Every action the Vetrina can do: `kind`, `scope` (`catalog` or `homepage`),
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
  "id": "5b1d…", "kind": "sale", "status": "open", "via": "api",
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
(`{ modifiedGmt, attrsHash }` from `/homepage`): refused if the page changed
since you read it.

### `GET /api/v1/proposals/{id}`

The proposal: `status` is `open`, `confirming`, `confirmed` (with its
`operationId`), `changed` (with `replacedBy`), `refused`, or `expired` (15
minutes after it was made).

### `POST /api/v1/proposals/{id}/confirm`

The owner's yes. The preview is made again: if the shop still gives the
same one, the action runs — `202` with `{ "operation": … }`, the action as
the log has it (follow it at `/operations/{id}`; a homepage action is done at
once). Confirmed again, it answers the same action: a retry never runs it
twice.

If the shop changed since (a price, a product, a section moved), nothing
runs: `409`, `code: "stale"`, and the new proposal in `data.proposal` —
show its summary and confirm that one instead. If the action can no longer
be done as asked, `409` with why (the proposal is `refused`); past its 15
minutes, `410`.

### `GET /api/v1/operations?limit=20`

The log, newest first (up to 100): every action, the catalog's and the
homepage's, with how it came (`via`: `app`, `api`, `assistant`,
`scheduler`), how it went, and whether it can still be undone.

### `GET /api/v1/operations/{id}`

The action as the log has it: `status` (`running`, `done`, `failed`,
`undoing`, `undone`), `via`, `progress`, `changed`, `failed` (refused by the
store), `error`, `undoable`, and after an undo `undo: { restored, kept, failed }`.

### `POST /api/v1/operations/{id}/undo`

"Annulla", for 7 days. An action on products: each value goes back where
the store still shows the value the action wrote (one changed since stays,
and is counted as `kept`) — `202`, then follow it with
`GET /operations/{id}`; refused (`409`) while the action still runs. A
homepage action: its way back is written at once, while the section is as
the action left it (found by its fingerprint wherever it is now) — refused
(`409`) when it changed since, since the newer change stands.

## A script

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

The code: the routes in `src/app/api/v1/`, the token and the answers in
`src/server/api/v1.ts`, the reads in `src/server/api/reads.ts`, the order in
`src/server/api/catalog-order.ts` over `src/server/vetrina/operations/order.ts`,
the actions' registry and proposals in `src/server/vetrina/operations/`
(`registry.ts`, `proposals.ts`).
