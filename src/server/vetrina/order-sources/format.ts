import { MAX_SOURCE_ITEMS, type OrderSourceItem, type SourceParseError } from "@/lib/vetrina/order-sources";

/**
 * An order source's text, read: the agreed format (docs/order-sources.md) —
 *
 *   { "format": "woo-hub.order-source/1", "name": "…", "origin": "…",
 *     "items": [ { "sku": "DD1391-100", "name": "Nike Dunk Low Panda" }, … ] }
 *
 * — and what an LLM or a person is likely to hand over instead: the JSON in a
 * ```json fence or after a sentence, a trailing comma, several answers pasted
 * one after another (merged in that order), the last one cut short by the
 * LLM's length limit (read up to its last whole product), a bare list of
 * items or of strings, a CSV with a "sku"/"name" header, or one product per
 * line ("1. DD1391-100 Nike Dunk Low"). Items keep the text's order (or their
 * "rank", when every one has its own); the same product twice counts once.
 * Pure: order-sources.test.ts pins it down.
 */

export interface ParsedSource {
  name: string | null;
  origin: string | null;
  items: OrderSourceItem[];
  /** Items left out: the same SKU, or the same name, as an earlier one. */
  duplicates: number;
  /** JSON answers read one after another (1 for any other text). */
  parts: number;
  /** The last answer stops before its end (an LLM's length limit): read up to its last whole product. */
  truncated: boolean;
}

export type ParseResult = { ok: true; source: ParsedSource } | { ok: false; error: SourceParseError };

const MAX_SKU = 64;
const MAX_NAME = 300;

/** A string that reads as a SKU (a style code): one word, letters and digits, a digit in it. */
export function looksLikeSku(text: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9\-_/.]{2,40}$/.test(text) && /\d/.test(text);
}

/** A SKU as compared: letters and digits only, upper case ("dd1391 100" is "DD1391100"). */
export function skuKey(sku: string): string {
  return sku.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** A name as compared: no accents, lower case, words of letters and digits ("Nike Dunk Low '07" is "nike dunk low 07"). */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/['’`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

function str(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** A value under the first of these keys an object has, any case. */
function pick(obj: Record<string, unknown>, keys: readonly string[]): unknown {
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), k]));
  for (const key of keys) {
    const real = lower.get(key);
    if (real != null && obj[real] != null && obj[real] !== "") return obj[real];
  }
  return undefined;
}

const ITEMS_KEYS = ["items", "products", "prodotti", "order", "ordine", "ranking", "classifica", "list"];
const NAME_KEYS = ["name", "nome", "title", "titolo"];
const ORIGIN_KEYS = ["origin", "source", "fonte", "url", "link"];
const SKU_KEYS = ["sku", "stylecode", "style_code", "style", "code", "codice", "codice_stile", "mpn"];
const ITEM_NAME_KEYS = ["name", "nome", "title", "titolo", "product", "prodotto"];
const RANK_KEYS = ["rank", "position", "posizione", "pos"];

/** One item: a string (a SKU or a name, by its look) or an object with a SKU and/or a name. */
function itemOf(value: unknown): { item: OrderSourceItem; rank: number | null } | null {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    if (!text) return null;
    return looksLikeSku(text)
      ? { item: { sku: clip(text, MAX_SKU), name: null }, rank: null }
      : { item: { sku: null, name: clip(text, MAX_NAME) }, rank: null };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const sku = str(pick(obj, SKU_KEYS));
  const name = str(pick(obj, ITEM_NAME_KEYS));
  if (!sku && !name) return null;
  const rank = Number(pick(obj, RANK_KEYS));
  return {
    item: { sku: sku ? clip(sku, MAX_SKU) : null, name: name ? clip(name, MAX_NAME) : null },
    rank: Number.isFinite(rank) ? rank : null,
  };
}

/**
 * Where to look for JSON, in turn: inside the ```json fences, when there are
 * fences — a bracket in the sentences around them is no JSON — then the
 * whole text. Each is a list of the JSON values written at its top level, in
 * order: an LLM's answers pasted one after another (one per page of a
 * collection, or after "continua"), and the last value even when the text
 * stops inside it (`cut`: an answer that reached the LLM's length limit).
 */
