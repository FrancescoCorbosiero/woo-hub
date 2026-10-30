# Actions, the log and proposals

How the Vetrina changes the shop, whoever asks: the owner on its screens, a
script over the API ([api.md](api.md)), an assistant acting for the owner.
They all run the same actions, through the same code, into the same log —
and anything asked from outside the screens goes through a **proposal** the
owner says yes to.

## Actions

Every change is an **action**: a named kind with a typed input, checked on the
server, previewed, filed in the log, and undoable. Two families:

| Scope | Kinds | Runs |
|---|---|---|
| **catalog** — products | `hide`, `show`, `sale`, `unsale`, `tag`, `untag`, `categorize`, `uncategorize`, `pin`, `margin`, `order`, `sourceOrder`, `delete` | in the background, one at a time, product by product (`operations/runner.ts`, `writes.ts`, `remove.ts`) |
| **homepage** — sections and blocks | `sectionSwitch`, `sectionMove`, `sectionsArrange`, `sectionAdd`, `sectionRemove`, `sectionSource`, `sectionEdit`, `blockEdit` | at once: one write to the page, a WordPress revision (`operations/page.ts`) |

The types are in `src/lib/vetrina/catalog-ops.ts` and `page-ops.ts`. One
registry describes them all for programs (`operations/registry.ts`): what each
does, how it is undone, a valid example, and its input as JSON Schema made
from the very schema the server checks (`GET /api/v1/actions`).

Before it runs, an action is **assessed** on the shop as it is: refused when it
could not run (the same refusals the write would give: a section already off,
a product already in that place, a list the config does not allow), and
otherwise previewed — the products it changes, before → after, those it leaves
as they are and why, what the owner should know; a homepage action in
sentences.

## The log

Every action is a row of `vetrina_operations`, kept 30 days:

- its label, rendered in the reader's language each time it is shown;
- **how it came** (`via`): `app` (the screens), `api`, `assistant`,
  `scheduler` — the Attività sheet says it beside the time;
- how it went (status, progress, products changed and refused);
- its way back.

**Annulla**, within 7 days — from the toast, from Attività, or over the API —
puts back what the action changed, where nobody changed it since:

- **A catalog action**: each value it wrote (a visibility, a price, a
  category list, a position) goes back where the shop still shows what the
  action wrote; a value changed since stays, and is counted as kept.
- **A homepage action**: the section is found again by its fingerprint (its
  block's attributes hash, wherever it stands now) and its way back is
  written over the page as it is then. If the section changed since, the undo
  is refused: the newer change stands. A move goes back only while the
  sections are exactly as it left them; a section taken away goes back next to
  the same neighbour, with its texts, products and settings.

The screens' own toasts carry the log's "Annulla" — the same one Attività
offers later.

## Proposals

Anything asked from outside the screens should not write on its own word.
A **proposal** is the owner's yes, kept by the server
(`operations/proposals.ts`, `vetrina_proposals`):

```
propose(action) ──► open ──confirm──► same preview ──► confirmed  → the action runs, once
                     │                 other preview ──► changed    → a new proposal, nothing runs
                     │                 cannot run now ──► refused    → why
                     └─ 15 minutes ──► expired
```

1. **propose**: the action is checked and assessed as above; the preview is
   kept with its fingerprint (sha256 of the preview as stable JSON) and its
   language. The answer has the preview **in sentences** (`summary`) — what the
   owner should read before saying yes.
2. **confirm**: one confirmation takes it (two at once cannot both run it).
   The preview is made again, in the proposal's language. The same fingerprint:
   the action runs, filed in the log with the proposal's `via`. Another: nothing
   runs — a new proposal takes its place, with the new preview, and comes back
   with the refusal. Confirmed again later, it answers the action it started.

So the owner's yes is always to the preview they read: a price that moved, a
product that left the category, a section someone moved meanwhile — each
makes a new proposal rather than a surprise.

## For an assistant

An MCP server — the next step — is a thin layer over these pieces, in the same
process (so its actions are filed with `via: "assistant"`):

| Tool | Over |
|---|---|
| read the homepage | `readHomepage()` — `src/server/api/reads.ts` |
| find products | `readProducts(query)` — the query an action's target takes |
| list categories, brands | `listTerms(taxonomy)` — `src/server/api/catalog-order.ts` |
| read the log | `listOperations(limit)` |
| propose an action | `propose(action, "assistant")` — one tool per kind from the registry, its input the kind's JSON Schema |
| confirm | `confirmProposal(id)` |
| undo | `undoOperation(id)` |

The flow it follows: read → propose → show the owner the summary → on their
yes, confirm → if the shop changed, show the new summary and ask again. The
limits stay on the server (the schemas, the shop's checks, the config), never
in a prompt; whatever it does is in Attività, undoable from the phone.

What the MCP step adds: the MCP endpoint itself (Streamable HTTP, in the Next
app), the sign-in a remote client needs (OAuth for a connector in the Claude
app), and the tools built from the registry.

## Words

What the owner reads — labels, previews, summaries, refusals — is in the
owner's language (Italian; `Accept-Language: en` over the API for English),
from the catalog's dictionaries (`src/i18n/dictionaries/catalog/ops.*.ts`).
What programs read — the registry's descriptions, the JSON Schemas — is in
English.
