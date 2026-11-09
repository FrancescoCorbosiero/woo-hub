# Navigation menus

The site's navigation menus — WordPress's *Aspetto › Menu* — arranged from
the Vetrina's **Menu** tab or over the API ([api.md](api.md#navigation-menus)),
with the same log, proposals and "Annulla" as the catalog's and the
homepage's actions ([operations.md](operations.md)). The owner adds the
shop's categories and brands, the site's pages or a link, moves items up,
down, under another or out of it, renames them and takes them away — and
makes, copies, renames and deletes whole menus, and chooses which menu each
place of the theme shows — from the phone.

The Hub talks to WordPress's own REST API (`wp/v2`), signed in with an
Application Password: no plugin is involved, and nothing is installed on
WordPress.

## Setup

1. On WordPress, as an **administrator** (menus need `edit_theme_options`),
   open *Utenti › Profilo › Password applicazione*, name it "Store Hub",
   and copy the password WordPress shows once.
2. In the Hub's `.env` (`deploy/.env` on the server), next to the
   WooCommerce keys:

   ```sh
   WP_APP_USER=the-administrators-username
   WP_APP_PASSWORD="abcd efgh ijkl mnop qrst uvwx"
   ```

   The spaces are WordPress's own, and can stay. The site is
   `WOO_BASE_URL`'s.
3. Restart the app.

What WordPress must give:

- **WordPress 5.9 or later**, for the menus' REST routes (`wp/v2/menus`,
  `menu-items`, `menu-locations`). On an older one the Menu tab says the
  menus are not connected, and its technical details name the missing route.
- **HTTPS**: WordPress offers Application Passwords only over HTTPS (or on a
  site marked `local`). Some security plugins switch them off — Wordfence
  does by default; turn them back on there for this one user.
- **A classic theme's menus.** A block theme's navigation (the Site
  Editor's *Navigation* block, `wp_navigation`) is a different thing and is
  not covered.

Without `WP_APP_USER` and `WP_APP_PASSWORD`, the Menu tab says what to set,
and `/api/v1/menus` answers `503 not_configured`. A wrong password shows
WordPress's refusal in the tab (`401` over the API, with WordPress's words:
not the API token's).

The Woo keys cannot do this: WordPress takes them on `wc/*` routes only.
The Application Password is a second credential, revocable on its own from
the same WordPress screen.

## What a menu holds

A **menu** (`MenuSummary`, `src/lib/menus/types.ts`) has a name and the
**places** where the theme shows it (`locations`: the theme's own names,
"Menu principale", "Menu del footer"); a menu shown nowhere is not on the
site. The theme's places (`ThemePlace`, `GET /api/v1/menu-locations`) are the
other way round: each place, and the menu it shows, or none. A theme with no
places at all is a block theme, whose navigation is not these menus (the
Menu tab says so).

Its **items** are a tree: each under its `parent` (0: the top level), in
order. An item leads to

| `target.kind` | What | Added from |
|---|---|---|
| `category` | a product category (`product_cat`) | the catalog's categories |
| `brand` | a brand (`product_brand`) | the catalog's brands |
| `page` | a published page | the site's pages |
| `link` | a URL: `https://…`, `/a-path`, `#` (an item that only opens its sub-items) | typed |
| `other` | anything else WordPress links to (a post, a tag, an archive) | not from the Hub: kept, moved, renamed, taken away as any other |

An item of a category, brand or page shows that thing's own name, and
follows it when it is renamed — unless it is given a **label** of its own
(`label`, null when it has none). A link always has one. An item whose
category or page is gone is marked (`invalid`): WordPress leaves it off the
site, and the screen shows it struck through.

The rest of what WordPress keeps on an item (opens in a new tab, CSS
classes, title attribute, description, XFN) is read (`extra`) and never
changed: a move or a rename leaves it as it was, and an undone removal puts
it back.

## The actions

| Kind | Does | "Annulla" |
|---|---|---|
| `menuItemAdd` | adds items, in order, under an item or at the top level, at a 1-based place there (else last): categories and brands by id, pages by id, links with their label; up to 50 at once | takes the items away, each while it is as the action left it |
| `menuItemMove` | moves an item, with everything under it, under another item or to the top level, at a place there (counted once it has left its own: 3 puts it third) | puts it back under the same item, after the same neighbour |
| `menuItemRemove` | takes an item away; its items take its place, in their order, as WordPress's menu editor does | puts it back where it was, with its label and settings, and its items back under it |
| `menuItemRename` | gives an item a label of its own, or `null` to show its category's, brand's or page's name again | gives it back its label |
| `menuCreate` | makes a menu, empty or with a copy of another's items (`copyOf`; items leading to something gone left out), in no place | deletes it, while it is as made and shown nowhere |
| `menuRename` | gives a menu another name; two menus never share one (WordPress ignores case) | gives its name back, while it has the new one |
| `menuDelete` | deletes a menu with its items — refused while a place shows it | makes it again with its items as they were (new ids), in no place |
| `menuLocation` | puts a menu in a place of the theme instead of the one there, or `menuId: null` for none; the site shows it at once | puts back the menu the place showed, while the place shows what the action put there |

Each is assessed first — the menu read, what cannot be done refused (an
unknown category, a place out of range, an item under itself, a move to
where it already is, a name it already has), the rest said in sentences —
then written, then filed with its way back, in a single request: menus are
written at once, not queued like catalog actions.

**Reworking a menu without the site showing it half-done**: copy it
("Duplica" on its "⋯", or `menuCreate` with `copyOf`), change the copy —
the site does not show it — then put it in the main menu's place
(`menuLocation`; on the tab, a confirmation says what the site will show
instead of what). "Annulla", or the old menu put back in the place, undoes
the switch in one step; a seasonal menu (Black Friday, the sales) goes in
and out the same way, the everyday menu kept as it is.

## From the catalog

A category's or a brand's screen in the Catalogo tab says where it is in
the site's menus — "Nel menu «Menu principale», sotto «Brand»", a tap
opening that menu, with "Il tema non mostra questo menu" for a menu on no
place — or that it is in none, and a tap adds it. "Aggiungi a un menu del
sito", in the screen's "⋯", adds it to another: a menu (the ones the site
shows first, those already holding it marked), then where — at its bottom
or under one of its items — one `menuItemAdd`, with "Annulla".

