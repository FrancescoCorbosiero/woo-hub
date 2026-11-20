import type { PageProblem, RailRule, ValueKind } from "@/lib/pages/types";
import type { VetrinaErrorCode } from "@/lib/vetrina/types";
import { blockName, type pagesIt } from "./pages.it";

/** English strings for the Vetrina's "Pages" tab; same shape as ./pages.it.ts. */

const n = (count: number) => count.toLocaleString("en-GB");
const plural = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${n(count)} ${many}`);
const list = (items: readonly string[]) => items.join(", ");

const TYPE: Record<string, string> = {
  string: "text",
  number: "a number",
  integer: "a whole number",
  boolean: "true or false",
  array: "a list",
  object: "an object",
  null: "null",
};
const GOT: Record<ValueKind, string> = { text: "text", number: "a number", boolean: "true/false", list: "a list", object: "an object", null: "null" };

const RAIL: Record<RailRule, (attr: string, value: string) => string> = {
  type: (_a, v) => `type="${v}" is not recent, featured, best_selling, sale or top_rated: it would show the newest.`,
  fallback: (_a, v) => `fallback="${v}" is not menu_order, date, popularity, price, price-desc or rating.`,
  fit: (_a, v) => `fit="${v}" is not cover or contain.`,
  ratio: (_a, v) => `ratio="${v}" is not square, portrait, tall, landscape, wide or N/N: the photo would fall back to square.`,
  limit: (_a, v) => `limit="${v}" is not a whole number of 1 or more.`,
  columns: (a, v) => `${a}="${v}" must be a whole number from 1 to 8.`,
  ids: (a, v) => `${a}="${v}" must be product IDs separated by commas.`,
  slugs: (a, v) => `${a}="${v}" must be slugs (lowercase, hyphens), not names.`,
};

function problem(p: PageProblem): string {
  switch (p.kind) {
    case "empty":
      return "The page is empty: paste the block markup.";
    case "tooLarge":
      return `The markup is too long (${(p.bytes / 1e6).toFixed(1)} MB; at most ${(p.max / 1e6).toFixed(1)} MB).`;
    case "badJson":
      return "This block's attributes are not valid JSON: WordPress would drop all of them, without a word. Usually a \" inside a text: write it \\u0022.";
    case "freeform":
      return "HTML outside any block: WordPress turns it into a Classic block. Put it in a <!-- wp:html --> block.";
    case "strayCloser":
      return `Closing <!-- /wp:${blockName(p.name)} --> with no block open: WordPress turns everything after it into one Classic block.`;
    case "wrongCloser":
      return `This closer names «${blockName(p.name)}», but the open block is «${blockName(p.open)}»: WordPress closes «${blockName(p.open)}» all the same.`;
    case "unclosed":
      return "A block opened and never closed: WordPress closes it at the end of the page, with everything after it inside.";
    case "registryUnavailable":
      return `Could not read the ${p.namespace} blocks registered on the site, so they could not be checked. Try again shortly; if it keeps happening, the plugin may be off.`;
    case "unknownBlock":
      return "The site has no such block: it would not show.";
    case "unknownAttr":
      return `The block has no «${p.attr}» attribute: it would ignore it. It has: ${list(p.known)}.`;
    case "wrongType":
      return `«${p.attr}» must be ${p.expected.map((t) => TYPE[t] ?? t).join(" or ")}, not ${GOT[p.got]}: WordPress would use the default.`;
    case "notAllowed":
      return `«${p.attr}» can only be: ${list(p.allowed)}.`;
    case "innerHtml":
      return "The server draws this block: HTML written inside it is ignored. Write it as a single comment closing with /-->.";
    case "railAttr":
      return `[${p.shortcode}] has no «${p.attr}» attribute: it would be ignored. It has: ${list(p.known)}.`;
    case "railValue":
      return `[gh_product_rail] ${RAIL[p.rule](p.attr, p.value)}`;
    case "railOutsideWrapper":
      return "[gh_product_rail] outside a Shortcode Wrapper block: it shows on the site, but the Vetrina cannot see or edit it.";
    case "motion":
      return `${p.attr}="${p.value}" is not a value the animations know.`;
  }
}

export const pagesEn: typeof pagesIt = {
  title: "Pages",
  intro: "The site's published pages. Open one to copy its block markup, paste a new version, check it and save it.",
  empty: "The site has no published pages.",
  vetrinaBadge: "Homepage · the Vetrina edits it too",
  back: "Pages",
  errors: {
    not_configured: "The site's pages are not connected: it needs access to WordPress (WP_APP_USER and WP_APP_PASSWORD). Ask whoever runs the server.",
    unauthorized: "WordPress refused access: the application password is wrong, or its user may not edit pages.",
    not_found: "This page is no longer on the site.",
    invalid: "The request is not valid: reload the page and try again.",
    failed: "WordPress is not answering. Try again shortly.",
  } as Partial<Record<VetrinaErrorCode, string>>,

  page: {
    modified: (when) => `Modified ${when}`,
    open: "Open on the site",
    current: "The markup now",
    currentHint: (lines, chars) => `${plural(lines, "line", "lines")} · ${plural(chars, "character", "characters")}`,
    copy: "Copy",
    copied: "Markup copied",
    copyFailed: "Could not copy: select the text and copy it by hand.",
    next: "The new version",
    nextHint: "Paste the whole page here: it replaces the current one.",
    placeholder: "<!-- wp:… -->",
    check: "Check",
    save: "Update",
    checking: "Checking…",
    vetrina:
      "This is the homepage: the Vetrina edits it too (pinned products, sections, titles). Always start from a fresh copy, or you will lose its latest edits.",
    noAccess: (user, caps) => `The WordPress user «${user}» may not save pages: they lack ${list(caps)}. Give them the Editor role (or these capabilities), then reload.`,
    filtered: (user) => `The WordPress user «${user}» lacks unfiltered_html: on save, WordPress strips scripts, iframes and other HTML it deems unsafe.`,
    accessUnknown: "Could not ask WordPress what its user may do: if they may not save pages, it will say so on save.",
  },

  check: {
    title: "Check",
    ok: "No errors: it can be saved.",
    errors: (count) => plural(count, "error", "errors"),
    warnings: (count) => plural(count, "warning", "warnings"),
    blocked: "There are errors: fix them, then try again.",
    warningsOnly: "Warnings do not block saving, but are worth reading.",
    error: "Error",
    warning: "Warning",
    where: (line, path, name) =>
      [line != null ? `Line ${n(line)}` : null, path.length > 0 ? `block ${path.join(" › ")}` : null, blockName(name)].filter(Boolean).join(" · "),
    page: "The page",
    problem,
    stale: "The page changed since you opened it (from the Vetrina, WordPress or another tab). Reload it, then try again: what you pasted stays.",
    reload: "Reload the page",
  },

  diff: {
    title: "What changes",
    identical: "It is identical to the current page: nothing to save.",
    none: "No block changes: only spaces or line breaks between blocks.",
    unchanged: (count) => `${plural(count, "block stays", "blocks stay")} the same`,
    added: "Added",
    removed: "Removed",
    changed: "Changed",
    at: (path) => `position ${path.join(" › ")}`,
    was: (path) => `was at position ${path.join(" › ")}`,
    attrs: (keys) => `attributes: ${list(keys)}`,
    content: "content",
    more: (count) => `…and ${n(count)} more`,
  },

  confirm: {
    title: "Save the page?",
    subtitle: (title) => `«${title}» on WordPress`,
    front:
      "This is the homepage. Pasting the whole page replaces the Vetrina's latest edits (pinned products, sections, titles), unless the markup started from a fresh copy.",
    revisions: "WordPress keeps the current version in the page's revisions.",
    yes: "Save to WordPress",
    saving: "Saving…",
  },

  saved: {
    toast: "Page saved",
    title: "Page saved",
    body: "The previous version is in the page's revisions, on WordPress.",
    revisions: (count) => `The page has ${plural(count, "revision", "revisions")}.`,
    openRevisions: "See the revisions",
    open: "Open the page",
    altered:
      "WordPress saved the markup with some differences from what was pasted (it usually strips HTML it deems unsafe). The current markup, above, is what it saved.",
    unchanged: "The page already holds exactly this markup: nothing to save.",
    stale: "Not saved: the page changed since you opened it. Reload it, then try again.",
    noAccess: "Not saved: the WordPress user may not edit pages.",
    failed: "The save failed, or WordPress did not answer in time. Reload the page to see whether it was saved before trying again.",
  },
};
