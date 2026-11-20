import { parse } from "@wordpress/block-serialization-default-parser";
import type { AttributeSpec, BlockAt, BlockTypeSpec, PageIssue, PageProblem, RailRule, ValueKind } from "./types";
import { MAX_MARKUP_BYTES } from "./types";

/**
 * A page's block markup checked before it is saved: what WordPress or the
 * golden-hive-blocks plugin would get wrong or silently drop.
 *
 * The parse is WordPress's own (@wordpress/block-serialization-default-parser,
 * the JavaScript twin of WP_Block_Parser, which the server runs on save and
 * render), so "WordPress would read it this way" is literal. On top of it:
 *
 * - a block whose attribute JSON does not parse (WordPress drops every
 *   attribute of that block, without a word: the classic cause is a bare "
 *   inside a value instead of ");
 * - the page's structure, read with the parser's own tokenizer: a closing
 *   comment with nothing open (WordPress turns the whole rest of the page into
 *   one Classic block), a closer naming another block than the open one, a
 *   block never closed;
 * - every block of the checked namespace (golden-hive/*) against the site's
 *   live registry: that it exists, only known attributes, of the declared
 *   type, within the allowed values; HTML written inside it (the server draws
 *   these blocks and ignores it);
 * - HTML outside any block (a Classic block);
 * - the [gh_product_rail] / [gh_size_rail] rules of golden-hive-blocks'
 *   tools/page-check-core.php and docs/pages.md (attribute names and values,
 *   a rail outside a Shortcode Wrapper is invisible to the Vetrina), and its
 *   motion hooks in raw HTML blocks.
 *
 * Left out of the PHP reference: list items' keys a block never reads (it
 * reads them from each block's render.php, which the REST registry does not
 * expose) and shortcodes no Golden Hive code registers (the same: the list is
 * in the plugin's PHP). The rail constants below mirror golden-hive-blocks
 * 5.17.0.
 */

type Parsed = ReturnType<typeof parse>[number];

/** The namespace checked against the registry. */
export const CHECKED_NAMESPACE = "golden-hive";

/** Attributes WordPress itself handles on every block (block supports): never "unknown". */
const SUPPORT_ATTRS = new Set(["className", "anchor", "align", "style", "lock", "metadata"]);

/** [gh_product_rail]'s attributes (ghb_product_rail_defaults) and the values it understands. */
export const RAIL_ATTRS = [
  "title",
  "type",
  "category",
  "brand",
  "tag",
  "ids",
  "pin",
  "exclude",
  "fallback",
  "limit",
  "columns",
  "columns_tablet",
  "columns_mobile",
  "ratio",
  "fit",
];
const RAIL_TYPES = ["recent", "featured", "best_selling", "sale", "top_rated"];
const RAIL_FALLBACKS = ["menu_order", "date", "popularity", "price", "price-desc", "rating"];
const RAIL_RATIOS = ["square", "portrait", "tall", "landscape", "wide"];
const RAIL_FITS = ["cover", "contain"];
/** [gh_size_rail]'s attributes. */
export const SIZE_RAIL_ATTRS = ["title", "text", "limit", "columns"];
/** Motion hook values js/motion.js understands. */
const REVEALS = ["", "up", "down", "left", "right", "scale", "stagger"];
const SPLITS = ["chars", "words", "lines"];

const WRAPPER = "golden-hive/shortcode-wrapper";

/**
 * WordPress's block comment tokenizer, character for character (the
 * parser's own; WP_Block_Parser's is the same). Groups: 1 closer, 2
 * namespace, 3 name, 4 attributes, 6 void.
 */
const TOKENIZER =
  /<!--[ \t\f\r\n]+(\/)?wp:([a-z][a-z0-9_-]*\/)?([a-z][a-z0-9_-]*)[ \t\f\r\n]+({(?:(?=([^}]+|}+(?=})|(?!}[ \t\f\r\n]+\/?-->)[^])*)\5|[^]*?)}[ \t\f\r\n]+)?(\/)?-->/g;

