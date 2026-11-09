# Exposing the Hub as middleware for a tool-calling client

Status: **audit and recommendation** (2026-11-09). The question: is this
codebase structured enough to be driven by a program (an LLM over tool
calls / MCP) instead of a person over its screens, for needs that mix
WordPress (menus, pages, blocks, media) and WooCommerce (products,
taxonomies, orders)? And should that be built here, extracted from here,
or rebuilt in a fresh repo with this one as the spec?

Method: seven independent audits of the code (coverage, layering,
WordPress surface, safety model, runtime state, spec quality, recorded
intent), every claim checked by two skeptics, then three advocates (keep,
extract, fresh) and a judge over the verified findings. File and line
references were read, not inferred. The design of the LLM itself is out
of scope here.

- [1. Verdict](#1-verdict)
- [2. What is already middleware](#2-what-is-already-middleware)
- [3. What is not](#3-what-is-not)
- [4. The WordPress half](#4-the-wordpress-half)
- [5. Keep, extract, or fresh repo](#5-keep-extract-or-fresh-repo)
- [6. Plan](#6-plan)
- [7. Risks and open decisions](#7-risks-and-open-decisions)

## 1. Verdict

**Partially ready, and asymmetrically so.**

The Vetrina half (the owner's app: 21 action kinds over products and the
homepage) *is already built as middleware*: one registry describes every
action with a JSON Schema generated from the very Zod schema the server
validates, writes from outside the screens go through a proposal the owner
confirms, every action is logged with how it came and is undoable for 7
days. `docs/operations.md` already names an in-process MCP server as the
next step, and every function it names exists with the signature it gives.

The admin half (the ten tabs: sync, preview, publish, pricing, taxonomies,
collections, feeds, import, orders, duplicates) is *not exposed at all*:
about 82 of 107 server-action exports have no programmatic counterpart.
Most are thin wrappers that are cheap to expose; two files hold real
orchestration that must be lifted first.

The WordPress half (menus, pages, media, settings) *does not exist in any
form*: the Hub speaks only `wc/v3` and the Golden Hive Blocks plugin's
`wc-gh/v1`, has no `wp/v2` client and no WordPress credential, and the
project's own decision record assigns menus and media to the plugin.

**Recommendation: keep this codebase and grow the programmatic layer in
place.** Borrow discipline from the extraction option (enforced
boundaries, DB tests in CI, a writer-role guard) and one primitive from
the fresh-repo option (a leased jobs table instead of the in-memory
runner), and do not split the process or the repo in the next three
months. A rewrite would re-derive the part that is already right.

## 2. What is already middleware

Verified strengths, all confirmed by both skeptics.

| Piece | Where | State |
|---|---|---|
| Action registry: 13 catalog + 8 homepage kinds, title, description for a program, undo semantics, valid example | `src/server/vetrina/operations/registry.ts` | JSON Schema (draft 2020-12) via `z.toJSONSchema` from the same discriminated unions `parseAction` checks; pinned by `registry.test.ts` in CI |
| Tool list over HTTP | `GET /api/v1/actions` | Serves the registry; `src/server/api/v1.ts` maps errors to codes and honours `Accept-Language` |
| Proposals: preview, keep, confirm once | `operations/proposals.ts` | Preview fingerprinted (sha256 of stable JSON), 15-minute expiry, atomic claim by conditional `UPDATE`, re-preview at confirm, replacement proposal on drift, idempotent second confirm |
| Operations log and undo | `operations/service.ts`, `plan.ts` | `via: app \| api \| assistant \| scheduler` on every row; before/after items for a 7-day undo; homepage undo by block fingerprint |
| Safe writes | `operations/writes.ts`, `remove.ts`, `page.ts`, `wp-source.ts` | Live re-read of each chunk right before writing; compare-and-swap (`expected_modified_gmt`, `attrs_hash`) on homepage writes; one runner, one action at a time |
| Input bounds | `operations/input.ts`, `context.ts` | Zod everywhere; 2,000 products per id-list action, 50,000 for whole-term hide/sale; sale 1–90 %, margin 0–200 % |
| Reads a caller needs | `/api/v1/homepage`, `/catalog/products`, `/catalog/terms`, `/catalog/order`, `/operations` | Backed by `store_index`, refreshed every 5 minutes, by every write's answer, and on open when older than 2 minutes |
| Free-text LLM output as data | `vetrina/order-sources/format.ts`, `match.ts` | Parses fenced JSON, joined and truncated answers, CSV, numbered lines; refuses ambiguity explicitly |
| Port with fixture | `vetrina/source.ts` (`VetrinaSource`), `fixture-source.ts` | The right shape to copy for further WordPress adapters |
| Health | `tsc`, `eslint`, `vitest` | 0 type errors, lint clean at `--max-warnings=0`, 1,003 unit tests in ~7 s without a database; CI runs typecheck, lint, unit, build and 22 Playwright tests against Postgres |

The layering is better than the folder names suggest. Only three files
under `src/server`, `core/` and `src/lib` import from `next` (two
`refresh()` calls in server actions and the `/api/v1` envelope). The 87
`import "server-only"` lines are a guard, not coupling; vitest already
stubs them and runs 17 real-SQL suites under plain Node. Env access is
centralised in `src/lib/env.ts`. The owner's words are resolved through one
`AsyncLocalStorage` (`operations/words.ts`), so a headless caller gets
English the way `/api/v1` already does.

## 3. What is not

Verified gaps, ordered by weight for a program as the caller.

**Identity and authorization (the one real blocker).** `/api/v1` accepts
one shared `HUB_API_TOKEN` (`src/server/api/v1.ts:57-61`). There is no
per-caller identity, no scopes, no read-only mode. The confirm route calls
`confirmProposal(id)` with no actor, so a token holder confirms its own
proposals indistinguishably from the owner. `vetrina_proposals` and
`vetrina_operations` record only `via`, never who. `via: "assistant"` and
`"scheduler"` are declared and labelled but never written by production
code. Fix: principals and scopes in `serve()`, an `actor` column on two
tables, confirm accepted only from a human channel. One function, two
columns.

**Three writes outside the proposal gate.** `POST /catalog/order` and
`POST /order-sources/{id}/apply` call `startOperation(..., "api")`
directly (`src/server/api/catalog-order.ts:113`, `order-sources.ts:66`);
`POST /operations/{id}/undo` is single-call too. The `order` and
`sourceOrder` kinds are already in the registry, so routing them through
`propose` is a redirect. No rate limit, no cap on open proposals or queue
depth; each proposal performs live Woo reads.

**The admin half is UI-only.** 107 exported server actions in 24 files;
21 have an API twin (all Vetrina), 4 have a cron analogue (`/api/cron/*`
with `CRON_SECRET`: pull, GoldenSneakers sync, KicksDB refresh, media
queue), the rest are reachable only through the Authelia session. Store
pull, sync preview and apply, publish, SKU import, feeds, pricing rules,
taxonomy rules, smart collections, duplicates, orders, overrides and
locks, store edits, repair and rebuild: none has a programmatic entry.
Most of these actions are `safeParse → service.X`, but their Zod schemas
are private constants inside `"use server"` files (which may export only
async functions), so a route cannot reuse them until they are hoisted.
Two files hold real orchestration: `src/server/actions/preview.ts` (898
lines of sync planning) and `config.ts` (394 lines of pricing-rule
editing), imported *upward* by `src/server/scheduler.ts:14` and
`src/server/sync/price-sync.ts:2`. `src/components/catalog/drawer-data.ts`
is a server module misfiled under components. The high-blast-radius
writers (sync apply, publish, rebuild, repair, trash-duplicate, full pull,
pricing and taxonomy resets) have dry runs and `apply_audit` rows but no
proposal, no actor and no per-value undo.

**Single-process runtime.** The operations runner is an in-memory promise
chain on `globalThis` (`operations/runner.ts:19-39`); `recover()` marks
every row still `running` as interrupted at every process start. The
scheduler (started from `src/instrumentation.ts` inside the Next server),
the collections runner, the sync apply-job map, the publishing set and
several caches follow the same pattern. Only the media queue
(`FOR UPDATE SKIP LOCKED` + `locked_until`, `woo/media.ts:166-189`) and
snapshot writes (advisory lock) are safe for more than one process.
`docs/deploy.md:309` requires a single app container per shop. Two
consequences: an MCP endpoint must live *in this process* (or call
`/api/v1` over HTTP), never import the domain from a second process; and
a deploy of the UI today interrupts a running one-hour sale.

**Single-tenant.** No table carries a shop id; shop identity is the
process env and `site-guard.ts` exists to fail safe when a database is
pointed at another shop. One Hub per shop with one token per shop is fine;
one process serving many shops is not an option without touching 24
tables.

**Thin tests on the glue.** `src/server/api/*` has no unit tests; 5
Playwright tests cover 2 of 21 kinds plus order, undo and three reads.
The 17 `*.db.test.ts` suites (queue, undo, restart, ledger, locks) run only
with `RUN_DB_TESTS=1` and never in CI, although the e2e job already has
Postgres.

**Words.** About 68 hardcoded Italian strings sit in server code outside
the dictionaries, including API refusals; some `VetrinaError` messages in
`vetrina/service.ts`, `catalog.ts`, `wp-source.ts` bypass `words()`.

## 4. The WordPress half

The Hub has two outbound surfaces, both authenticated with the WooCommerce
consumer key and secret as HTTP Basic:

| Surface | Client | Routes | Covers |
|---|---|---|---|
| `wc/v3` | `src/server/woo/client.ts` (695 lines, ~22 methods, 12 resource paths) | products, variations, batch, categories/brands/tags/attributes, orders (read), one settings key | the shop's product data |
| `wc-gh/v1` (Golden Hive Blocks) | `src/server/vetrina/wp-source.ts` (211 lines, 7 routes) | capabilities, homepage, rail, products, homepage/block, homepage/layout, homepage/history | one configured page's blocks and rails |

There is no `wp/v2` call anywhere in `src`, `docs` or `e2e`. Menus, pages,
posts, media library, settings, users and revisions are absent. Photos
are never uploaded by the Hub: WordPress sideloads them from URLs passed in
`PUT wc/v3/products/{id}`. The capabilities handshake with the plugin is
real (`features[]` gates five section powers, 5-minute cache,
`plugin_missing` on `rest_no_route`), but `version` and `api` are parsed
and never compared, and `fields{}` is parsed and never used.

Two facts bind any WordPress-wide extension:

1. **Woo REST keys authenticate only `wc-*` namespaces.** Reaching `wp/v2`
   needs a second credential (an Application Password) or more plugin
   routes under `wc-gh/v1`.
2. **The decision record says menus are the plugin's.**
   `docs/hub-and-plugin.md:121` places navigation menus in WordPress's own
   editor, media hygiene and email in the plugin. The user's own example
   ("change the navigation menu with these product categories") is
   therefore a *conscious amendment* of that record, not a gap in its
   execution. The binding rule there ("one writer of product data") is
   untouched by it: a menu is not product data.

The shape to extend is already in the repo: `VetrinaSource` is a clean
port with a fixture implementation and an error mapping to `VetrinaError`
codes, over the shared retry/timeout adapter `src/server/adapters/http.ts`.
A `MenuSource` or `PageSource` sibling with its fixture, registered as new
action kinds with preview, compare-and-swap and undo items, is the natural
move. The week-1 decision is only *which auth path*: plugin routes (one
credential, plugin releases needed) or `wp/v2` with an Application
Password (no plugin change, a second secret in `env.ts`).

## 5. Keep, extract, or fresh repo

| | A. Keep, grow in place | B. Extract core + separate service | C. Fresh repo, this one as spec |
|---|---|---|---|
| First mixed WP+Woo request end to end | weeks | after 3–4 weeks of moves | after re-deriving the write spine |
| Regression risk to the shop running today | low: UI, deploy, Authelia, plugin untouched | medium: ~150 file moves, an HTTP hop on every UI write, a second container, dual-writer hazard in transition | high: ~2,660 lines of apply/publish/scheduler orchestration plus ~1,300 lines in action files re-derived from code and from DB tests CI never runs; two codebases alive |
| Long-term shape | relies on discipline | compiler enforces the boundary | cleanest if finished |
| Judge's score | 8 | 6 | 5 |

What each argument was worth after verification:

- **For keep.** The hard half (registry, proposals, undo, live re-reads,
  i18n-aware previews, 29-rule `plan.test.ts`) exists and is tested. The
  in-process MCP endpoint is what `docs/operations.md` planned, and it is
  the one option that cannot accidentally create a second writer. The
  85 `server-only` lines cost nothing there.
- **For extract.** True: UI deploys interrupt in-flight operations;
  schemas trapped in `"use server"` files and the two upward imports are
  symptoms of an unenforced boundary. False: a second container does not
  fix the in-memory queue, it only moves which restart loses it. The
  enforcement ideas are worth taking without the process split.
- **For fresh.** True: the WordPress half is new scope everywhere, and
  principal/tenant columns and a leased jobs table are easier to design in
  than to retrofit. Overstated: the authorization fix is one function and
  two columns, and the runtime fix is five coordinators sharing one pattern
  that `media.ts` already implements. The planners that would port
  verbatim are exactly the parts that need no porting if the repo stays.
- **Where the code is the spec, not the docs.** `docs/api.md` and
  `docs/operations.md` are current and map one-to-one onto the routes;
  `docs/vetrina-customer-hub.md` and `docs/catalog-centric-redesign.md`
  carry pre-implementation status lines the code has passed. Of the six
  items in `hub-and-plugin.md` §6, only bulk actions is done.

**Conditions under which this verdict flips.** In-process multi-tenancy
(one middleware for many shops) becomes a requirement: none of A or B
suffices, and C's persistence rebuild earns its cost. The UI is to be
retired or the middleware must scale horizontally: B is the honest frame.
Menus, pages and media become the centre and products the periphery: a
WordPress-first core with a thin Woo adapter is a better shape.

## 6. Plan

In place, in this order. Every hoist below is the same move extraction
would make, so B stays a reversible later option.

**Week 1: the safety chokepoint, no new capability.**
Principals and scopes (`read | propose | confirm | undo | admin`) in
`serve()`, `HUB_API_TOKENS` as a list with the single token kept as the
legacy entry; `actor` on `vetrina_proposals` and `vetrina_operations`,
written by propose, confirm, start and undo; confirm refused without a
human actor (Authelia's `Remote-User`, which `src/proxy.ts` already
forwards, or a confirm-scoped credential a person holds); the two
shortcuts routed through `propose` unless `admin`; undo scoped; a
per-principal rate limit and open-proposal cap (Redis is present); a sweep
reopening rows stuck in `confirming`; a `HUB_ROLE` guard so the scheduler,
`queueRun()`, the collections runner and `apply-job.ts` refuse to start
outside the designated writer process; an ESLint `no-restricted-imports`
rule forbidding `src/server/**` from importing `src/server/actions/**` or
`src/components/**`; `RUN_DB_TESTS=1` in the CI e2e job; unit tests for
`src/server/api/v1.ts`. Decide the WordPress auth path.

**Weeks 2–3: the Vetrina half live for a program.**
`src/app/api/mcp/route.ts` (Streamable HTTP, in the Next process,
exempted in `src/proxy.ts` beside `/api/v1/`): one `propose_<kind>` tool
per registry kind with `inputSchema` from `describeActions()`, plus read,
`get_proposal`, `confirm_proposal` and `undo_operation` tools, all filing
`via: "assistant"`. `asOf` on catalog reads from the index's `seen_at`.
Hardcoded Italian refusals moved behind `words()`. A data-driven e2e
round-trip over every kind in the registry.

**Weeks 3–6: the admin half.**
Hoist `actions/preview.ts` into `src/server/sync/`, `actions/config.ts`
into `src/server/pricing/`, the inline Woo calls of `store-edit.ts` and
`duplicates.ts` into `src/server/woo/`; fix the two upward imports; move
`drawer-data.ts` under `src/server/catalog/`; export the admin Zod
schemas. Add an `ops` scope to the registry with owner-facing kinds only
(collection rule save/delete/run, pricing rules, taxonomy rules, publish,
sync apply, store pull, SKU import, overrides), each with a preview (the
existing dry run where there is one), `admin` scope on blast-radius kinds
(rebuild, resets). Move the sync-apply mutual exclusion onto the
`apply_audit` running row with boot reconciliation. Add the reads the UI
has and the API lacks (term margin, standing term actions, section
history, rules, publish delta, feeds and orders state).

**Weeks 5–8, overlapping: the WordPress port.**
A `MenuSource` port with a fixture mirroring `VetrinaSource`; a client
over `adapters/http.ts` on the chosen auth path; `menuItemAdd`,
`menuItemMove`, `menuItemRemove` kinds with compare-and-swap on
`modified_gmt` and before/after undo items; amend `hub-and-plugin.md:121`.
Acceptance: "create category X from these SKUs, feature it on the
homepage, add it to the main menu" as three proposals a person confirms,
each in Attività with `via: assistant` and the confirming actor recorded,
each undoable.

**Weeks 8–12: durability.**
Replace the runner's `globalThis` chain with a leased `jobs` table
(`FOR UPDATE SKIP LOCKED` + `locked_until` + worker identity, the pattern
in `woo/media.ts`); `service.ts`'s `queued` flag read from the table;
`recover()` reclaims only expired leases. After this a UI deploy no longer
interrupts a running sale, and extraction becomes a free choice.

## 7. Risks and open decisions

- **Human confirm is new design, not plumbing.** Confirming from the phone
  means the Authelia-signed Vetrina sheet; confirming from a chat client
  means a separate confirm-scoped credential. Skipping this is the one
  place where "it already works" is a trap: today the token that proposes
  can confirm.
- **Admin scope creep.** 73 exports is a long list; register owner-facing
  writes only and leave debug, export and health as UI.
- **Long streams behind Cloudflare.** The 100-second ceiling that shaped
  `apply-job.ts` applies to an MCP endpoint too: keep tool answers short
  and have the caller poll `/operations/{id}`.
- **WordPress menu REST quirks** (locations, auto-add) are unknown until a
  fixture is built from a real site; the plugin-route path avoids `wp/v2`
  but requires plugin releases.
- **Open**: whether multi-shop in one process will ever be wanted. If
  yes, say so now; it is the only scenario in which a fresh persistence
  layer pays for itself.