function jsonSegmentSets(text: string): { text: string; cut: boolean }[][] {
  const fences = [...text.matchAll(/```[a-zA-Z]*[ \t]*\n?([\s\S]*?)(?:```|$)/g)].map((m) => m[1]);
  return fences.length > 0 ? [fences.flatMap((inner) => valuesIn(inner)), valuesIn(text)] : [valuesIn(text)];
}

function valuesIn(text: string): { text: string; cut: boolean }[] {
  const out: { text: string; cut: boolean }[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (start < 0) {
      if (c === "{" || c === "[") {
        start = i;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth += 1;
    else if (c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) {
        out.push({ text: text.slice(start, i + 1), cut: false });
        start = -1;
      }
    }
  }
  if (start >= 0) out.push({ text: text.slice(start), cut: true });
  return out;
}

/** JSON with the trailing commas and // comment lines an LLM leaves taken out. */
const relaxed = (text: string) => text.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(relaxed(text));
  }
}

/** The brackets still open at the end of a JSON text, closed; null when it ends inside a string. */
function closers(text: string): string | null {
  const open: string[] = [];
  let inString = false;
  let escaped = false;
  for (const c of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") open.push(c);
    else if (c === "}" || c === "]") open.pop();
  }
  if (inString) return null;
  return open
    .reverse()
    .map((c) => (c === "{" ? "}" : "]"))
    .join("");
}

/**
 * A JSON value the text stops inside, read up to its last whole element:
 * back to the last bracket that closes one, then every bracket still open
 * closed. The products after that one are lost — the answer did not have
 * them in full.
 */
function parseCut(text: string): unknown {
  let end = text.length;
  for (let tries = 0; tries < 500; tries++) {
    const at = Math.max(text.lastIndexOf("}", end - 1), text.lastIndexOf("]", end - 1));
    if (at <= 0) break;
    const prefix = text.slice(0, at + 1);
    const close = closers(prefix);
    if (close != null) {
      try {
        return JSON.parse(relaxed(prefix + close));
      } catch {
        // Not a whole element there: further back.
      }
    }
    end = at;
  }
  throw new Error("unreadable");
}

/** A JSON value as a source's part: its list of items (an object's, or the list itself), name and origin. */
function partOf(data: unknown): { list: unknown[]; name: string | null; origin: string | null } | null {
  let list: unknown = data;
  let name: string | null = null;
  let origin: string | null = null;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    name = str(pick(obj, NAME_KEYS));
    origin = str(pick(obj, ORIGIN_KEYS));
    // Under its usual key, or the one list it holds ({ "sneakers": [ … ] }).
    list = pick(obj, ITEMS_KEYS) ?? Object.values(obj).find((v) => Array.isArray(v));
  }
  if (!Array.isArray(list)) return null;
  // A bare list of products holds objects or words: "[1]" in a sentence is no list of products.
  const bare = list === data;
  if (bare && !list.some((v) => (typeof v === "object" && v != null) || (typeof v === "string" && v.trim().length > 1))) return null;
  return { list, name, origin };
}

/** One CSV line into fields: commas, semicolons or tabs, "quoted, fields" kept whole. */
function csvFields(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (c === delimiter) {
      out.push(field.trim());
      field = "";
    } else field += c;
  }
  out.push(field.trim());
  return out;
}

