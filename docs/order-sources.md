# Order sources ("Fonti d'ordine")

An **order source** is a ranking of the shop's products taken from somewhere
else: a reference shop's page, a marketplace's best sellers, a list someone
keeps. It is uploaded once (by hand, from the Vetrina or the API) in the
format below, and then used with one tap: **"Usa l'ordine di «X»"** puts the
products it ranks first — in its order — on a category, a brand or the whole
catalog. The other products follow, in the order they had.

The typical way to make one: give an LLM the page whose order you want (its
link, its text or screenshots) together with the instructions in
[The LLM's instructions](#the-llms-instructions), and paste its answer into
the Vetrina as it is.

## In the Vetrina

- **Where they live**: "Fonti d'ordine" — the row under the quick views on
  the **Catalogo** tab, and the button at the top right of the **Homepage**
  tab (beside the clock of "Attività").
  The sheet lists the sources with how many of their products the shop has.
- **Adding one**: "Aggiungi una fonte" → a name, where it comes from
  (optional), and the ranking: paste the LLM's answer (or a CSV, or one
  product per line) or upload a file. "Copia istruzioni LLM" copies the
  instructions to give the LLM. The ranking is read as it is pasted: how many
  products, how many the shop has, and which ones it does not find (and why,
  when a name could be more than one product). Nothing is saved before
  "Salva la fonte".
- **Using one**:
  - on a category or a brand: its screen, "Ordina: Negozio" → **"Usa
    l'ordine di «X»"** (the first sources by name; "Fonti d'ordine…" for the
    others);
  - on the whole catalog: the source's sheet → **"Usa su tutto il catalogo"**.

  Both show the preview first: the products moved (#37 → #1), the products the
  source does not rank (they stay after, in their order), and what to know.
  The action shows in "Attività" and has its "Annulla", like every catalog
  action.
- **Replacing one**: the source's sheet → "Modifica o sostituisci la
  classifica" (a new text replaces the ranking; empty keeps it), or upload it
  again through the API under the same name.

A source is matched to the shop **each time it is used**, so a product
published after the upload finds its place, and one gone from the shop just
drops out. Using it again after the shop's order changed puts its products
back on top.

## The format

```json
{
  "format": "woo-hub.order-source/1",
  "name": "StockX — più venduti",
  "origin": "https://stockx.com/sneakers/most-popular",
  "items": [
    { "sku": "DD1391-100", "name": "Nike Dunk Low Retro White Black Panda" },
    { "sku": "IE3437", "name": "adidas Samba OG Cloud White Core Black" },
    { "name": "Air Jordan 4 Retro Bred Reimagined" }
  ]
}
```

| Field | | |
|---|---|---|
| `format` | `"woo-hub.order-source/1"` | optional, for whoever reads the file |
| `name` | the source's name in the Vetrina ("StockX — più venduti") | optional: the form or the API can give it |
| `origin` | where the ranking comes from: a link, or words | optional |
| `items` | the products, **in order**: the first is the first | required, at most 20,000 |
| `items[].sku` | the maker's style code (DD1391-100, IE3437, 1203A537-100, U9060ZGB) | `sku` and/or `name` |
| `items[].name` | the product's name: brand, model, colourway | `sku` and/or `name` |

Anything else is ignored. A product listed twice counts once, at its first
place.

### What else is read

People and LLMs rarely hand over exactly that, so the reader takes:

- the JSON inside a ` ```json ` fence, or after a sentence ("Ecco il JSON: …"),
  with trailing commas;
- a bare list: `[{ "sku": "…" }, …]`, or of strings `["DD1391-100", "Nike Dunk
  Low Panda"]` (a string that looks like a code — one word, with a digit — is
  a SKU, any other a name);
- other key names: `products`/`prodotti`/`ranking` for `items`;
  `style_code`/`codice` for `sku`; `title`/`nome` for `name`; or the one list
  an object holds (`{ "sneakers": [ … ] }`);
- a `rank`/`position` on **every** item: then the items are sorted by it;
- a CSV (comma, semicolon or tab) with a header naming `sku` and/or `name`
  (`nome`, `codice`, `rank` too), the rows in order;
- one product per line, numbered or not: `1. DD1391-100 Nike Dunk Low Panda`,
  `- IE3437`, `Air Jordan 1 Mid Olive Grey`.

## How products are matched

1. **By SKU**: letters and digits only, any case — `dd1391 100` is
   `DD1391-100`. A code written inside a name (`Air Force 1 (CW2288-111)`) is
   found too. A SKU the shop has twice takes both.
2. **By name**, when no SKU matches: accents, case and punctuation set aside —
   the same name; or **every word** of it in exactly one product's name ("Nike
   Dunk Low Panda" is "Nike Dunk Low Retro White Black Panda" when no other
   product has those four words); of several products with every word, only
   the one with no other word ("Air Jordan 1 Mid Olive Grey", not its
   "(GS)").
