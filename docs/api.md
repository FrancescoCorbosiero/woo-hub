# Programmatic API (`/api/v1`)

The catalog's actions for a script or another service: the same code the
Vetrina's screens run (`src/server/vetrina/operations/`), with the same
preview, the same log and the same "Annulla". Today it covers **the shop's
order**: reading a category's (or brand's) products in the order its page on
the shop shows them, and placing products in it.

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
with a matching HTTP status (400, 404, 409, 401, 503, 500). The words inside
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

### `GET /api/v1/operations/{id}`

The action as the log has it: `status` (`running`, `done`, `failed`,
`undoing`, `undone`), `progress`, `changed`, `failed` (refused by the store),
`error`, `undoable`, and after an undo `undo: { restored, kept, failed }`.

### `POST /api/v1/operations/{id}/undo`

"Annulla", for 7 days: each `menu_order` goes back where the store still shows
the value the action wrote (one changed since stays, and is counted as
`kept`). `202`, then follow it with `GET /operations/{id}`. Refused (`409`)
while the action still runs.

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
`src/server/api/v1.ts`, the order in `src/server/api/catalog-order.ts` over
`src/server/vetrina/operations/order.ts`.
