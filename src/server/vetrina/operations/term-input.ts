import "server-only";
import { z } from "zod";
import type { TermActionInput } from "@/lib/vetrina/term-ops";
import { words } from "./words";

/**
 * The taxonomy actions done at once (terms.ts) as anyone may ask them — the
 * screens, the API, an assistant — checked before anything runs. The
 * store's own checks (is the term there, is the name free under that
 * parent) come after, in the assessment. Merging and deleting are catalog
 * actions (input.ts): they touch products.
 */

/** WordPress keeps a term's name in 200 characters; a shop's are far shorter. */
export const TERM_NAME_MAX = 120;

const Id = z.number().int().positive();
const Taxonomy = z.enum(["category", "brand", "tag"]).describe("product_cat, product_brand or product_tag.");
const Name = z.string().trim().min(1).max(TERM_NAME_MAX).describe("The term's name; under one parent, names are unique (WordPress ignores case).");
const TermId = Id.describe("The term, as GET /api/v1/catalog/terms lists it.");

export const TermActionInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("termCreate"),
    taxonomy: Taxonomy,
    name: Name,
    parent: z.number().int().min(0).nullish().describe("The term it goes under (categories and brands); absent, null or 0 = the top level."),
  }),
  z.object({ kind: z.literal("termRename"), taxonomy: Taxonomy, termId: TermId, name: Name }),
  z.object({
    kind: z.literal("termMove"),
    taxonomy: z.enum(["category", "brand"]).describe("product_cat or product_brand: tags have no parents."),
    termId: TermId,
    parent: z.number().int().min(0).describe("The term it goes under; 0 = the top level."),
  }),
]);

/** A taxonomy action's input, checked; else what is wrong with it, said plainly. */
export function parseTermActionInput(input: unknown): { ok: true; data: TermActionInput } | { ok: false; error: string } {
  const parsed = TermActionInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data as TermActionInput };
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return { ok: false, error: issue ? `${words().input.invalid} ${where}${issue.message}` : words().input.invalid };
}
