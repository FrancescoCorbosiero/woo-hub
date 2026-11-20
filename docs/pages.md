# Pages

A WordPress page's block markup, copied out of the Vetrina's **Pagine**
tab, rewritten elsewhere (by hand, or by an LLM following golden-hive-blocks'
`docs/pages.md`), pasted back, checked, compared block by block, and saved.
It replaces the loop through WordPress's code editor (⋮ › *Code editor*,
copy, paste, *Update*) and adds what that editor does not: a check against
the site's own blocks before anything is saved, and a refusal to save over
a page someone changed meanwhile.

The Hub talks to WordPress's own REST API (`wp/v2`), signed in with the
same Application Password as the menus ([menus.md](menus.md#setup)).
Nothing is installed on WordPress.

## Setup

1. The Application Password's user (`WP_APP_USER`) must be allowed to
   save pages:

   | Capability | Why |
   |---|---|
   | `edit_pages` | any page |
   | `edit_published_pages` | the pages are published |
   | `edit_others_pages` | pages another user wrote — the front page, usually |

   An **Administrator** or an **Editor** has all three. The menus need an
   administrator anyway (`edit_theme_options`), so one administrator's
   Application Password covers both tabs.
2. Optional but worth knowing: **`unfiltered_html`**. Without it (an
   Editor on a multisite network, or a site that removes it), WordPress
   filters what it saves — scripts, iframes, some attributes, in
   `core/html` blocks and inside block attributes alike. The Hub says so on
   the page's screen, and after a save it says when WordPress stored other
   markup than the one sent.
3. Reading the block registry (`/wp/v2/block-types`) needs a user who may
   edit posts or pages: the same user does.

Without `WP_APP_USER` and `WP_APP_PASSWORD` the tab says what to set. A
user who lacks one of the three capabilities can open, copy and check a
page; the screen names what is missing (WordPress's `users/me`,
`context=edit`) and "Aggiorna" stays off, instead of failing on save.

## The loop

1. **Pagine** lists the published pages (`wp.pages()`), sub-pages under
   their page. The page the Vetrina's homepage editor works on (the front
   page: golden-hive-blocks' `/capabilities` says which, or
   `vetrina.page` in `hub.config.ts`) is marked.
2. A page opens with its markup exactly as stored
   (`GET /wp/v2/pages/<id>?context=edit`, `content.raw`), its modified
   time and a link to it. **Copia** puts the markup on the clipboard.
3. The new version is pasted in the box below. **Controlla** checks it and
   shows what would change; **Aggiorna** checks it again and, with no
   errors, shows what changes and asks before saving. Errors block both;
   warnings are shown and do not.
4. After the save: the page's link, its revisions' count and a link to
   WordPress's revisions screen, and the screen shows the stored markup.
   The previous version is in the page's revisions.

## The check

`src/lib/pages/check.ts`, over **WordPress's own parser**
(`@wordpress/block-serialization-default-parser`, the JavaScript twin of
`WP_Block_Parser`, which WordPress runs on save and render): the markup is
read exactly as WordPress will read it. Each issue says where — the line of
the block's opening comment, its place (`3 › 2`: the 2nd block inside the
3rd) and its name — and what it means, in the dictionary's words
(`src/i18n/dictionaries/catalog/pages.it.ts`).

| | Level |
|---|---|
| A block whose attribute JSON does not parse: WordPress drops **every** attribute of that block, without a word. The classic cause is a bare `"` inside a value instead of `"` | error |
| A closing comment with no block open: WordPress turns **the whole rest of the page** into one Classic block | error |
| A closer naming another block than the open one (WordPress closes the open one all the same) | error |
| A block opened and never closed (WordPress closes it at the end of the page) | warning |
| A `golden-hive/*` block the site does not have | error |
| An attribute it does not have, a value of the wrong type, a value outside its allowed ones (`enum`) — WordPress would fall back to the default | error |
| HTML written inside a `golden-hive/*` block (the server draws them; it is ignored) | warning |
| HTML outside any block (a Classic block) | warning |
| `[gh_product_rail]`: an attribute it does not have, a value it would fall back from (`type`, `fallback`, `fit`, `ratio`, `limit`, `columns*`, ids, slugs) | error |
| `[gh_product_rail]` outside a Shortcode Wrapper block: it shows, but the Vetrina cannot see or edit it | warning |
| `[gh_size_rail]`: an attribute it does not have | error |
| `data-gh-reveal` / `data-gh-split` values the plugin's motion scripts do not know, in `core/html` | error |
| The registry could not be read while the page has `golden-hive/*` blocks | error (nothing unchecked is saved) |
| An empty page; one over 2 MB | error |

