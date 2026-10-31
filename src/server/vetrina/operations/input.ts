import "server-only";
import { z } from "zod";
import { CATALOG_SORTS, PRODUCT_SOURCES, QUICK_VIEWS } from "@/lib/vetrina/catalog";
import {
  MARGIN_PERCENT_MAX,
  MARGIN_PERCENT_MIN,
  MAX_OPERATION_PRODUCTS,
  type OperationInput,
  type OperationTarget,
  type TermKey,
} from "@/lib/vetrina/catalog-ops";
import { shopToday } from "./service";
import { words, type Words } from "./words";

/**
 * What the screens may ask of the catalog's actions, checked before anything
 * runs (src/server/actions/vetrina-operations.ts). Kept apart from the
 * actions file, which may only export async functions.
 */

/**
 * The problems the owner can fix, by key: the schemas are built once, so
 * they carry the key and the words come in the request's language when one
 * is met. Anything else is a screen's bug, and reads "Richiesta non valida".
 */
type Problem = Exclude<keyof Words["input"], "invalid" | "operation"> | "empty" | "tooMany";
const PROBLEMS = new Set<string>(["term", "termTarget", "date", "pastDate", "percent", "tagName", "marginPercent", "empty", "tooMany"]);
const problem = (key: Problem) => key;

const Id = z.number().int().positive();

// The descriptions are for whoever asks from outside the screens (the API, an assistant): the JSON Schema carries them.
const TermKeySchema = z
  .string()
  .regex(/^(category|brand):[1-9]\d{0,9}$/, problem("term"))
  .transform((key) => key as TermKey)
  .describe('A whole category or brand ("category:12", "brand:7"): the action is that term\'s own, and its target must be exactly its query.');

/** A catalog list's query, as the screen holds it: no page (offset, limit) — an action takes every match. */
const QuerySchema = z
  .object({
    taxonomy: z.enum(["category", "brand"]).optional().describe("With termId: a category's or brand's products, its sub-terms' included."),
    termId: Id.optional(),
    view: z.enum(QUICK_VIEWS).optional().describe("A ready-made list: sold out, on sale, hidden, without a photo, without a category, not published."),
    q: z.string().max(100).optional().describe("Name or SKU, any case."),
    stock: z.enum(["instock", "outofstock"]).optional(),
    visibility: z.enum(["visible", "hidden"]).optional(),
    onSale: z.boolean().optional(),
    within: Id.optional().describe("A term of the other taxonomy: the brands inside a category, the categories inside a brand."),
    source: z
      .enum(PRODUCT_SOURCES)
      .optional()
      .describe(
        "Where the products come from: goldensneakers (the supplier's feed carries them), kicksdb (added from the Hub), delisted (the feed dropped them), woo (made in the shop).",
      ),
    sort: z.enum(CATALOG_SORTS).optional(),
  })
  // A term without its taxonomy would quietly read as a category.
  .refine((q) => q.termId == null || q.taxonomy != null, { message: problem("term") })
  .describe("Every product the catalog query matches when the action runs.");

export const TargetSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("ids"),
      ids: z
        .array(Id)
        .min(1, problem("empty"))
        .superRefine((ids, ctx) => {
          if (ids.length > MAX_OPERATION_PRODUCTS) ctx.addIssue({ code: "custom", message: problem("tooMany") });
        }),
    }),
    z.object({ kind: z.literal("query"), query: QuerySchema }),
  ])
  .describe(`The products it acts on: these ids (at most ${MAX_OPERATION_PRODUCTS}), or every match of a catalog query.`);

const isDay = (value: string) => {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
};

const EndsOn = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, problem("date"))
  .refine(isDay, problem("date"))
  // Today is fine: the sale lasts to the end of it.
  .refine((day) => day >= shopToday(), problem("pastDate"))
  .nullable();

const Percent = z.number().int(problem("percent")).min(1, problem("percent")).max(90, problem("percent"));

/** A term's margin, whole percents; null hands the term back to the standard one. */
const MarginPercent = z
  .number()
  .int(problem("marginPercent"))
  .min(MARGIN_PERCENT_MIN, problem("marginPercent"))
  .max(MARGIN_PERCENT_MAX, problem("marginPercent"))
  .nullable();