3. A name that fits more products than that is **left out**, and the Vetrina
   says so ("più prodotti possibili"): a wrong product at the top would be
   worse than one missing. A SKU makes a product certain: ask the LLM for it
   whenever the page shows it.

## The LLM's instructions

The Vetrina's "Copia istruzioni LLM" copies these (in Italian; English when
the Vetrina is in English). Give them to the LLM together with the page.

```text
Sei un assistente che ricava l'ordine dei prodotti da una pagina di un negozio online.

Ti do una pagina (link, testo copiato o screenshot) che elenca prodotti (sneakers, abbigliamento, accessori) in un certo ordine. Rispondi SOLO con un JSON valido, senza testo prima o dopo, con questa struttura:

{
  "format": "woo-hub.order-source/1",
  "name": "<un nome breve per la fonte, es. Nike.com — Novità>",
  "origin": "<il link della pagina>",
  "items": [
    { "sku": "<codice stile del produttore>", "name": "<nome completo del prodotto>" }
  ]
}

Regole:
1. "items" segue l'ordine della pagina: il primo prodotto mostrato è il primo dell'elenco. In una griglia leggi da sinistra a destra, dall'alto in basso.
2. "sku" è il codice stile del produttore (es. DD1391-100 per Nike, IE3437 per adidas, 1203A537-100 per ASICS, U9060ZGB per New Balance). Mettilo solo se compare sulla pagina o nel link del prodotto; se non c'è, ometti il campo: non inventarlo.
3. "name" è il nome come scritto sulla pagina: brand, modello e colorway (es. "Nike Dunk Low Retro White Black Panda").
4. Ogni prodotto una volta sola, anche se la pagina lo ripete.
5. Niente prezzi, taglie o altri campi: solo "sku" e "name".
```

A long page: ask for it in parts ("i primi 100", "dal 101 al 200") and join
the lists, or upload several sources.

## The API

With `Authorization: Bearer $HUB_API_TOKEN` (setup: [api.md](api.md)).

| | |
|---|---|
| `GET /api/v1/order-sources` | every source, with `items`, `matched`, the first `unmatched` |
| `POST /api/v1/order-sources` | upload: **replaces** the source of the same name (200), or makes it (201) |
| `GET /api/v1/order-sources/{id}` | one source, matched to the shop now |
| `DELETE /api/v1/order-sources/{id}` | the orders it was used for stay as they are |
| `POST /api/v1/order-sources/{id}/apply` | `{ "term": { "taxonomy": "category", "id": 12 }, "dryRun": true }`, or `{}` for the whole catalog |

The upload's body can be:

- the format itself, as JSON (`Content-Type: application/json`) — its `name`
  names the source — or the LLM's answer as it came (a fence and a sentence
  around the JSON are fine);
- `{ "name": "…", "origin": "…", "content": "<any text the Vetrina reads>" }`;
- the text itself (`Content-Type: text/plain` or `text/csv`) with
  `?name=…&origin=…` in the address.

```sh
# The LLM's answer, saved to trending.json, uploaded as "SneakerShop — Trending"
curl -H "Authorization: Bearer $HUB_API_TOKEN" -H "Content-Type: application/json" \
  --data-binary @trending.json "$HUB/api/v1/order-sources"

# A CSV
curl -H "Authorization: Bearer $HUB_API_TOKEN" -H "Content-Type: text/csv" \
  --data-binary @ranking.csv "$HUB/api/v1/order-sources?name=StockX%20best%20sellers"

# Use it on category 12: preview first, then for real (follow /api/v1/operations/{id})
curl -H "Authorization: Bearer $HUB_API_TOKEN" -d '{"term":{"id":12},"dryRun":true}' \
  "$HUB/api/v1/order-sources/$SOURCE_ID/apply"
curl -H "Authorization: Bearer $HUB_API_TOKEN" -d '{"term":{"id":12}}' \
  "$HUB/api/v1/order-sources/$SOURCE_ID/apply"
```

So a pipeline (an LLM reading a page every morning, say) can upload its
ranking under a fixed name, and the owner taps "Usa l'ordine di «…»" when
they want it — or the pipeline applies it too.

## Limits

- **One order per product.** WooCommerce keeps one `menu_order` number per
  product, shared by every category and brand it is in. A source used on
  "Sneakers" moves its products in "Nike" too, the same way (the preview says
  where). Used on the whole catalog, every category follows the same order.
- A homepage section's pinned products still come first on their category's
  page; sold-out products still go last on the shop.
- The shop's pages follow this order only when WooCommerce › Settings ›
  Products › "Default product sorting" is **Custom ordering + name**; the
  preview warns when it is not.
- Using a source is a one-off: it does not follow the source when the source
  changes. Use it again after replacing it.

The code: `src/server/vetrina/order-sources/` (format, matching, storage),
`src/server/vetrina/operations/order.ts` (the "sourceOrder" action),
`src/components/vetrina/catalog/sources/` (the sheets),
`src/app/api/v1/order-sources/` (the API).