**The registry is read live**, not hard-coded:
`GET /wp/v2/block-types?namespace=golden-hive&context=edit`, at every check
and again at every save. A block added to the plugin is known at once; a
plugin switched off makes its blocks unknown, which is what the site would
do with them. WordPress's block supports (`className`, `anchor`, `align`,
`style`, `lock`, `metadata`) are accepted on every block.

**Ported from golden-hive-blocks' `tools/page-check-core.php`** (its
`docs/pages.md` and `docs/blocks.md` are the spec): the JSON, registry,
inner-HTML and loose-HTML checks; the rails' rules; the motion hooks. The
structure checks (stray, wrong and missing closers) are the Hub's own.

**Left out**, and why:

- *List items' keys a block never reads* (a slide's `imag` for `image`).
  The PHP checker reads them from each block's `render.php`; the REST
  registry exposes only `block.json`, and guessing from defaults would warn
  about keys the templates do read.
- *Shortcodes no Golden Hive code provides* (a warning there). The list of
  shortcodes is in the plugin's PHP, not in any REST answer; another
  plugin's shortcode is usually fine anyway.
- The rail's values are a copy of golden-hive-blocks 5.17.0's
  (`RAIL_ATTRS` and its neighbours in `check.ts`): a new rail attribute in
  the plugin needs a line here, or the check calls it unknown.
- WordPress's own blocks (paragraph, heading, table…) are not validated
  against the editor's expected HTML: the page shows fine either way, and
  only the block editor complains ("unexpected content").

## What changes

