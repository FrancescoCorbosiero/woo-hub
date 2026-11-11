import { z } from "zod";

/**
 * A product made by hand ("Aggiungi prodotti", a code nobody knows): what
 * the owner fills in, checked the same way by the screen and the server.
 * The shop owns it from then on — no source writes to it — so everything a
 * source would bring is the owner's: photos, words, sizes, prices, stock.
 *
 * Its shape is the shop's own, the one every product the Hub makes has: a
 * variable product whose sizes are pa_taglia ("Taglia unica" is one size),
 * each size its own SKU, the stock counted.
 *
 * Pure: shared by the screen and the server.
 */

/** The size of a product that comes in one. */
export const ONE_SIZE = "Unica";

export const HANDMADE_LIMITS = {
  title: 200,
  sku: 64,
  brand: 100,
  description: 20_000,
  sizes: 60,
  sizeLabel: 20,
  photos: 12,
  categories: 10,
  price: 100_000,
  stock: 100_000,
  /** What Google shows of each before it cuts: past these the screen warns. */
  seoTitle: 60,
  seoDescription: 160,
  slug: 190,
} as const;

const Size = z.object({
  label: z.string().trim().min(1).max(HANDMADE_LIMITS.sizeLabel),
  price: z.number().positive().max(HANDMADE_LIMITS.price),
  stock: z.number().int().min(0).max(HANDMADE_LIMITS.stock),
  barcode: z.string().trim().max(20).default(""),
});

/** A photo uploaded to the library (its id), or one the shop downloads (an address). */
const Photo = z.union([
  z.object({ id: z.number().int().positive(), url: z.string().default("") }),
  z.object({ url: z.url({ protocol: /^https?$/ }) }),
]);

export const HandmadeSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1)
    .max(HANDMADE_LIMITS.sku)
    .regex(/^[^\s,;]+$/, "a code has no spaces, commas or semicolons"),
  title: z.string().trim().min(1).max(HANDMADE_LIMITS.title),
  brand: z.string().trim().max(HANDMADE_LIMITS.brand).default(""),
  categoryIds: z.array(z.number().int().positive()).max(HANDMADE_LIMITS.categories).default([]),
  description: z.string().max(HANDMADE_LIMITS.description).default(""),
  photos: z.array(Photo).max(HANDMADE_LIMITS.photos).default([]),
  sizes: z.array(Size).min(1).max(HANDMADE_LIMITS.sizes),
  seo: z
    .object({
      title: z.string().trim().max(200).default(""),
      description: z.string().trim().max(500).default(""),
      slug: z.string().trim().max(HANDMADE_LIMITS.slug).default(""),
    })
    .default({ title: "", description: "", slug: "" }),
  /** On sale as soon as it has a photo; off, it is made hidden. */
  visible: z.boolean(),
});

export type HandmadeInput = z.input<typeof HandmadeSchema>;
export type HandmadeProduct = z.output<typeof HandmadeSchema>;
export type HandmadePhoto = HandmadeProduct["photos"][number];

/** What the form has wrong, by field: the screen marks each. */
export type HandmadeField = "sku" | "title" | "brand" | "categoryIds" | "description" | "photos" | "sizes" | "seo" | "visible";

export function checkHandmade(input: unknown): { ok: true; product: HandmadeProduct } | { ok: false; invalid: HandmadeField[] } {
  const parsed = HandmadeSchema.safeParse(input);
  if (!parsed.success) {
    const invalid = new Set<HandmadeField>();
    for (const issue of parsed.error.issues) invalid.add((issue.path[0] as HandmadeField | undefined) ?? "title");
    return { ok: false, invalid: [...invalid] };
  }
  if (duplicateSizes(parsed.data.sizes.map((s) => s.label)).length > 0) return { ok: false, invalid: ["sizes"] };
  return { ok: true, product: parsed.data };
}

/* ---------------------------------------------------------------- *
 * Sizes
 * ---------------------------------------------------------------- */

/** An EU shoe size: "42", "42.5", "42,5", "36 2/3" — what the shop's size filter sorts as numbers. */
export function isEuSize(label: string): boolean {
  const s = label.trim();
  const m = s.match(/^(\d{2})(?:[.,](\d{1,2}))?$/) ?? s.match(/^(\d{2})\s+[12]\/3$/);
  if (!m) return false;
  const whole = Number(m[1]);
  return whole >= 15 && whole <= 55;
}

/** A size as one key: the EU ones by value ("42,5" is "42.5"), the others by their letters. */
export function sizeKey(label: string): string {
  const s = label.trim();
  if (isEuSize(s)) {
    const third = s.match(/^(\d{2})\s+([12])\/3$/);
    if (third) return String(Math.round((Number(third[1]) + Number(third[2]) / 3) * 100) / 100);
    return String(Number(s.replace(",", ".")));
  }
  return s.replace(/\s+/g, " ").toUpperCase();
}

/** Sizes written twice ("42" and "42,0"): a product has each once. */
export function duplicateSizes(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const label of labels) {
    const key = sizeKey(label);
    if (seen.has(key)) twice.add(label.trim());
    seen.add(key);
  }
  return [...twice];
}

/** The clothes sizes, smallest first: they sort by this, not by their letters. */
export const LETTER_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"] as const;
/** The EU shoe sizes offered in a tap — the usual run; any other is typed. */
export const EU_SIZES = [
  "35.5", "36", "36.5", "37.5", "38", "38.5", "39", "40", "40.5", "41", "42", "42.5",
  "43", "44", "44.5", "45", "45.5", "46", "47", "47.5", "48.5",
] as const;

/** Sizes in the order the shop shows them: EU by value, then clothes, then the rest by name. */
export function sortSizes<T>(items: readonly T[], label: (item: T) => string): T[] {
  const rank = (raw: string): [number, number, string] => {
    const s = raw.trim();
    if (isEuSize(s)) return [0, Number(sizeKey(s)), ""];
    const letter = LETTER_SIZES.indexOf(s.toUpperCase().replace(/^XXXL$/, "3XL").replace(/^XXXXL$/, "4XL") as (typeof LETTER_SIZES)[number]);
    if (letter >= 0) return [1, letter, ""];
    return [2, 0, s.toLowerCase()];
  };
  return [...items].sort((a, b) => {
    const [ga, na, sa] = rank(label(a));
    const [gb, nb, sb] = rank(label(b));
    return ga - gb || na - nb || sa.localeCompare(sb);
  });
}

/* ---------------------------------------------------------------- *
 * Words for Google
 * ---------------------------------------------------------------- */

/** The address of a product, from its name: "Nike Dunk Low «Panda»" → "nike-dunk-low-panda". */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, HANDMADE_LIMITS.slug)
    .replace(/-+$/, "");
}

/** The description's start, as Google would show it: whole words, cut with "…". */
export function snippet(text: string, max: number = HANDMADE_LIMITS.seoDescription): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

/** The owner's text as the product page's: a blank line starts a paragraph, a line break stays one. */
export function paragraphs(text: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.split("\n").map(escape).join("<br>\n")}</p>`)
    .join("\n");
}

/** A code for a product that has none: "HM-" and six letters or digits, never 0/O or 1/I. */
export function generateSku(random: (n: number) => number = (n) => Math.floor(Math.random() * n)): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let out = "HM-";
  for (let i = 0; i < 6; i++) out += alphabet[random(alphabet.length)];
  return out;
}