/**
 * A whole term's action (filed under its key, so its screen shows it) acts
 * on exactly that term's products: its own query, with no search, chip or
 * view narrowing it — else the screen would show the whole term hidden, or
 * on sale, for a part of it.
 */
function wholeTerm(input: { target: OperationTarget; termKey?: TermKey }): boolean {
  if (!input.termKey) return true;
  if (input.target.kind !== "query") return false;
  const [taxonomy, id] = input.termKey.split(":");
  const { taxonomy: qt, termId, sort: _sort, ...narrowing } = input.target.query;
  return qt === taxonomy && termId === Number(id) && Object.values(narrowing).every((v) => v == null || v === "");
}
const WHOLE_TERM = { message: problem("termTarget"), path: ["termKey"] };

export const OperationInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hide"), target: TargetSchema, termKey: TermKeySchema.optional() }).refine(wholeTerm, WHOLE_TERM),
  z.object({
    kind: z.literal("show"),
    target: TargetSchema,
    keepHeld: z.boolean().optional(),
    restore: z.boolean().optional(),
  }),
  z
    .object({
      kind: z.literal("sale"),
      target: TargetSchema,
      percent: Percent,
      rounding: z.enum(["charm", "exact"]),
      endsOn: EndsOn,
      termKey: TermKeySchema.optional(),
    })
    .refine(wholeTerm, WHOLE_TERM),
  z.object({ kind: z.literal("unsale"), target: TargetSchema, termKey: TermKeySchema.optional() }).refine(wholeTerm, WHOLE_TERM),
  z.object({
    kind: z.literal("tag"),
    target: TargetSchema,
    tag: z.object({ id: Id.optional(), name: z.string().trim().min(1, problem("tagName")).max(120) }),
  }),
  z.object({ kind: z.literal("untag"), target: TargetSchema, tagId: Id }),
  z.object({ kind: z.literal("categorize"), target: TargetSchema, categoryId: Id }),
  z.object({ kind: z.literal("uncategorize"), target: TargetSchema, categoryId: Id }),
  z.object({ kind: z.literal("pin"), target: TargetSchema, sectionKey: z.string().min(3).max(300) }),
  z.object({
    kind: z.literal("margin"),
    taxonomy: z.enum(["category", "brand"], { message: problem("term") }),
    termId: z.number({ message: problem("term") }).int(problem("term")).positive(problem("term")),
    percent: MarginPercent,
  }),
  z.object({
    kind: z.literal("order"),
    target: TargetSchema,
    term: z.object({ taxonomy: z.enum(["category", "brand"], { message: problem("term") }), id: Id }),
    position: z.number().int().min(1).max(1_000_000).nullable(),
    reorder: z.literal(true).optional(),
  }),
  z.object({
    kind: z.literal("sourceOrder"),
    sourceId: z.uuid(),
    term: z.object({ taxonomy: z.enum(["category", "brand"], { message: problem("term") }), id: Id }).nullable(),
  }),
  z.object({ kind: z.literal("delete"), target: TargetSchema }),
]);

/** A problem met, in the owner's words: ours by key, zod's own as "Richiesta non valida". */
function say(message: string | undefined, input: unknown): string {
  const w = words();
  if (!message || !PROBLEMS.has(message)) return w.input.invalid;
  if (message === "empty") return w.error.empty;
  if (message === "tooMany") {
    const ids = (input as { target?: { ids?: unknown[] } } | null)?.target?.ids;
    return w.error.tooMany(Array.isArray(ids) ? ids.length : MAX_OPERATION_PRODUCTS + 1);
  }
  return w.input[message as Exclude<Problem, "empty" | "tooMany">];
}

/** An action's input, checked; else the first problem, in words when it is one the owner can fix. */
export function parseOperationInput(input: unknown): { ok: true; data: OperationInput } | { ok: false; error: string } {
  const parsed = OperationInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data as OperationInput };
  return { ok: false, error: say(parsed.error.issues[0]?.message, input) };
}

/** Some products to list the homepage's sections for; else null (none asked, or not valid: the plain list). */
export function parseTarget(input: unknown): OperationTarget | null {
  const parsed = TargetSchema.safeParse(input);
  return parsed.success ? (parsed.data as OperationTarget) : null;
}
