# The store's taxonomies

The shop's product categories, brands and tags, managed from the Hub: a
term made, renamed, moved under another, merged into another, deleted — from
a category's or a brand's screen in the Vetrina (its "⋯"), or over the API
as proposals ([api.md](api.md#the-store-s-taxonomies)) — each filed in the
log with "Annulla" ([operations.md](operations.md)).

This is the store's own tree. Where Publish files a new product is the
Taxonomies tab's business (taxonomy rules, `src/server/actions/taxonomy.ts`);
the two meet in the aliases below.

## The actions

| Kind | Does | "Annulla" |
|---|---|---|
| `termCreate` | makes a category, a brand or a tag, at the top or under a `parent` (categories, brands) | deletes it, while it is as made and nothing holds it — no product, no sub-term |
| `termRename` | gives a term another name; its **slug stays**, and with it its address on the site and every link to it (homepage sections, menus) | gives its name back, while it has the new one |
| `termMove` | puts a category or a brand, with its sub-terms, under another (0: the top level) — never under itself or a term below it | puts it back under its old parent, while it is where the action put it |
| `termMerge` | every product holding the term holds `into` instead; its sub-terms go under `into`; then the term is deleted | makes the term again (name, slug, parent, description; a new id), its sub-terms back under it, and each product holds it again instead of `into` |
| `termDelete` | every product holding the term lets go of it; then the term is deleted, its sub-terms moving up to its parent (WordPress's own way); the products stay in the shop | makes the term again and gives it back to each product |

Making, renaming and moving are one request each, done at once
(`src/server/vetrina/operations/terms.ts`). Merging and deleting touch every
product holding the term: they run in the background, product by product,
like "Aggiungi alla categoria" — the progress pill, each product's terms
filed for "Annulla" — and the term itself goes last, only once nothing holds
it: a product the store refuses keeps the term, and so does the store (the
run says so), or WordPress would let go of products with no way back. A
product left with no category goes to the shop's default category, as
WooCommerce does; "Annulla" takes it out again.

What each is refused for, said before anything runs:

- a name taken under the same parent — WordPress compares names without case;
- a term under itself or under a term below it; a merge into itself or below itself;
- merging or deleting a category an **automatic rule** fills (its rule decides
  its products), a term with **a margin of its own** (set it back to the
  standard margin first), or a term the **homepage** shows (change the section
  first);
- merging into an automatic category.

And what it warns of: the products a deleted category leaves with no
category, a menu item that would lead nowhere, a move that puts the term's
products under another category's or brand's margin (from the next price
sync).

## Aliases: renames and Publish

Publish finds a product's category by **name under its parent**, and its
brand by name (`src/server/woo/identity.ts`) — from the taxonomy rules, or
KicksDB's own tree. Without care, renaming "Yeezy" to "Yeezy (adidas)" in the
store would have the next Publish make a new "Yeezy" category, and file new
products there.

So a rename, a move and a merge of a category or a brand leave the old name
(under the old parent) as an **alias** of the term it is now
(`term_aliases`, `src/server/woo/term-aliases.ts`); the resolver reads the
aliases with the store's terms. A real term of that name, made since, wins
over the alias; an alias of a term that is gone is ignored. "Annulla" takes
the alias away. Names are compared as WordPress sends them back, entities
decoded — "Saldi &amp; Outlet" is "Saldi & Outlet" (a category with "&" in
its name used to be made again on every Publish).

What follows a term by id is untouched by a rename or a move: automatic
categories, margins, menus, the homepage's sections (by slug, which stays),
the Hub's index.

## Where the code is

| | |
|---|---|
| `src/lib/vetrina/term-ops.ts` | the kinds, the records their undo reads |
| `src/server/vetrina/operations/terms.ts` | made, renamed, moved: assess, write, undo |
| `src/server/vetrina/operations/term-removal.ts` | a merge's and a deletion's preview |
| `src/server/vetrina/operations/writes.ts` | their run and undo (`runTermRemoval`, `undoTermRemoval`) |
| `src/server/vetrina/operations/term-facts.ts` | the terms as they are, and what leans on one |
| `src/server/woo/client.ts` | `createStoreTerm`, `updateStoreTerm`, `deleteStoreTerm`, `productIdsInTerm` |
| `src/server/woo/term-aliases.ts` | the aliases, and how names are compared |
| `src/components/vetrina/catalog/term/TermManage.tsx` | the "⋯" sheets |