The rows are read after the screen (`termInMenus`, one read of every menu
and item: three requests to WordPress), so WordPress never slows the
catalog down; without WordPress's access there are no rows.

## Writing a menu safely

WordPress keeps no version of a menu: its items have no modified date, so
there is nothing to compare-and-swap against. So:

- **The menu's fingerprint** (`digest`: sha256 of each item's id, parent,
  order, label and target — not WordPress's own numbering) comes with every
  read: the screen keeps the one it showed, a caller gets it from
  `GET /api/v1/menus/{id}`. Sent back as `expected: { "digest": "…" }`, a
  write over a menu that changed since is refused (`409 stale`), and the
  screen shows the menu again.
- **Assess, then write over exactly that read**, moments apart, in the same
  request.
- **A proposal keeps the fingerprint in its preview**: a menu that changed
  between the proposal and the owner's yes makes a new proposal, not a
  surprise (operations.md, [Proposals](operations.md#proposals)).

Every write is the menu's whole new shape (`src/lib/menus/plan.ts`):
numbered top to bottom 1…n, as WordPress's own editor numbers it (the
storefront orders items by that number), with only the items whose parent
or number changes written — through WordPress's batch endpoint
(`/batch/v1`, 25 requests a call, all checked before any is written), one
request each where a site turns batches off. A taken-away item's items are
moved up *before* it is deleted: WordPress's own delete would leave them
pointing at an item that is gone.

If WordPress takes only part of a write, what it took is put back and the
owner reads "the menu is as it was". If even that fails, they read that
only part was written and to check the menu in WordPress (the server's log
names the refusal). Only a write that went through is filed in the log:
a refused one has nothing to undo.

A whole menu's write is one request (made, renamed, deleted, put in a
place). A copy, and the undo of a deletion, make the items again level by
level — a parent before its items, so each goes under its parent's new id —
and if WordPress refuses one, the half-made menu is deleted again (its items
go with it) and the owner reads that the menu was not made. A place is set
through the menus' own list of places, as WordPress's API takes it: the menu
put there gets it, taken from the one that had it.

**"Annulla"** finds the items again by id and by their neighbour (the
items around them may have changed meanwhile), and is refused when an item
it would touch changed since — the newer change stands, as on the
homepage: an added item someone moved or gave items of its own stays; a
removed item's parent that is gone stops it coming back.

## The demo shop

With `VETRINA_SOURCE=fixture` the menus are an in-memory demo
(`src/server/wordpress/menus/fixture-menus.ts`): a main menu with a "Brand"
item holding three brands, a footer of pages, a theme place with no menu —
keeping WordPress's own rules (the title stored empty when it is the
object's name, children orphaned by a bare delete, numbers never
renumbered by WordPress itself). The e2e suite (`e2e/menus.spec.ts`) runs
on it.

## Tested how

The `wp/v2` client and the planner follow WordPress 6.5's own controllers
(`WP_REST_Menus_Controller`, `WP_REST_Menu_Items_Controller`,
`WP_REST_Menu_Locations_Controller`, `WP_REST_Server::serve_batch_request_v1`):
the shapes, the defaults, the batch envelope, the refusals. They are covered
by unit tests (client, planner, fixture), DB tests of the actions (including
a partial write put back) and the e2e suite on the demo shop. **They have
not yet run against a live WordPress**: try the first changes on a staging
copy, or on a menu the theme shows nowhere.

## Not covered (yet)

- WordPress's "add new top-level pages automatically" option, left as it is.
- A block theme's navigation (`wp_navigation`).

## Where the code is

| | |
|---|---|
| `src/lib/menus/` | the menu's types, the planner (layout, insert, move, remove, the writes a new shape needs), the screen's one-tap moves |
| `src/server/wordpress/client.ts` | `wp/v2` over `adapters/http.ts`: the Application Password, menus, items, places, pages, batches |
| `src/server/wordpress/menus/` | the `MenuSource` port (`source.ts`, the fingerprint), WordPress's (`wp-menus.ts`) and the demo's |
| `src/server/vetrina/operations/menu.ts` | the four actions: assess, write, put back, undo; `menu-input.ts` their schema |
| `src/server/api/menus.ts` | the API's reads |
| `src/components/vetrina/menus/` | the Menu tab; `TermMenus.tsx` the catalog's rows and "Aggiungi al menu" |