interface Token {
  kind: "open" | "close" | "void";
  name: string;
  line: number;
  text: string;
}

/** Every block comment, in order, with its line. */
function tokensOf(markup: string): Token[] {
  const out: Token[] = [];
  let line = 1;
  let scanned = 0;
  for (const m of markup.matchAll(TOKENIZER)) {
    const at = m.index ?? 0;
    for (let i = scanned; i < at; i++) if (markup.charCodeAt(i) === 10) line++;
    scanned = at;
    const name = (m[2] || "core/") + m[3];
    out.push({ kind: m[1] ? "close" : m[6] ? "void" : "open", name, line, text: m[0] });
  }
  return out;
}

function lineAt(markup: string, index: number): number | null {
  if (index < 0) return null;
  let line = 1;
  for (let i = 0; i < index; i++) if (markup.charCodeAt(i) === 10) line++;
  return line;
}

const excerpt = (text: string, max = 90) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** A value's kind, as the owner reads it. */
export function kindOf(value: unknown): ValueKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "list";
  if (typeof value === "string") return "text";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "object";
}

/** Whether a value is of a JSON-schema type (or one of several), as WordPress validates a block attribute. */
export function typeOk(type: AttributeSpec["type"], value: unknown): boolean {
  if (type === undefined) return true;
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => {
    switch (t) {
      case "string":
        return typeof value === "string";
      case "boolean":
        return typeof value === "boolean";
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "integer":
        return typeof value === "number" && Number.isInteger(value);
      case "array":
        return Array.isArray(value);
      case "object":
        // PHP reads {} and [] alike: an empty list passes as an object, as WordPress takes it.
        return (typeof value === "object" && value !== null && !Array.isArray(value)) || (Array.isArray(value) && value.length === 0);
      case "null":
        return value === null;
      default:
        return true;
    }
  });
}

const ENTITIES: Record<string, string> = { quot: '"', apos: "'", amp: "&", lt: "<", gt: ">", nbsp: " " };

