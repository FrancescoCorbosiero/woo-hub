import "server-only";
import { z } from "zod";
import { RAIL_FALLBACKS, RAIL_LISTS } from "@/config/schema";
import type { PageActionInput } from "@/lib/vetrina/page-ops";
import { words } from "./words";

/**
 * The homepage's actions as anyone outside the screens may ask them (the
 * API, an assistant), checked before anything runs — with the limits the
 * screens' own server actions apply (server/actions/vetrina.ts). The page's
 * own checks (what the config allows, what the plugin can do, whether the
 * section is there) come after, in page.ts's assessment.
 */

/** A section's key, as the homepage read names it: "category:saldi#0", "type:best_selling#0". */
const Key = z.string().min(3).max(300).describe('A section\'s key, as the homepage lists it ("category:saldi-sneakers#0").');
const Ids = z.array(z.number().int().positive()).max(100);
// Field values are checked field by field when the action is assessed (lib/vetrina/fields.ts); here only their shape and size.
const Fields = z
  .record(z.string().min(1).max(40), z.string().max(1000))
  .refine((fields) => Object.keys(fields).length <= 20)
  .describe('Texts by field name ("title", "eyebrow", "buttonText"…); the ones left out stay as they are.');
// A WordPress slug: lowercase letters, digits, dashes, underscores, and the percent escapes of accented letters.
const Source = z
  .union([
    z.object({ taxonomy: z.enum(["category", "brand"]), slug: z.string().regex(/^[a-z0-9_%-]{1,200}$/) }),
    z.object({ list: z.enum(RAIL_LISTS) }),
  ])
  .describe("What a section shows: a category or a brand by its slug, or a shop-wide list.");
const Expected = z
  .object({ modifiedGmt: z.string().min(1).max(40), attrsHash: z.string().min(1).max(64).optional() })
  .optional()
  .describe("The page (and the section) as you read them: the action is refused when either changed since. Optional.");

export const PageActionInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sectionSwitch"), key: Key, on: z.boolean(), expected: Expected }),
  z.object({ kind: z.literal("sectionMove"), key: Key, position: z.number().int().min(1).max(100), expected: Expected }),
  z.object({ kind: z.literal("sectionsArrange"), keys: z.array(Key).min(1).max(100), expected: Expected }),
  z.object({
    kind: z.literal("sectionAdd"),
    anchorKey: Key,
    place: z.enum(["after", "before"]),
    source: Source,
    fields: Fields,
    limit: z.number().int().min(1).max(100).optional(),
    expected: Expected,
  }),
  z.object({ kind: z.literal("sectionRemove"), key: Key, expected: Expected }),
  z.object({ kind: z.literal("sectionSource"), key: Key, source: Source, fields: Fields.optional(), expected: Expected }),
  z.object({
    kind: z.literal("sectionEdit"),
    key: Key,
    pin: Ids.optional(),
    exclude: Ids.optional(),
    fallback: z.enum(RAIL_FALLBACKS).optional(),
    fields: Fields.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    expected: Expected,
  }),
  z.object({
    kind: z.literal("blockEdit"),
    path: z.string().min(1).max(40),
    blockName: z.string().min(3).max(100),
    fields: Fields,
    expected: Expected,
  }),
]);

/** A homepage action's input, checked; else what is wrong with it, said plainly. */
export function parsePageActionInput(input: unknown): { ok: true; data: PageActionInput } | { ok: false; error: string } {
  const parsed = PageActionInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data as PageActionInput };
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return { ok: false, error: issue ? `${words().input.invalid} ${where}${issue.message}` : words().input.invalid };
}
