import { ONE_SIZE, type HandmadeInput } from "./handmade";
import { skuKey } from "./skus";

/**
 * A product sheet: a spreadsheet of products — a CSV file, or cells pasted
 * from Excel or Google Sheets — given to "Aggiungi prodotti" instead of a
 * list of codes. Its columns are recognised by their headers, in Italian or
 * English ("Codice", "SKU"; "Nome", "Title"; "Taglia", "Size"; "Prezzo",
 * "Price"…), whatever their order, and its rows grouped into products by
 * code: one row a product, or one row a size (a row with no code continues
 * the product above, as exports write them).
 *
 * The codes go through the look-up like any others: one a source knows
 * comes in from that source — the sheet's words and prices for it are not
 * used, its owner is the source. Only the codes nobody knows are made from
 * the sheet, by hand: at once when the sheet says all a product needs (a
 * name, and a price for each size), else in the form, filled in from it.
 *
 * Pure: shared by the screen and its tests.
 */

export type SheetColumn =
  | "sku"
  | "title"
  | "brand"
  | "category"
  | "description"
  | "size"
  | "price"
  | "stock"
  | "barcode"
  | "photos"
  | "seoTitle"
  | "seoDescription"
  | "slug"
  | "visible";

/** The headers each column goes by, written without accents, spaces or punctuation. */
const HEADERS: Record<SheetColumn, readonly string[]> = {
  sku: ["sku", "skus", "codice", "codici", "code", "stylecode", "style", "articolo", "codicearticolo", "codiceprodotto", "productcode", "mpn", "cod"],
  title: ["nome", "name", "titolo", "title", "prodotto", "product", "productname", "nomeprodotto", "articolonome"],
  brand: ["marca", "brand", "marchio", "produttore", "manufacturer", "brandname"],
  category: ["categoria", "categorie", "category", "categories", "reparto", "collezione"],
  description: ["descrizione", "description", "desc", "dettagli", "details", "testo", "body"],
  size: ["taglia", "taglie", "size", "sizes", "misura", "misure", "eu", "tagliaeu", "sizeeu", "eusize", "numero"],
  price: ["prezzo", "price", "prezzovendita", "regularprice", "prezzoeuro", "prezzoeur", "eur", "euro", "importo"],
  stock: ["pezzi", "quantita", "qty", "quantity", "stock", "giacenza", "disponibilita", "inventory", "pz"],
  barcode: ["barcode", "ean", "ean13", "gtin", "upc", "codiceabarre", "codicebarre"],
  photos: ["foto", "fotos", "immagine", "immagini", "image", "images", "imageurl", "imageurls", "img", "photo", "photos", "fotourl", "url foto"],
  seoTitle: ["titoloseo", "seotitle", "metatitle", "titologoogle"],
  seoDescription: ["descrizioneseo", "seodescription", "metadescription", "descrizionegoogle"],
  slug: ["slug", "indirizzo", "permalink", "handle"],
  visible: ["visibile", "visible", "pubblicato", "published", "stato", "status", "invendita"],
};

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

/** The column a header names, or null for one the sheet's reading leaves aside. */
export function headerColumn(cell: string): SheetColumn | null {
  const key = plain(cell);
  if (!key) return null;
  for (const [column, names] of Object.entries(HEADERS) as [SheetColumn, readonly string[]][]) {
    if (names.some((name) => plain(name) === key)) return column;
  }
  return null;
}

/**
 * A table's cells: rows split on `delimiter`, a quoted cell keeping its
 * delimiters, quotes ("") and line breaks — a description over three lines
 * stays one cell.
 */
