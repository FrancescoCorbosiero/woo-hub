import { skuKey } from "./skus";

/**
 * "Aggiungi prodotti": the Vetrina's one way in for new products. The owner
 * types, scans or pastes codes — one or hundreds — and the Hub works out,
 * code by code, how each comes in:
 *
 *   the shop has it already            → onStore      nothing to add
 *   the supplier's feed carries it     → feed         one tap: the feed's sizes, stock and prices
 *   the Hub's catalog has it (KicksDB) → catalog      one tap: KicksDB's sizes, the margins' prices
 *   KicksDB knows it                   → kicksdb      one tap: the same, read from KicksDB first
 *   known, without a size the shop
 *   sells (EU)                         → noSizes      made by hand, starting from what is known
 *   the feed listed it, sells it no
 *   more                               → delisted     made by hand, starting from what is known
 *   nobody knows it                    → unknown      made by hand
 *   KicksDB did not answer             → unreachable  looked up again
 *
 * Whatever the way in, a product has exactly one owner afterwards — the one
 * that brought it (src/server/vetrina/sources.ts): the feed, KicksDB, or the
 * shop itself for one made by hand, which no source ever writes to.
 *
 * Pure: shared by the screen and the server.
 */

export type AddRoute = "onStore" | "feed" | "catalog" | "kicksdb" | "noSizes" | "delisted" | "unknown" | "unreachable";

/** One code, looked up. */
export interface AddLookup {
  /** As the owner wrote it. */
  sku: string;
  route: AddRoute;
  /** What is known of it — nothing for an unknown code. */
  title: string | null;
  brand: string | null;
  image: string | null;
  /** The sizes the shop would get: the EU ones (the feed's, those it has in stock). */
  sizes: number;
  /** On the shop already: the product, to open. */
  productId: number | null;
}

/** The routes added with one tap. */
export const ONE_TAP: ReadonlySet<AddRoute> = new Set(["feed", "catalog", "kicksdb"]);
/** The routes made by hand. */
export const BY_HAND: ReadonlySet<AddRoute> = new Set(["noSizes", "delisted", "unknown"]);

/** Codes looked up per request: each the Hub does not know is a KicksDB call. */
export const LOOKUP_BATCH = 20;
/** Codes one entry takes: a longer paste is a file's job, and says so. */
export const MAX_ENTRIES = 500;
/** Codes added per request, as the publish screens do: each is a product made on the shop. */
export const ADD_BATCH = 25;

/**
 * An add's report for a code that never reached Publish: KicksDB said it has
 * no such product, or did not answer. Codes, not sentences: the screen words them.
 */
export const NOT_ON_KICKSDB = "add:not-on-kicksdb";
export const KICKSDB_UNREACHABLE = "add:kicksdb-unreachable";

/** The longest code taken: anything longer is a sentence, not a code. */
const MAX_CODE = 64;
/** A code on its own, as the catalog writes them: letters, digits, dashes, at least one digit. */
const CODE = /^[A-Z0-9][A-Z0-9._/-]{3,39}$/i;
/** A column's header naming its cells as codes: the column a table's codes are read from. */
const CODE_HEADERS = new Set([
  "SKU", "SKUS", "CODICE", "CODICI", "CODE", "CODES", "STYLE", "STYLE CODE", "STYLECODE", "STYLE_CODE",
  "ARTICOLO", "COD", "COD.", "MPN", "CODICE PRODOTTO", "CODICE ARTICOLO", "PRODUCT CODE",
]);
/** A column's header pasted with its codes — never a product. */
const HEADERS = new Set([...CODE_HEADERS, "MODELLO", "MODEL"]);

/**
 * The codes in what the owner wrote: one per line, or several separated by
 * commas, semicolons or tabs (a column pasted from a spreadsheet). A line of
 * codes separated by spaces is split too — but only when every part looks
 * like a code: "DD1391 100" is one code written with a space, which the
 * lookup also tries with a dash. A pasted header ("SKU") is dropped.
 * Repeated codes count once, as first written.
 */
export function splitEntry(text: string): string[] {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    for (const cell of line.split(/[,;\t|]/)) {
      const part = cell.trim().replace(/^["'“”]+|["'“”]+$/g, "").replace(/\s+/g, " ").trim();
      if (!part || part.length > MAX_CODE) continue;
      const pieces = part.split(" ");
      const codes = pieces.length > 1 && pieces.every((p) => CODE.test(p) && /\d/.test(p)) ? pieces : [part];
      for (const code of codes) {
        if (HEADERS.has(code.toUpperCase())) continue;
        const key = skuKey(code);
        if (!out.has(key)) out.set(key, code);
      }
    }
  }
  return [...out.values()];
}

/** The lookups grouped as the screen lists them: ready first, then by hand, then the rest. */
export function groupLookups(lookups: readonly AddLookup[]): {
  ready: AddLookup[];
  byHand: AddLookup[];
  onStore: AddLookup[];
  unreachable: AddLookup[];
} {
  return {
    ready: lookups.filter((l) => ONE_TAP.has(l.route)),
    byHand: lookups.filter((l) => BY_HAND.has(l.route)),
    onStore: lookups.filter((l) => l.route === "onStore"),
    unreachable: lookups.filter((l) => l.route === "unreachable"),
  };
}

/** One row of a table, its cells split on `delimiter` — a quoted cell keeps its delimiters ("a, b"). */
export function splitRow(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

/**
 * The codes in what the owner wrote or chose: a plain list (splitEntry), or
 * a table — a CSV file, or cells pasted from a spreadsheet — whose other
 * columns (a name, a price) are not codes. A table's codes are its column
 * headed like one ("SKU", "Codice"…), else its first. It is a table when it
 * has such a header, when its cells are tab-separated (a spreadsheet's
 * paste), or when every one of three lines or more has the same cells: a
 * CSV. A line of codes separated by commas stays a list.
 */
export function codesIn(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const [delimiter] = ["\t", ";", ","]
    .map((d) => [d, splitRow(lines[0], d).length - 1] as const)
    .sort((a, b) => b[1] - a[1])[0];
  const rows = lines.map((l) => splitRow(l, delimiter));
  const headed = rows.length > 1 ? rows[0].findIndex((c) => CODE_HEADERS.has(c.trim().toUpperCase())) : -1;
  const width = rows[0].length;
  const table =
    headed >= 0 ||
    (width > 1 && delimiter === "\t") ||
    (width > 1 && rows.length >= 3 && rows.every((r) => r.length === width));
  if (!table) return splitEntry(text);
  const column = Math.max(headed, 0);
  return splitEntry(rows.slice(headed >= 0 ? 1 : 0).map((r) => (r[column] ?? "").replace(/[,;\t]/g, " ")).join("\n"));
}