const HEADER_SKU = /^(sku|style ?code|style_code|codice|codice stile|code|mpn)$/i;
const HEADER_NAME = /^(name|nome|title|titolo|product|prodotto)$/i;
const HEADER_RANK = /^(rank|position|posizione|pos|#)$/i;

/** Text that is not JSON: a CSV with a header, or one product per line. */
function linesOf(text: string): { item: OrderSourceItem; rank: number | null }[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("//") && !/^```/.test(l));
  if (lines.length === 0) return [];
  const delimiter = ["\t", ";", ","].find((d) => lines[0].includes(d)) ?? null;
  if (delimiter) {
    const header = csvFields(lines[0], delimiter);
    const skuAt = header.findIndex((h) => HEADER_SKU.test(h));
    const nameAt = header.findIndex((h) => HEADER_NAME.test(h));
    const rankAt = header.findIndex((h) => HEADER_RANK.test(h));
    if (skuAt >= 0 || nameAt >= 0) {
      return lines.slice(1).flatMap((line) => {
        const fields = csvFields(line, delimiter);
        const sku = skuAt >= 0 ? fields[skuAt] || null : null;
        const name = nameAt >= 0 ? fields[nameAt] || null : null;
        if (!sku && !name) return [];
        const rank = rankAt >= 0 ? Number(fields[rankAt]) : NaN;
        return [{ item: { sku: sku ? clip(sku, MAX_SKU) : null, name: name ? clip(name, MAX_NAME) : null }, rank: Number.isFinite(rank) ? rank : null }];
      });
    }
  }
  return lines.flatMap((raw) => {
    // "1. ", "12) ", "#3 ", "- ", "• ": a list's own numbering, not the product's.
    const line = raw.replace(/^(?:#?\d{1,5}[.)\]:-]?\s+|[-*•·]\s+)/, "").trim();
    if (!line) return [];
    // "DD1391-100 | Nike Dunk Low", "DD1391-100; Nike…", "DD1391-100, Nike…", "DD1391-100 Nike…": a code first.
    // The name keeps the whole line: a model's number taken for a code ("Gel-1130 Blush") still matches by name.
    const split = /^([^\s|;,\t]+)\s*(?:[|;,\t]|\s-\s|\s)\s*(.+)$/.exec(line);
    if (split && looksLikeSku(split[1])) {
      const name = `${split[1]} ${split[2].replace(/^[|;,\t-]\s*/, "")}`.trim();
      return [{ item: { sku: clip(split[1], MAX_SKU), name: clip(name, MAX_NAME) }, rank: null }];
    }
    const one = itemOf(line);
    return one ? [one] : [];
  });
}

/** Read a source's text. */
export function parseOrderSource(text: string): ParseResult {
  const body = text.replace(/^﻿/, "").trim();
  if (!body) return { ok: false, error: "empty" };

  let name: string | null = null;
  let origin: string | null = null;
  let raw: { item: OrderSourceItem; rank: number | null }[] | null = null;
  let parts = 0;
  let truncated = false;

  for (const segments of jsonSegmentSets(body)) {
    for (const segment of segments) {
      let data: unknown;
      try {
        data = segment.cut ? parseCut(segment.text) : parseJson(segment.text);
      } catch {
        continue;
      }
      const part = partOf(data);
      if (!part) continue;
      parts += 1;
      truncated ||= segment.cut;
      name ??= part.name;
      origin ??= part.origin;
      raw = [
        ...(raw ?? []),
        ...part.list.flatMap((value) => {
          const one = itemOf(value);
          return one ? [one] : [];
        }),
      ];
    }
    if (raw != null) break;
  }
  // Brackets but no JSON in them that reads: said so, rather than taking each line for a product.
  if (raw == null && /^\s*(```[a-z]*\s*)?[[{]/i.test(body)) return { ok: false, error: "invalidJson" };
  raw ??= linesOf(body);

  // A rank on every item, each its own, orders them; otherwise the text's order is the order
  // (answers pasted one after another each count from 1).
  if (raw.length > 0 && raw.every((r) => r.rank != null) && new Set(raw.map((r) => r.rank)).size === raw.length) {
    raw = raw.map((r, i) => ({ ...r, i })).sort((a, b) => a.rank! - b.rank! || a.i - b.i);
  }

  const seen = new Set<string>();
  const items: OrderSourceItem[] = [];
  let duplicates = 0;
  for (const { item } of raw) {
    const keys = [item.sku ? `s:${skuKey(item.sku)}` : null, !item.sku && item.name ? `n:${nameKey(item.name)}` : null].filter(
      (k): k is string => k != null && k.length > 2,
    );
    if (keys.length > 0 && keys.some((k) => seen.has(k))) {
      duplicates += 1;
      continue;
    }
    for (const k of keys) seen.add(k);
    items.push(item);
  }
  if (items.length === 0) return { ok: false, error: "noItems" };
  if (items.length > MAX_SOURCE_ITEMS) return { ok: false, error: "tooMany" };
  return {
    ok: true,
    source: {
      name: name ? clip(name, 80) : null,
      origin: origin ? clip(origin, 500) : null,
      items,
      duplicates,
      parts: Math.max(parts, 1),
      truncated,
    },
  };
}