export function parseTable(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

/** The delimiter a table's first line uses most: a tab (a spreadsheet's paste), a semicolon (Excel in Italian), a comma. */
export function tableDelimiter(text: string): string {
  const first = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const counts = ["\t", ";", ","].map((d) => [d, first.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * An amount as a shop writes it: "149,90", "149.90", "€ 1.234,50",
 * "1,234.50". The last separator followed by one or two digits is the
 * decimal one; the others group thousands. Null when it does not read.
 */
export function parseAmount(raw: string): number | null {
  const text = raw.replace(/[€$£\s]|eur(o)?/gi, "");
  if (!/^\d[\d.,]*$/.test(text)) return null;
  const decimal = text.match(/[.,](\d{1,2})$/);
  const whole = decimal ? text.slice(0, -decimal[0].length) : text;
  if (!/^\d{1,3}([.,]\d{3})*$|^\d+$/.test(whole)) return null;
  const value = Number(`${whole.replace(/[.,]/g, "")}${decimal ? `.${decimal[1]}` : ""}`);
  return Number.isFinite(value) ? value : null;
}

/** Pieces: a whole number, never below 0. Null when it does not read. */
export function parseCount(raw: string): number | null {
  const text = raw.trim().replace(/[.\s]/g, "");
  if (!/^-?\d+$/.test(text)) return null;
  return Math.max(0, Number.parseInt(text, 10));
}

const YES = new Set(["si", "sì", "yes", "y", "true", "1", "pubblicato", "publish", "published", "visibile", "visible", "invendita", "attivo", "active"]);
const NO = new Set(["no", "n", "false", "0", "bozza", "draft", "nascosto", "hidden", "private", "privato", "nonvisibile", "inattivo", "inactive"]);

function parseYesNo(raw: string): boolean | null {
  const key = plain(raw);
  if (!key) return null;
  if (YES.has(key)) return true;
  if (NO.has(key)) return false;
  return null;
}

/** Several sizes in one cell: "40, 41, 42.5" or "S|M|L" — never "42,5", one EU size written with a comma. */
export function splitSizes(cell: string): string[] {
  return cell
    .split(/\s*[|;]\s*|,\s+|\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface SheetSize {
  label: string;
  price: number | null;
  stock: number | null;
  barcode: string;
}

export interface SheetProduct {
  sku: string;
  /** The sheet's rows it came from, numbered as the spreadsheet numbers them (the header is 1). */
  rows: number[];
  title: string;
  brand: string;
  /** Category names or paths ("Scarpe > Sneakers"), as written. */
  categories: string[];
  description: string;
  sizes: SheetSize[];
  photos: string[];
  seo: { title: string; description: string; slug: string };
  visible: boolean | null;
}

export interface ProductSheet {
  columns: SheetColumn[];
  products: SheetProduct[];
  /** Rows with values but no code, before any product: nothing to attach them to. */
  unattached: number[];
}

/**
 * The products in a sheet, or null when the text is not one: a sheet's
 * header names a code column and something a product is made of — a name,
 * or a price. A list of codes, a column of them, is not a sheet.
 */
export function readProductSheet(text: string): ProductSheet | null {
  if (!text.trim()) return null;
  const rows = parseTable(text, tableDelimiter(text));
  if (rows.length < 2) return null;
  const columns = rows[0].map(headerColumn);
  const at = (column: SheetColumn) => columns.indexOf(column);
  if (at("sku") < 0 || (at("title") < 0 && at("price") < 0)) return null;

  const products = new Map<string, SheetProduct>();
  const unattached: number[] = [];
  let current: SheetProduct | null = null;
  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const cell = (column: SheetColumn) => (at(column) >= 0 ? (cells[at(column)] ?? "").trim() : "");
    const code = cell("sku");
    if (code) {
      const key = skuKey(code);
      current = products.get(key) ?? null;
      if (!current) {
        current = {
          sku: code,
          rows: [],
          title: "",
          brand: "",
          categories: [],
          description: "",
          sizes: [],
          photos: [],
          seo: { title: "", description: "", slug: "" },
          visible: null,
        };
        products.set(key, current);
      }
    } else if (!current) {
      unattached.push(line);
      return;
    }
    const product: SheetProduct = current!;
    product.rows.push(line);
    product.title ||= cell("title");
    product.brand ||= cell("brand");
    product.description ||= cell("description");
    product.seo.title ||= cell("seoTitle");
    product.seo.description ||= cell("seoDescription");
    product.seo.slug ||= cell("slug");
    if (product.visible == null) product.visible = parseYesNo(cell("visible"));
    for (const name of cell("category").split(/\s*[|;,]\s*/).filter(Boolean)) {
      if (!product.categories.includes(name)) product.categories.push(name);
    }
    for (const url of cell("photos").split(/[\s|,;]+/).filter((u) => /^https?:\/\/\S+$/i.test(u))) {
      if (!product.photos.includes(url)) product.photos.push(url);
    }
    const price = cell("price") ? parseAmount(cell("price")) : null;
    const stock = cell("stock") ? parseCount(cell("stock")) : null;
    const barcode = cell("barcode").replace(/\s/g, "");
    const labels = splitSizes(cell("size"));
    if (labels.length === 0 && (cell("price") || cell("stock") || barcode)) labels.push(ONE_SIZE);
    for (const label of labels) {
      if (product.sizes.some((s) => s.label.toUpperCase() === label.toUpperCase())) continue;
      // A barcode is one size's: a row of several sizes leaves it out.
      product.sizes.push({ label, price, stock, barcode: labels.length === 1 ? barcode : "" });
    }
  });
  for (const product of products.values()) {
    // "One size" next to real sizes: a row that only repeated the product's price.
    if (product.sizes.length > 1) product.sizes = product.sizes.filter((s) => s.label !== ONE_SIZE);
  }
  return { columns: columns.filter((c): c is SheetColumn => c != null), products: [...products.values()], unattached };
}

/** A category's name or path, as one key: "Scarpe › Sneakers", "scarpe > sneakers" and "Scarpe/Sneakers" are one. */
export function categoryKey(text: string): string {
  return text
    .split(/\s*[›>/]\s*/)
    .map(plain)
    .filter(Boolean)
    .join(">");
}

/**
 * The shop's categories a sheet names: by their whole path, or by their own
 * name when only one category has it. A name the shop has no category for
 * is left out, and said: categories are the shop's, never made up here.
 */
export function matchCategories(
  names: readonly string[],
  shop: readonly { id: number; path: string }[],
): { ids: number[]; unknown: string[] } {
  const byPath = new Map(shop.map((c) => [categoryKey(c.path), c.id]));
  const byName = new Map<string, number[]>();
  for (const c of shop) {
    const own = categoryKey(c.path).split(">").at(-1) ?? "";
    byName.set(own, [...(byName.get(own) ?? []), c.id]);
  }
  const ids: number[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const key = categoryKey(name);
    const id = byPath.get(key) ?? (byName.get(key)?.length === 1 ? byName.get(key)![0] : undefined);
    if (id == null) unknown.push(name);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, unknown };
}

/**
 * A sheet's product as the form's: what "Crea" sends, or what the form opens
 * with. A size without pieces counts one; without a price it has none, which
 * the check refuses — and the form asks for.
 */
export function sheetToHandmade(product: SheetProduct, categoryIds: readonly number[]): HandmadeInput {
  return {
    sku: product.sku,
    title: product.title,
    brand: product.brand,
    categoryIds: [...categoryIds],
    description: product.description,
    photos: product.photos.map((url) => ({ url })),
    sizes: product.sizes.map((s) => ({ label: s.label, price: s.price ?? 0, stock: s.stock ?? 1, barcode: s.barcode })),
    seo: product.seo,
    visible: product.visible ?? true,
  };
}