`src/lib/pages/diff.ts`. Both versions are read with the same parser and
laid out depth first, each block with its own part only (its name, its
attributes, its own HTML — a group's wrapper, not the blocks inside it).
The longest run of identical blocks is "unchanged"; between two of them, a
removed and an added block of the same name are one **changed** block, with
the attributes that differ and whether its content did. The rest is
**added** or **removed**. Places are numbered as the check numbers them. A
block that moved reads as removed from its old place and added at the new
one.

## Saving safely

A save (`src/server/wordpress/pages/service.ts`):

1. checks the markup again (never trusting the screen's earlier check):
   any error, nothing is sent;
2. reads the user's capabilities: one missing, nothing is sent;
3. **reads the page again** and compares it with the version the screen
   showed when it opened — its `modified_gmt` **and** a fingerprint of its
   markup (two saves within one second share a modified time): different,
   and the save is refused ("the page changed since you opened it — the
   Vetrina, WordPress, another tab"). The screen reloads the page and keeps
   what was pasted;
4. sends the markup: `POST /wp/v2/pages/<id>` with `{ content }`, **once**.
   A save that fails or times out is never sent again, by the server or
   the screen: it may have landed. The screen says to reload and look
   before trying again.

**This is a check, then a write, and it leaves a window.** Something that
saves the page between step 3's read and step 4's write — moments apart —
is overwritten. Core WordPress offers nothing stronger: `wp/v2` takes no
"only if unchanged since" condition on a save (no `If-Match`, no expected
modified time). The Vetrina's own homepage writes get one from the
golden-hive-blocks plugin (`expected_modified` → 409); a whole-page save
through core does not. Every save leaves a revision, so what was
overwritten is never lost.

**The front page.** The Vetrina edits it too (pinned products, sections,
titles). Pasting a whole page replaces the Vetrina's latest edits unless
the pasted markup started from a fresh copy: the screen says so when the
page opens, and the confirmation says it again. The Vetrina reads the page
live, so it shows what was saved at once; its own "Annulla" on earlier
homepage actions is then refused where the page no longer matches (its
undo checks each block first), never applied over the paste.

**Revisions.** WordPress keeps one for every save that changes the
content, unless the site turns them off (`WP_POST_REVISIONS`); the screen
shows the count after the save, and links to WordPress's revisions screen.

**What WordPress stores** can differ from what was sent: a user without
`unfiltered_html` has scripts, iframes and some attributes filtered out on
save, and some sites rewrite links. The answer to the save is compared
with what was sent, and the screen says when they differ.

## The page cache

A save through `wp/v2` is an ordinary `wp_update_post`: WordPress fires
`save_post` and `post_updated` as for a save from the editor.

- **SiteGround Optimizer** purges on post saves: a post's save runs its
  Supercacher purge queue (its automatic purge, on by default), whether the
  save came from the editor or the REST API. Checked against the plugin's
  documented behaviour and support answers, not its source code (not
  reachable from where this was built): confirm once on the site by saving
  a page here and loading it logged out.
- **The Vetrina's homepage writes** purge every known cache explicitly
  (golden-hive-blocks' `ghb_purge_page_caches`); a save from this tab does
  not call that. golden-hive-blocks' category pages follow the front page's
  rails through a cache keyed by the page's modified time, so they follow a
  save from here on their own.
- Behind a CDN or another cache that does not purge on `save_post`, the
  page shows when that cache expires. The Hub builds no purge for this.

## The demo shop

With `VETRINA_SOURCE=fixture` the pages are an in-memory demo
(`src/server/wordpress/pages/fixture-pages.ts`): a front page, *Chi
siamo*, *Contatti* and three more, saved as WordPress saves them (stored as
sent, a new modified time to the second, one more revision). Its registry
is golden-hive-blocks 5.17.0's block types
(`__fixtures__/golden-hive-block-types.json`, generated from the plugin's
`block.json` files). The demo front page is not the Vetrina demo's homepage
(that one is a model of the page, not markup). The e2e suite
(`e2e/pages.spec.ts`) runs on it: open, copy, a broken paste, a good one,
the changes, the save; a save refused after another tab saved; the front
page's warning.

## Tested how

Unit tests: the checker (`src/lib/pages/check.test.ts`: a valid page,
broken JSON, an unknown block, an unknown attribute, a wrong type, a value
out of its enum, HTML outside blocks, the structure, the rails, the
motion hooks), the diff, the client's page routes (one POST, never
retried), and the save (`service.test.ts`: refused when the page was
modified since it was read — by time, and by markup within one second —
blocked on errors, on a missing capability, on an unreadable registry).
**Not yet run against a live WordPress**: open a page on a staging copy,
paste it back unchanged ("niente da salvare"), then change a heading and
save, and look at the revision.

## Not covered (yet)

Worth doing next, in this order:

- **Restoring a revision** from the Hub (WordPress's revisions are listed
  by `wp/v2/pages/<id>/revisions`; restoring is a save of one of them).
- **Over the API** (`/api/v1/pages`): read, check, and a save as a
  proposal a person confirms, as the menus' and the homepage's actions are
  — with the fingerprint in the proposal's preview.
- **A whole-page save in the operations log** ("Attività"), with an undo
  that is the revision before it.
- New pages, drafts, deleting a page: not in this version.
- Posts and other post types: pages only.

## Where the code is

| | |
|---|---|
| `src/lib/pages/` | the shared types, the checker, the block diff |
| `src/server/wordpress/client.ts` | `wp.page`, `wp.savePage`, `wp.blockTypes` over `wp/v2` |
| `src/server/wordpress/pages/` | the `PageSource` port (`source.ts`), WordPress's (`wp-pages.ts`) and the demo's; `service.ts` the open, the check and the save |
| `src/server/actions/vetrina-pages.ts` | the screen's two server actions: check, save |
| `src/app/(vetrina)/vetrina/pagine/` | the routes |
| `src/components/vetrina/pages/` | the tab: the list, a page's screen, the confirmation |
