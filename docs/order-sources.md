# Order sources ("Classifiche")

An **order source** — a *classifica* in the Vetrina, never an "ordine", which
in a shop reads as a customer's order — is another shop's order of its
products — usually one of its **collections** (Shopify) or **categories** — or
any ranking someone keeps. It is uploaded once (by hand, from the Vetrina or
the API) in the format below, and then used with one tap: **"Disponi come
«X»"** puts the products it ranks first — in its order — on a category, a
brand or the whole catalog. The other products follow, in the order they had.

The typical way to make one: give an LLM the link of the collection or
category page whose order you want (or a screenshot of it), together with the
instructions in [The LLM's instructions](#the-llms-instructions), and paste
its answer into the Vetrina as it is.

A source is also **compared with the shop** ([The comparison](#the-comparison)):
which of its products the shop has, at what price against the other shop's —
the ones off by more than 2%, brought to it with one tap ("Allinea") — which
ones the shop lacks, imported through Publish, and the uncertain ones, paired
by hand.

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

- **Where they live**: "Classifiche da altri negozi" — the row under the
  quick views on the **Catalogo** tab. The sheet lists them with how many of
  their products the shop has.
- **Adding one**: "Aggiungi una classifica" → a name, where it comes from
  (the collection's link, optional), and the ranking: paste the LLM's answer
  — or its answers, one after another — (or a CSV, or one product per line)
  or upload a file. "Copia istruzioni LLM" copies the instructions to give
  the LLM with the collection's link. The ranking is read as it is pasted: how
  many products, how many the shop has, which ones it does not find (and why,
  when a name could be more than one product), how many answers were joined,
  and whether the last one stops halfway (the LLM's length limit: write
  "continua" and paste the rest after it). Nothing is saved before "Salva la
  classifica".
- **Using one**:
  - on a category or a brand: its screen, "Posizioni nel negozio" →
    "Disponi come una classifica" → **"Disponi come «X»"** (the first by name;
    "Classifiche…" for the others) — or, on a homepage section showing that
    category or brand, its editor's "Disponi come una classifica…";
  - on the whole catalog: the ranking's sheet → **"Disponi tutto il catalogo
    così"**.

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
    { "sku": "DD1391-100", "name": "Nike Dunk Low Retro White Black Panda", "price": 119.99 },
    { "sku": "IE3437", "name": "adidas Samba OG Cloud White Core Black", "price": 120 },
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
| `items[].price` | its price on that page — what it sells for now (a discounted one when discounted; "from €129" is 129) — in the shop's currency | optional: the comparison's prices need it |

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
  (`nome`, `codice`, `rank`, `price`/`prezzo` too), the rows in order;
- a price as a page writes it: `129.99`, `"129,99 €"`, `"€ 1.299,00"`,
  `"$1,299.50"` (the last separator before one or two digits is the decimal
  one); under `price`, `prezzo`, `current_price`, `sale_price`, `amount`;
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

## The comparison

Each source has a screen — the source's sheet → **"Confronta con il
negozio"** (`/vetrina/catalogo/classifica/{id}`) — that sets it against the
shop, item by item, read live each time: which product each item is, its
price there against the shop's, and what to do about it.

- **Prezzi diversi**: the products the shop has whose price is off by **more
  than 2%** — not by the cents. The shop's price is the one the storefront
  shows: the cheapest size's, the sale price when on sale (the store index's
  `price`). The gap is the shop's price against the other's, to one decimal:
  +12.4% means the shop asks 12.4% more. 2.04% is not more than 2%; a cent is
  no difference at all. Each is chosen; **"Allinea N prezzi"** shows the
  preview and runs the `priceMatch` action (below), with "Annulla".
- **Mancanti**: the items no product of the shop is. Those with a code are
  chosen by hand; one without a code is first looked up on KicksDB by its name
  (**"Cerca su KicksDB"**: up to three products, closest first, with picture
  and code) and the right one picked. **"Importa N prodotti"** makes them in
  the shop through Publish (below). "nel catalogo dell'Hub" marks the ones the
  Hub's catalog already has.
- **Da verificare**: names several products of the shop fit as well ("Nike
  Dunk Low Panda" with six colourways): tapped, the products whose names come
  closest are offered, and the shop can be searched. The comparison names
  them for its first 300 uncertain or missing items; any other's are asked
  for when its pairing opens — a list of 20 000 with 15 000 missing would
  otherwise spend seconds on suggestions nobody reads.
- **Tutti**: the whole source in its order; any entry can be paired again.
  "Disponi tutto il catalogo così" uses the order (sourceOrder).

### Pairing by hand

An item is paired with a product of the shop — or marked **"Non è nel
negozio"** (a name that fitted the wrong product; it goes among the missing),
or handed back to the **automatic pairing**. A product is one item's: paired
here, it is no other item's pair. The pairs are saved with the source, by the
item itself (its SKU, else its name, as compared) rather than its place, so
they hold when the source is uploaded again — the weekly list, in another
order — and the order "Disponi come «X»" gives follows them too. A pair
whose product has left the shop counts for nothing.

### "Allinea i prezzi" (priceMatch)

Each chosen product is brought to the other shop's price: its **cheapest size
to that price, every other size moved by the same amount**, so the sizes keep
their spread.

- A product the Hub prices (KicksDB, the supplier's feed) gets its new prices
  as **locks** — the product sheet's "manual is sacred", which the price sync
  writes exactly and never changes — then the sync writes them through the
  ordinary path, the live check included. A price written straight to the
  store would last until the next sync: the engine would put its own back.
  The preview warns that the locks stay until taken off, and when a new price
  is under the market's lowest ask.
- A simple product the Hub does not price (the shop's own) gets its regular
  price written.
- Left as they are, and said why: a product **on sale** (end the sale first),
  one with no price of the Hub's, one at that price already, one with sizes
  the Hub does not price (change those from its sheet).

"Annulla" puts back each lock (or price) that is still as the action left it,
and has the sync write the prices again. Over the API it is the `priceMatch`
action ([operations.md](operations.md)): `{ "kind": "priceMatch", "items":
[{ "productId": 4810, "price": 139 }], "source": "Concorrente" }`.

### "Importa"

The missing products are made in the shop **through Publish** — its checks,
its prices (the engine's and the margins'), its photos queue — a few at a
time, with the progress shown and a way to stop. A code the Hub's catalog
lacks is confirmed on KicksDB first and joins the catalog; **a code KicksDB
does not confirm is never published** ("KicksDB non li conosce"), and one it
did not answer for is said apart (try again). A product the store already has
is left as it is. What was made is listed with its link; it joins the
comparison at the store index's next check, within a couple of minutes.
Nothing made can be taken back from here: the sheet says what it will do
first. The demo shop publishes nothing.

## The LLM's instructions

The Vetrina's "Copia istruzioni LLM" copies these (in Italian; English when
the Vetrina is in English). Give them to the LLM together with the link of
the collection or category page.

```text
Sei un assistente che ricava l'ordine dei prodotti dalla pagina di una collezione o di una categoria di un negozio online.

Ti do il link di una pagina che elenca i prodotti di UNA collezione o categoria (o uno screenshot di quella pagina: leggilo allo stesso modo): su Shopify è un indirizzo con /collections/… (es. https://negozio.com/collections/sneakers); sugli altri negozi è la pagina di una categoria (es. …/categoria/sneakers, …/c/sneakers). Mi serve l'ordine in cui il negozio mostra i prodotti in quella pagina con il suo ordinamento predefinito ("In evidenza", "Consigliati", "Featured"): non riordinarli tu e non scegliere un altro ordinamento.

Se il link è la homepage, la pagina di un singolo prodotto o una ricerca, non darmi il JSON: rispondi con una sola frase che mi chiede il link della collezione o della categoria. La homepage non dice in che ordine il negozio mette i suoi prodotti.

Se i prodotti continuano su altre pagine (?page=2, "Pagina successiva", "Carica altri"), leggile in ordine e continua l'elenco da dove eri arrivato.

Con il link di una collezione o di una categoria rispondi SOLO con un JSON valido, senza testo prima o dopo, con questa struttura:

{
  "format": "woo-hub.order-source/1",
  "name": "<negozio — collezione, es. Kith — Nike Dunk>",
  "origin": "<il link della collezione o della categoria>",
  "items": [
    { "sku": "<codice stile del produttore>", "name": "<nome completo del prodotto>", "price": 129.99 }
  ]
}

Regole:
1. "items" segue l'ordine della pagina: il primo prodotto mostrato è il primo dell'elenco. In una griglia leggi da sinistra a destra, dall'alto in basso.
2. "sku" è il codice stile del produttore (es. DD1391-100 per Nike, IE3437 per adidas, 1203A537-100 per ASICS, U9060ZGB per New Balance). Mettilo solo se compare sulla pagina o nel link del prodotto; se non c'è, ometti il campo: non inventarlo.
3. "name" è il nome come scritto sulla pagina: brand, modello e colorway (es. "Nike Dunk Low Retro White Black Panda").
4. Ogni prodotto una volta sola, anche se la pagina lo ripete.
5. "price" è il prezzo che la pagina mostra per quel prodotto, come numero (es. 129.99): quello a cui si compra adesso — se è scontato, il prezzo scontato; se è "da 129 €", 129. Se la pagina non lo mostra, ometti il campo.
6. Niente taglie o altri campi: solo "sku", "name" e "price".
7. Se i prodotti sono più di 150, dammi i primi 150 e chiudi il JSON; quando ti scrivo "continua", dammi un nuovo JSON con i successivi 150, e così via fino all'ultimo.
```

Whether an LLM can read the page depends on the LLM: one that browses reads
the link itself; otherwise paste the page's text, or screenshots, with the
link. Shops that load the grid with JavaScript, or block bots, show an LLM
less than they show a person: check the count the Vetrina gives against the
page.

## The API

With a bearer token ([api.md](api.md#tokens)): reading needs `read`,
uploading and pairing `propose`, deleting and importing `admin` (a dry run:
`read`). Using a source — its order, or its prices — without `dryRun` starts
the action for a token with `admin`, and makes it a proposal for any other —
to confirm with `POST /api/v1/proposals/{id}/confirm`, by a person.

| | |
|---|---|
| `GET /api/v1/order-sources` | every source, with `items`, `matched`, the first `unmatched` |
| `POST /api/v1/order-sources` | upload: **replaces** the source of the same name (200), or makes it (201) |
| `GET /api/v1/order-sources/{id}` | one source, matched to the shop now |
| `DELETE /api/v1/order-sources/{id}` | the orders it was used for stay as they are |
| `POST /api/v1/order-sources/{id}/apply` | `{ "term": { "taxonomy": "category", "id": 12 }, "dryRun": true }`, or `{}` for the whole catalog |
| `GET /api/v1/order-sources/{id}/compare?threshold=2` | the comparison: each item's `status` (`matched`, `ambiguous`, `missing`), `paired`, `product` (id, sku, name, price, onSale, status), `price`, `gap` (%), `differs`, `candidates` (for the first 300 uncertain or missing items, the uncertain first), `inCatalog`; and a `summary` |
| `GET /api/v1/order-sources/{id}/candidates?position=7` | one item's candidates, for any item past those 300 |
| `POST /api/v1/order-sources/{id}/pairs` | `{ "position": 7, "pair": 4810 }` — or `"none"`, or `"auto"`: answers the comparison |
| `POST /api/v1/order-sources/{id}/prices` | "Allinea": `{ "dryRun": true }` for every item that differs, or `{ "positions": [1, 3], "threshold": 5 }` |
| `POST /api/v1/order-sources/{id}/lookup` | `{ "positions": [4, 9] }` (at most 10): KicksDB's products for those items, by SKU or by name, up to three each |
| `POST /api/v1/order-sources/{id}/import` | `{ "skus": ["DD1391-100"] }` (at most 25), or `{ "missing": true, "after": 0 }` — its missing items' own SKUs, 25 at a time, `next` saying where to go on — with `"dryRun": true` for what Publish would make |

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
ranking under a fixed name, and the owner taps "Disponi come «…»" when
they want it — or the pipeline applies it too.

```sh
# The comparison: what differs by more than 5%, what is missing
curl -H "Authorization: Bearer $HUB_API_TOKEN" "$HUB/api/v1/order-sources/$SOURCE_ID/compare?threshold=5"

# Match the prices that differ: the preview, then for real (a proposal, for a token without admin)
curl -H "Authorization: Bearer $HUB_API_TOKEN" -d '{"dryRun":true}' "$HUB/api/v1/order-sources/$SOURCE_ID/prices"
curl -H "Authorization: Bearer $HUB_API_TOKEN" -d '{}' "$HUB/api/v1/order-sources/$SOURCE_ID/prices"

# Import the missing ones that have a code, 25 at a time (needs admin)
curl -H "Authorization: Bearer $HUB_API_TOKEN" -d '{"missing":true,"dryRun":true}' "$HUB/api/v1/order-sources/$SOURCE_ID/import"
curl -H "Authorization: Bearer $HUB_API_TOKEN" -d '{"missing":true}' "$HUB/api/v1/order-sources/$SOURCE_ID/import"
```

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
- **Prices are compared as numbers**, in the shop's currency: compare shops
  that sell in it. A product with sizes is compared by its cheapest size, on
  both sides — what a listing page shows.
- "Allinea" leaves products on sale alone, and a product of the shop's own
  with sizes (no price of the Hub's): change those from the product's sheet.
  On the demo shop every product is the shop's own, so only that path runs
  there.

The code: `src/server/vetrina/order-sources/` (format, matching, storage;
`compare.ts` and `compare-model.ts` the comparison and the pairs, `import.ts`
the KicksDB lookup and the import), `src/server/vetrina/operations/order.ts`
(the "sourceOrder" action), `src/server/vetrina/operations/price-match.ts`
(the "priceMatch" action), `src/components/vetrina/catalog/sources/` (the
sheets and the comparison's screen, `CompareScreen.tsx`),
`src/app/api/v1/order-sources/` (the API).
