import "server-only";
import { z } from "zod";
import type { MenuActionInput } from "@/lib/vetrina/menu-ops";
import { words } from "./words";

/**
 * The menus' actions as anyone may ask them — the screens, the API, an
 * assistant — checked before anything runs. The menu's own checks (is the
 * item there, is the category in the shop, does the place exist) come after,
 * in menu.ts's assessment.
 */

export const MENU_LABEL_MAX = 120;
/** Items one action adds, at most. */
export const MENU_ADD_MAX = 50;

const Id = z.number().int().positive();
const MenuId = Id.describe("The menu's id, as GET /api/v1/menus lists it.");
const ItemId = Id.describe("The item's id, as GET /api/v1/menus/{id} lists it.");
const Label = z.string().trim().min(1).max(MENU_LABEL_MAX);
// An address inside the shop ("/saldi/", "#" for an item that only opens its sub-items) or out (https://…).
const Url = z
  .string()
  .trim()
  .max(2000)
  .regex(/^(https?:\/\/\S+|\/\S*|#\S*)$/)
  .describe('An address: "https://…", a path in the shop ("/saldi/"), or "#" for an item that only opens its own items.');
const Place = z
  .object({
    parent: z.number().int().min(0).nullish().describe("The item it goes under; absent, null or 0 = the menu's top level."),
    position: z.number().int().min(1).max(1000).nullish().describe("Its 1-based place among the items there; absent = after the last."),
  })
  .describe("Where: under an item (or at the top level), at a place among the items there.");
const Expected = z
  .object({ digest: z.string().min(8).max(64) })
  .optional()
  .describe("The menu as you read it (its `digest` from GET /api/v1/menus/{id}): the action is refused when the menu changed since. Optional.");

const NewItem = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("category"), id: Id, label: Label.nullish() }),
    z.object({ kind: z.literal("brand"), id: Id, label: Label.nullish() }),
    z.object({ kind: z.literal("page"), id: Id, label: Label.nullish() }),
    z.object({ kind: z.literal("link"), url: Url, label: Label }),
  ])
  .describe("A product category, a brand or a page by its id (its own label, else its name), or a link with its label.");

export const MenuActionInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("menuItemAdd"),
    menuId: MenuId,
    items: z.array(NewItem).min(1).max(MENU_ADD_MAX),
    place: Place.optional(),
    expected: Expected,
  }),
  z.object({ kind: z.literal("menuItemMove"), menuId: MenuId, itemId: ItemId, place: Place, expected: Expected }),
  z.object({ kind: z.literal("menuItemRemove"), menuId: MenuId, itemId: ItemId, expected: Expected }),
  z.object({
    kind: z.literal("menuItemRename"),
    menuId: MenuId,
    itemId: ItemId,
    label: Label.nullable().describe("Its own label; null = back to its category's, brand's or page's name."),
    expected: Expected,
  }),
]);

/** A menu action's input, checked; else what is wrong with it, said plainly. */
export function parseMenuActionInput(input: unknown): { ok: true; data: MenuActionInput } | { ok: false; error: string } {
  const parsed = MenuActionInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data as MenuActionInput };
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return { ok: false, error: issue ? `${words().input.invalid} ${where}${issue.message}` : words().input.invalid };
}
