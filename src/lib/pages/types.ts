/**
 * The Vetrina's "Pagine" tab: a WordPress page's block markup copied out,
 * a new version pasted in, checked, compared and saved
 * (docs/pages.md). These are the shapes the screen, the server and the
 * checker share; none of them holds WordPress's own spelling.
 */

/** A published page in the tab's list. */
export interface PageSummary {
  id: number;
  title: string;
  parent: number;
  url: string;
}

/** A page opened for editing: its markup as stored (content.raw) and the version it was read at. */
export interface PageRead {
  id: number;
  title: string;
  url: string;
  status: string;
  /** The markup, exactly as WordPress stores it. */
  markup: string;
  version: PageVersion;
}

/**
 * What a page was when it was read: WordPress's modified time (to the
 * second) and a fingerprint of the stored markup. A save presents it back;
 * the page re-read just before writing must still match both.
 */
export interface PageVersion {
  modifiedGmt: string;
  /** sha256 of the stored markup, hex, 32 characters. */
  digest: string;
}

/**
 * Whether the Hub's WordPress user may save pages: the capabilities it
 * lacks (edit_pages, edit_published_pages, edit_others_pages), and whether
 * WordPress filters what it saves (no unfiltered_html: scripts, iframes and
 * some attributes are taken out of the markup on save). null = could not be
 * asked.
 */
export interface PageAccess {
  user: string;
  missing: string[];
  filtered: boolean;
}

/* ---------------------------------------------------------------- *
 * The block registry
 * ---------------------------------------------------------------- */

/** An attribute as the block's registration declares it: its JSON type(s), and the values it allows. */
export interface AttributeSpec {
  type?: string | string[];
  enum?: unknown[];
}

/** A registered block type: GET /wp/v2/block-types, read for one namespace. */
export interface BlockTypeSpec {
  name: string;
  title: string;
  attributes: Record<string, AttributeSpec>;
}

/* ---------------------------------------------------------------- *
 * The check
 * ---------------------------------------------------------------- */

/** Where a block is: its place among its siblings, 1-based, from the top (`[3, 2]`: the 2nd block inside the 3rd), its name, its line. */
export interface BlockAt {
  path: number[];
  name: string;
  /** 1-based line of its opening comment in the pasted markup; null when it cannot be placed. */
  line: number | null;
}

/** How a value is, in the owner's words: text, a number, true/false, a list, an object, null. */
export type ValueKind = "text" | "number" | "boolean" | "list" | "object" | "null";

/** A [gh_product_rail] value the rail would not use, by the rule it breaks. */
export type RailRule = "type" | "fallback" | "fit" | "ratio" | "limit" | "columns" | "ids" | "slugs";

export type PageProblem =
  /** Nothing to save: an empty page. */
  | { kind: "empty" }
  /** Past the size the Hub accepts. */
  | { kind: "tooLarge"; bytes: number; max: number }
  /** A block's attributes are not a JSON object: WordPress drops every one of them. */
  | { kind: "badJson"; excerpt: string }
  /** HTML outside any block: WordPress makes it a Classic block. */
  | { kind: "freeform"; excerpt: string }
  /** A closing comment with no block open: WordPress turns everything after it into one Classic block. */
  | { kind: "strayCloser"; name: string }
  /** A closing comment naming another block than the one it closes (WordPress closes the open one all the same). */
  | { kind: "wrongCloser"; name: string; open: string }
  /** A block opened and never closed: WordPress closes it at the end of the page, taking in everything after it. */
  | { kind: "unclosed" }
  /** The registry could not be read, so golden-hive blocks could not be checked. */
  | { kind: "registryUnavailable"; namespace: string }
  /** A block the site does not have. */
  | { kind: "unknownBlock" }
  | { kind: "unknownAttr"; attr: string; known: string[] }
  | { kind: "wrongType"; attr: string; expected: string[]; got: ValueKind }
  | { kind: "notAllowed"; attr: string; allowed: string[] }
  /** HTML written inside a block the server draws: ignored. */
  | { kind: "innerHtml" }
  | { kind: "railAttr"; shortcode: "gh_product_rail" | "gh_size_rail"; attr: string; known: string[] }
  | { kind: "railValue"; attr: string; value: string; rule: RailRule }
  /** A [gh_product_rail] outside a Shortcode Wrapper: it shows, but the Vetrina cannot see or edit it. */
  | { kind: "railOutsideWrapper" }
  | { kind: "motion"; attr: "data-gh-reveal" | "data-gh-split"; value: string };

export interface PageIssue {
  /** An error blocks saving: WordPress or the plugin would get it wrong or drop it. A warning is worth a look. */
  level: "error" | "warning";
  /** null: the page as a whole. */
  at: BlockAt | null;
  problem: PageProblem;
}

/* ---------------------------------------------------------------- *
 * What changes
 * ---------------------------------------------------------------- */

/** A block in the comparison: its name and its place (path, as in BlockAt). */
export interface DiffBlock {
  name: string;
  path: number[];
}

export type BlockChange =
  | { kind: "added"; after: DiffBlock }
  | { kind: "removed"; before: DiffBlock }
  /** Same block name, other attributes or content. */
  | { kind: "changed"; before: DiffBlock; after: DiffBlock; attrs: string[]; content: boolean };

export interface PageDiff {
  changes: BlockChange[];
  /** Blocks exactly as they were (their position may have moved). */
  unchanged: number;
  /** The markup is byte for byte the page's. */
  identical: boolean;
}

/** What "Controlla" answers: the issues, and what saving would change. */
export interface PageCheck {
  issues: PageIssue[];
  errors: number;
  warnings: number;
  diff: PageDiff;
}

/** A save that went through. */
export interface PageSaved {
  url: string;
  version: PageVersion;
  /** WordPress stored other markup than the one sent (filtered: no unfiltered_html). */
  altered: boolean;
  /** The page's revisions after the save; null when WordPress did not say. */
  revisions: number | null;
  /** WordPress's screen comparing the revisions, when it said which is the latest. */
  revisionsUrl: string | null;
}

/** The most the Hub sends as one page: WordPress takes more, but no real page is near it. */
export const MAX_MARKUP_BYTES = 2_000_000;