/** HTML entities in text read back (as PHP's html_entity_decode): shortcodes in a paragraph come with &quot; and &#8217;. */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Every [shortcode] in a piece of text: its name and attributes (page-check-core.php's reading). */
export function shortcodesIn(text: string): { name: string; atts: Record<string, string> }[] {
  const out: { name: string; atts: Record<string, string> }[] = [];
  // Typographic quotes (a paragraph's wptexturize, an LLM's habit) read as plain ones.
  const plain = decode(text).replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"');
  for (const sc of plain.matchAll(/\[([a-z0-9_-]+)((?:\s+[^\]]*?)?)\s*\/?\]/gi)) {
    const atts: Record<string, string> = {};
    for (const a of (sc[2] ?? "").matchAll(/([a-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/gi)) {
      atts[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? "";
    }
    out.push({ name: sc[1].toLowerCase(), atts });
  }
  return out;
}

/** [gh_product_rail]'s attributes: names, and values the rail would ignore or fall back from. */
export function railProblems(atts: Record<string, string>): PageProblem[] {
  const out: PageProblem[] = [];
  const bad = (attr: string, value: string, rule: RailRule) => out.push({ kind: "railValue", attr, value, rule });
  for (const [attr, raw] of Object.entries(atts)) {
    if (!RAIL_ATTRS.includes(attr)) {
      out.push({ kind: "railAttr", shortcode: "gh_product_rail", attr, known: RAIL_ATTRS });
      continue;
    }
    const v = raw.trim();
    if (v === "") continue;
    switch (attr) {
      case "type":
        if (!RAIL_TYPES.includes(v)) bad(attr, v, "type");
        break;
      case "fallback":
        if (!RAIL_FALLBACKS.includes(v)) bad(attr, v, "fallback");
        break;
      case "fit":
        if (!RAIL_FITS.includes(v)) bad(attr, v, "fit");
        break;
      case "ratio":
        if (!RAIL_RATIOS.includes(v.toLowerCase()) && !/^\d{1,2}\s*\/\s*[1-9]\d?$/.test(v)) bad(attr, v, "ratio");
        break;
      case "limit":
        if (!/^\d+$/.test(v) || Number(v) < 1) bad(attr, v, "limit");
        break;
      case "columns":
      case "columns_tablet":
      case "columns_mobile":
        if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 8) bad(attr, v, "columns");
        break;
      case "ids":
      case "pin":
      case "exclude":
        if (!/^\d+(\s*,\s*\d+)*$/.test(v)) bad(attr, v, "ids");
        break;
      case "category":
      case "brand":
      case "tag":
        if (!/^[a-z0-9-]+(\s*,\s*[a-z0-9-]+)*$/.test(v)) bad(attr, v, "slugs");
        break;
    }
  }
  return out;
}

function shortcodeProblems(text: string, block: string): PageProblem[] {
  const out: PageProblem[] = [];
  for (const sc of shortcodesIn(text)) {
    if (sc.name === "gh_product_rail") {
      if (block !== WRAPPER) out.push({ kind: "railOutsideWrapper" });
      out.push(...railProblems(sc.atts));
    } else if (sc.name === "gh_size_rail") {
      for (const attr of Object.keys(sc.atts)) {
        if (!SIZE_RAIL_ATTRS.includes(attr)) out.push({ kind: "railAttr", shortcode: "gh_size_rail", attr, known: SIZE_RAIL_ATTRS });
      }
    }
  }
  return out;
}

function motionProblems(html: string): PageProblem[] {
  const out: PageProblem[] = [];
  for (const m of html.matchAll(/data-gh-reveal(?:="([^"]*)")?/g)) {
    if (!REVEALS.includes(m[1] ?? "")) out.push({ kind: "motion", attr: "data-gh-reveal", value: m[1] ?? "" });
  }
  for (const m of html.matchAll(/data-gh-split="([^"]*)"/g)) {
    if (!SPLITS.includes(m[1])) out.push({ kind: "motion", attr: "data-gh-split", value: m[1] });
  }
  return out;
}

/** A block of the checked namespace against its registration. */
function registeredProblems(block: Parsed, spec: BlockTypeSpec | undefined): { level: PageIssue["level"]; problem: PageProblem }[] {
  if (!spec) return [{ level: "error", problem: { kind: "unknownBlock" } }];
  const out: { level: PageIssue["level"]; problem: PageProblem }[] = [];
  if (block.innerHTML.trim() !== "" || block.innerBlocks.length > 0) out.push({ level: "warning", problem: { kind: "innerHtml" } });
  const known = Object.keys(spec.attributes).filter((k) => !SUPPORT_ATTRS.has(k));
  for (const [attr, value] of Object.entries(block.attrs ?? {})) {
    if (SUPPORT_ATTRS.has(attr)) continue;
    const declared = spec.attributes[attr];
    if (!declared) {
      out.push({ level: "error", problem: { kind: "unknownAttr", attr, known } });
      continue;
    }
    if (!typeOk(declared.type, value)) {
      const expected = declared.type === undefined ? [] : Array.isArray(declared.type) ? declared.type : [declared.type];
      out.push({ level: "error", problem: { kind: "wrongType", attr, expected, got: kindOf(value) } });
      continue;
    }
    if (Array.isArray(declared.enum) && !declared.enum.some((allowed) => allowed === value)) {
      out.push({ level: "error", problem: { kind: "notAllowed", attr, allowed: declared.enum.map((v) => JSON.stringify(v)) } });
    }
  }
  return out;
}

export interface CheckOptions {
  /** The checked namespace's registered blocks; null = the registry could not be read. */
  registry: readonly BlockTypeSpec[] | null;
  namespace?: string;
}

/** Check a page's markup. Errors first, then warnings, each in page order. */
export function checkMarkup(markup: string, { registry, namespace = CHECKED_NAMESPACE }: CheckOptions): PageIssue[] {
  const bytes = new TextEncoder().encode(markup).length;
  if (bytes > MAX_MARKUP_BYTES) return [{ level: "error", at: null, problem: { kind: "tooLarge", bytes, max: MAX_MARKUP_BYTES } }];
  if (markup.trim() === "") return [{ level: "error", at: null, problem: { kind: "empty" } }];

  const issues: PageIssue[] = [];
  const add = (level: PageIssue["level"], at: BlockAt | null, problem: PageProblem) => issues.push({ level, at, problem });
  const tokens = tokensOf(markup);

  // The structure, as the parser will build it: its stack, its closers.
  const stack: Token[] = [];
  let stray = false;
  for (const token of tokens) {
    if (token.kind === "open") stack.push(token);
    else if (token.kind === "close") {
      const open = stack.pop();
      if (!open) {
        add("error", { path: [], name: token.name, line: token.line }, { kind: "strayCloser", name: token.name });
        stray = true;
        break; // WordPress stops reading blocks here: the rest is one Classic block
      }
      if (open.name !== token.name) add("error", { path: [], name: open.name, line: token.line }, { kind: "wrongCloser", name: token.name, open: open.name });
    }
  }
  if (!stray) for (const open of stack) add("warning", { path: [], name: open.name, line: open.line }, { kind: "unclosed" });

  // The parser makes blocks in the order their comments open: the n-th block met depth-first is the n-th opener.
  const openers = tokens.filter((t) => t.kind !== "close");
  let nth = 0;
  const parsed = parse(markup);
  const specs = new Map((registry ?? []).map((b) => [b.name, b]));
  let unverified = false;

  for (const block of parsed) {
    if (block.blockName === null && block.innerHTML.replace(/<!--[^]*?-->/g, "").trim() !== "") {
      // After a stray closer the rest of the page is this one Classic block: said once, above.
      if (stray && block === parsed.at(-1)) continue;
      add("warning", { path: [], name: "core/freeform", line: lineAt(markup, markup.indexOf(block.innerHTML)) }, { kind: "freeform", excerpt: excerpt(block.innerHTML) });
    }
  }

  const visit = (blocks: Parsed[], prefix: number[]) => {
    let n = 0;
    for (const block of blocks) {
      if (block.blockName === null) continue;
      n++;
      const token = openers[nth++];
      const at: BlockAt = { path: [...prefix, n], name: block.blockName, line: token?.line ?? null };
      const name = block.blockName;
      const attrs = block.attrs;

      if (attrs === null || typeof attrs !== "object" || Array.isArray(attrs)) {
        add("error", at, { kind: "badJson", excerpt: excerpt(token?.text ?? name, 140) });
      } else {
        if (name.startsWith(`${namespace}/`)) {
          if (registry === null) unverified = true;
          else for (const p of registeredProblems(block, specs.get(name))) add(p.level, at, p.problem);
        }
        let text = "";
        if (name === WRAPPER) text = typeof attrs.shortcode === "string" ? attrs.shortcode : "";
        else if (name === "core/shortcode" || name === "core/html" || name === "core/paragraph") text = block.innerHTML;
        if (text) for (const p of shortcodeProblems(text, name)) add(p.kind === "railOutsideWrapper" ? "warning" : "error", at, p);
        if (name === "core/html") for (const p of motionProblems(block.innerHTML)) add("error", at, p);
      }
      if (block.innerBlocks.length > 0) visit(block.innerBlocks, at.path);
    }
  };
  visit(parsed, []);

  if (unverified) add("error", null, { kind: "registryUnavailable", namespace });

  const rank = (i: PageIssue) => (i.level === "error" ? 0 : 1);
  const line = (i: PageIssue) => i.at?.line ?? 0;
  return issues.map((issue, i) => ({ issue, i })).sort((a, b) => rank(a.issue) - rank(b.issue) || line(a.issue) - line(b.issue) || a.i - b.i).map((x) => x.issue);
}

/** Blocks of the namespace a markup uses: whether the registry is needed at all. */
export function usesNamespace(markup: string, namespace = CHECKED_NAMESPACE): boolean {
  return markup.includes(`wp:${namespace}/`);
}
