# Order sources ("Fonti d'ordine")

An **order source** is another shop's order of its products — usually one of
its **collections** (Shopify) or **categories** — or any ranking someone
keeps. It is uploaded once (by hand, from the Vetrina or the API) in the
format below, and then used with one tap: **"Usa l'ordine di «X»"** puts the
products it ranks first — in its order — on a category, a brand or the whole
catalog. The other products follow, in the order they had.

The typical way to make one: give an LLM the link of the collection or
category page whose order you want, together with the instructions in
[The LLM's instructions](#the-llms-instructions), and paste its answer into
the Vetrina as it is.

## Which page: a collection or a category, not the homepage

A shop's order lives on its **listing pages**: a Shopify collection
(`https://shop.com/collections/nike-dunk`), a WooCommerce product category
(`…/product-category/sneakers/`), any shop's category page (`…/c/sneakers`).
Each shows its products in the order the shop chose for it — its default
sorting ("In evidenza", "Featured", "Consigliati"). The homepage does not
have that order: it shows a few hand-picked sections, so an LLM given the
homepage can only guess. The instructions tell the LLM to refuse a homepage,
a product page or a search and to ask for a collection's link; the Vetrina
warns when the link given as the source's origin looks like a homepage.

So **one source = one collection or category**: "Kith — Nike Dunk" from
Kith's Nike Dunk collection, used on the shop's own "Nike Dunk" category (or
brand). A ranking of the whole shop, used on the whole catalog, is the other
way, when the reference shop has a page listing everything in its order.

A collection spread over several pages (`?page=2`, "Carica altri"): the
LLM is told to read them in order, 150 products at a time; each answer after
"continua" is pasted after the others, and they are joined.

## In the Vetrina

- **Where they live**: "Fonti d'ordine" — the row under the quick views on
  the **Catalogo** tab, and the button at the top right of the **Homepage**
  tab (beside the clock of "Attività").
  The sheet lists the sources with how many of their products the shop has.
- **Adding one**: "Aggiungi una fonte" → a name, where it comes from
  (the collection's link, optional), and the ranking: paste the LLM's answer
  — or its answers, one after another — (or a CSV, or one product per line)
  or upload a file. "Copia istruzioni LLM" copies the instructions to give
  the LLM with the collection's link. The ranking is read as it is pasted: how
  many products, how many the shop has, which ones it does not find (and why,
  when a name could be more than one product), how many answers were joined,
  and whether the last one stops halfway (the LLM's length limit: write
  "continua" and paste the rest after it). Nothing is saved before "Salva la
  fonte".
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
  "name": "Kith — Nike Dunk",
  "origin": "https://kith.com/collections/nike-dunk",
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
| `name` | the source's name in the Vetrina ("Kith — Nike Dunk") | optional: the form or the API can give it |
| `origin` | where the ranking comes from: the collection's or category's link (or words) | optional |
| `items` | the products, **in order**: the first is the first | required, at most 20,000 |
| `items[].sku` | the maker's style code (DD1391-100, IE3437, 1203A537-100, U9060ZGB) | `sku` and/or `name` |
| `items[].name` | the product's name: brand, model, colourway | `sku` and/or `name` |

Anything else is ignored. A product listed twice counts once, at its first
place.

### What else is read

People and LLMs rarely hand over exactly that, so the reader takes:

- the JSON inside a ` ```json ` fence, or after a sentence ("Ecco il JSON: …"),
  with trailing commas;
- **several answers pasted one after another** (one per page of a
  collection, or after "continua"): joined in that order, a product repeated
  at the joins counted once;
- **an answer cut short** by the LLM's length limit: read up to its last whole
  product, and the Vetrina says so;
- a bare list: `[{ "sku": "…" }, …]`, or of strings `["DD1391-100", "Nike Dunk
  Low Panda"]` (a string that looks like a code — one word, with a digit — is
  a SKU, any other a name);
- other key names: `products`/`prodotti`/`ranking` for `items`;
  `style_code`/`codice` for `sku`; `title`/`nome` for `name`; or the one list
  an object holds (`{ "sneakers": [ … ] }`);
- a `rank`/`position` on **every** item, each its own: then the items are
  sorted by it (answers that each count from 1 keep the text's order);
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
the Vetrina is in English). Give them to the LLM together with the link of
the collection or category page.

```text
Sei un assistente che ricava l'ordine dei prodotti dalla pagina di una collezione o di una categoria di un negozio online.

Ti do il link di una pagina che elenca i prodotti di UNA collezione o categoria: su Shopify è un indirizzo con /collections/… (es. https://negozio.com/collections/sneakers); sugli altri negozi è la pagina di una categoria (es. …/categoria/sneakers, …/c/sneakers). Mi serve l'ordine in cui il negozio mostra i prodotti in quella pagina con il suo ordinamento predefinito ("In evidenza", "Consigliati", "Featured"): non riordinarli tu e non scegliere un altro ordinamento.

Se il link è la homepage, la pagina di un singolo prodotto o una ricerca, non darmi il JSON: rispondi con una sola frase che mi chiede il link della collezione o della categoria. La homepage non dice in che ordine il negozio mette i suoi prodotti.

Se i prodotti continuano su altre pagine (?page=2, "Pagina successiva", "Carica altri"), leggile in ordine e continua l'elenco da dove eri arrivato.

Con il link di una collezione o di una categoria rispondi SOLO con un JSON valido, senza testo prima o dopo, con questa struttura:

{
  "format": "woo-hub.order-source/1",
  "name": "<negozio — collezione, es. Kith — Nike Dunk>",
  "origin": "<il link della collezione o della categoria>",
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
6. Se i prodotti sono più di 150, dammi i primi 150 e chiudi il JSON; quando ti scrivo "continua", dammi un nuovo JSON con i successivi 150, e così via fino all'ultimo.
```

Whether an LLM can read the page depends on the LLM: one that browses reads
the link itself; otherwise paste the page's text, or screenshots, with the
link. Shops that load the grid with JavaScript, or block bots, show an LLM
less than they show a person: check the count the Vetrina gives against the
page.

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
