import "server-only";
import { z } from "zod";
import { OPERATION_UNDO_DAYS, type ActionInput, type ActionKind, type OperationTarget } from "@/lib/vetrina/catalog-ops";
import { isPageActionKind } from "@/lib/vetrina/page-ops";
import { OperationInputSchema, parseOperationInput } from "./input";
import { PageActionInputSchema, parsePageActionInput } from "./page-input";
import { words } from "./words";

/**
 * Every action the Vetrina can do, described once for whoever asks from
 * outside its screens — a script over the API, an assistant acting for the
 * owner: what it acts on, what it does in words a model reads, its input
 * (the same schema the server checks, and the JSON Schema made from it),
 * how its "Annulla" works, and a valid example. The screens and these
 * callers run the very same actions (service.ts, page.ts).
 *
 * The descriptions are in English, for programs; what the owner reads
 * (labels, previews, refusals) stays in his language.
 */

export type ActionScope = "catalog" | "homepage";

export interface ActionSpec<K extends ActionKind = ActionKind> {
  /** The catalog's actions change products; the homepage's change its sections and blocks. */
  scope: ActionScope;
  title: string;
  /** What it does, and what to know before asking it. */
  description: string;
  /** How its "Annulla" works. */
  undo: string;
  /** A valid input (the tests check it is). */
  example: Extract<ActionInput, { kind: K }>;
}

const UNDO_PRODUCTS = `Within ${OPERATION_UNDO_DAYS} days: each value it wrote goes back to what it was, where the shop still shows the value the action wrote (a value changed since stays).`;
const UNDO_SECTION = `Within ${OPERATION_UNDO_DAYS} days, while the section is as the action left it (found by its fingerprint wherever it is now): the way back is written over the page as it is. Refused when the section changed since — the newer change stands.`;

const SECTION = "category:saldi-sneakers-outlet#0";
const ONE: OperationTarget = { kind: "ids", ids: [4810] };

export const ACTIONS: { [K in ActionKind]: ActionSpec<K> } = {
  hide: {
    scope: "catalog",
    title: "Hide products",
    description:
      "Hide products from the shop: they leave its pages, its search and the homepage's sections, and stay in WooCommerce. " +
      'To hide a whole category or brand give `termKey` ("category:12") with a query of exactly that term: products that join it later are hidden with it, until `show` or the undo.',
    undo: `${UNDO_PRODUCTS} A whole category's or brand's hide stays undoable while it stands.`,
    example: { kind: "hide", target: ONE },
  },
  show: {
    scope: "catalog",
    title: "Show hidden products again",
    description:
      "Make hidden products visible again. `restore: true` puts back the visibility each had before its hide (only in search, only in the catalog); " +
      "`keepHeld: true` leaves hidden the products a whole category's or brand's hide still holds.",
    undo: UNDO_PRODUCTS,
    example: { kind: "show", target: ONE, restore: true },
  },
  sale: {
    scope: "catalog",
    title: "Put products on sale",
    description:
      "Put products on sale: `percent` off the regular price (1–90), size by size, rounded down to ,99 from 10 € (`rounding: \"charm\"`) or to the cent (`\"exact\"`). " +
      "`endsOn` is the sale's last day (YYYY-MM-DD, the shop's time zone), or null for none. A size whose sale would not be lower than its price is left as it is. " +
      "With `termKey` and a query of exactly that term it is the whole category's or brand's sale.",
    undo: `${UNDO_PRODUCTS} Each size gets its previous price and sale dates back.`,
    example: { kind: "sale", target: { kind: "query", query: { taxonomy: "brand", termId: 7 } }, percent: 20, rounding: "charm", endsOn: null },
  },
  unsale: {
    scope: "catalog",
    title: "End a sale",
    description: "End the sale on products: their sale prices and dates are removed. With `termKey`, the whole category's or brand's sale ends.",
    undo: UNDO_PRODUCTS,
    example: { kind: "unsale", target: ONE },
  },
  tag: {
    scope: "catalog",
    title: "Add a tag",
    description: "Add a tag to products: `tag.id` for one the shop has, or only `tag.name` — a new name makes the tag. Automatic categories reading the tag follow.",
    undo: UNDO_PRODUCTS,
    example: { kind: "tag", target: { kind: "ids", ids: [4810, 4811] }, tag: { name: "estate" } },
  },
  untag: {
    scope: "catalog",
    title: "Remove a tag",
    description: "Remove a tag, by its id, from products. Automatic categories reading the tag follow.",
    undo: UNDO_PRODUCTS,
    example: { kind: "untag", target: ONE, tagId: 302 },
  },
  categorize: {
    scope: "catalog",
    title: "Add to a category",
    description: "Put products in a category, by its id (they keep their other categories). A category an automatic rule fills is refused: its rule decides who is in it.",
    undo: UNDO_PRODUCTS,
    example: { kind: "categorize", target: ONE, categoryId: 12 },
  },
  uncategorize: {
    scope: "catalog",
    title: "Take out of a category",
    description: "Take products out of a category, by its id.",
    undo: UNDO_PRODUCTS,
    example: { kind: "uncategorize", target: ONE, categoryId: 12 },
  },
  pin: {
    scope: "catalog",
    title: "Put products first in a homepage section",
    description:
      "Put products first in a homepage section (`sectionKey`, as the homepage lists it), in the order given. " +
      "A section showing one manual category also puts them in that category; any other section takes only the products it already shows.",
    undo: "Within 7 days: the section's previous pins go back (and the categories it added are taken back), unless the section changed since.",
    example: { kind: "pin", target: { kind: "ids", ids: [4810, 4811] }, sectionKey: SECTION },
  },
  margin: {
    scope: "catalog",
    title: "Set a category's or brand's margin",
    description:
      "Set the margin a category's or brand's products are priced with, on the market price: `percent` 0–200, or null to hand it back to the standard margin. " +
      "It is saved as the Hub's pricing rule and the products priced from the market are repriced; supplier-priced and shop-only products are left alone.",
    undo: "Within 7 days: the previous rule goes back and the products are repriced, unless the rule was changed again since.",
    example: { kind: "margin", taxonomy: "brand", termId: 7, percent: 25 },
  },
  order: {
    scope: "catalog",
    title: "Place products in a category's order",
    description:
      "Place products, in the order given, in a category's or brand's own order on the shop (WooCommerce's menu_order, which its pages follow): " +
      "from `position` (1 = the top), or at the bottom with null. A product has one such number, shared by every category and brand it is in.",
    undo: `${UNDO_PRODUCTS} Each product gets its previous position back.`,
    example: { kind: "order", target: { kind: "ids", ids: [4810, 4811] }, term: { taxonomy: "category", id: 12 }, position: 1 },
  },
  sourceOrder: {
    scope: "catalog",
    title: "Arrange like a ranking",
    description:
      "Arrange a category, a brand (`term`) or the whole catalog (`term: null`) like an uploaded ranking (`sourceId`, an order source): " +
      "its products first, in its order, the others after them as they were.",
    undo: `${UNDO_PRODUCTS} Each product gets its previous position back.`,
    example: { kind: "sourceOrder", sourceId: "3f2c1a9e-6b7d-4c8e-9f10-123456789abc", term: { taxonomy: "category", id: 12 } },
  },
  delete: {
    scope: "catalog",
    title: "Delete products",
    description:
      "Delete products from the shop: they go to WordPress's trash (which WordPress empties after 30 days), and the Hub forgets them — " +
      "its copy of the shop, its catalog (the Publish tab no longer offers them), their photos' queue. " +
      "A product the supplier's feed (GoldenSneakers) carries is refused: the feed decides what is in the shop and would bring it back; hide it instead.",
    undo:
      `Within ${OPERATION_UNDO_DAYS} days, while WordPress still has them in its trash: each comes back as it was, sizes included, and the Hub knows it again. ` +
      "A product emptied from the trash since cannot come back.",
    example: { kind: "delete", target: ONE },
  },
  sectionSwitch: {
    scope: "homepage",
    title: "Switch a homepage section off or on",
    description: "Switch a homepage section off (`on: false`: it stays on the page, with its settings, and shows nothing on the site) or on again.",
    undo: UNDO_SECTION,
    example: { kind: "sectionSwitch", key: SECTION, on: false },
  },
  sectionMove: {
    scope: "homepage",
    title: "Move a homepage section",
    description: "Move one homepage section to a place among the product sections (`position`, 1 = the first). Banners and the other blocks keep their places.",
    undo: `Within ${OPERATION_UNDO_DAYS} days, while the sections are exactly as the move left them: they go back to their places.`,
    example: { kind: "sectionMove", key: SECTION, position: 1 },
  },
  sectionsArrange: {
    scope: "homepage",
    title: "Arrange the homepage sections",
    description: "Put every homepage product section in a new order: `keys` holds every section's key, each once.",
    undo: `Within ${OPERATION_UNDO_DAYS} days, while the sections are exactly as the move left them: they go back to their places.`,
    example: { kind: "sectionsArrange", keys: ["type:best_selling#0", SECTION] },
  },
  sectionAdd: {
    scope: "homepage",
    title: "Add a homepage section",
    description:
      "Add a product section to the homepage, after or before another (`anchorKey`, `place`): what it shows (`source`: a category or brand by slug, or a shop-wide list), " +
      "its texts (`fields`: `title`, `eyebrow`…), how many products (`limit`, the neighbour's when left out).",
    undo: `Within ${OPERATION_UNDO_DAYS} days, while the new section is as the action left it: it is taken away.`,
    example: { kind: "sectionAdd", anchorKey: SECTION, place: "after", source: { list: "best_selling" }, fields: { title: "PIÙ VENDUTI" } },
  },
  sectionRemove: {
    scope: "homepage",
    title: "Take a section off the homepage",
    description:
      "Take a product section off the homepage; its products stay in the shop. The last product section, and one showing a fixed list or tags, are taken away from WordPress only.",
    undo: `Within ${OPERATION_UNDO_DAYS} days: the section goes back next to the same neighbour, with its texts, products and settings.`,
    example: { kind: "sectionRemove", key: "type:best_selling#0" },
  },
  sectionSource: {
    scope: "homepage",
    title: "Change what a homepage section shows",
    description:
      "Point a homepage section at another category, brand or shop-wide list (`source`). The pinned and hidden products the new source also holds keep their places; " +
      "a button that led to the old page follows. The section's key changes (the answer says the new one).",
    undo: `${UNDO_SECTION} It shows what it showed, with its pins, hidden products and order.`,
    example: { kind: "sectionSource", key: SECTION, source: { taxonomy: "brand", slug: "nike" } },
  },
  sectionEdit: {
    scope: "homepage",
    title: "Publish a homepage section's settings",
    description:
      "A homepage section's own settings, as its editor publishes them: products in fixed places at its top (`pin`, in order), products hidden from it (`exclude`), " +
      "the automatic order after the pinned ones (`fallback`), its texts (`fields`), how many products it shows (`limit`). What is left out stays as it is.",
    undo: UNDO_SECTION,
    example: { kind: "sectionEdit", key: SECTION, pin: [4810, 4811], fallback: "popularity" },
  },
  blockEdit: {
    scope: "homepage",
    title: "Change a homepage block's texts",
    description:
      "The texts of a homepage block that is not a product section (a slider's title, the FAQ's subtitle), by its `path` and `blockName` as the homepage lists them. " +
      "Only the fields the shop's config lets the owner edit are written.",
    undo: `Within ${OPERATION_UNDO_DAYS} days, while the block is as the action left it: its texts go back.`,
    example: { kind: "blockEdit", path: "3", blockName: "golden-hive/faq", fields: { title: "Domande frequenti" } },
  },
};

export const ACTION_KINDS = Object.keys(ACTIONS) as ActionKind[];

/** Each kind's own schema, out of the two unions the server checks with. */
function schemasByKind(): Map<string, z.ZodType> {
  const out = new Map<string, z.ZodType>();
  for (const option of [...OperationInputSchema.options, ...PageActionInputSchema.options]) {
    const kind = (option as z.ZodObject<{ kind: z.ZodLiteral<string> }>).shape.kind.value;
    out.set(kind, option);
  }
  return out;
}

export interface ActionDescription {
  kind: ActionKind;
  scope: ActionScope;
  title: string;
  description: string;
  undo: string;
  example: ActionInput;
  /** The input as JSON Schema (draft 2020-12): the shape the server checks; the shop's own checks come after. */
  input: Record<string, unknown>;
}

let described: ActionDescription[] | null = null;

/** Every action, described with its input's JSON Schema — what an API or MCP client lists. */
export function describeActions(): ActionDescription[] {
  if (described) return described;
  const schemas = schemasByKind();
  described = ACTION_KINDS.map((kind) => {
    const spec = ACTIONS[kind];
    const schema = schemas.get(kind);
    if (!schema) throw new Error(`no input schema for the action ${kind}`);
    return {
      kind,
      scope: spec.scope,
      title: spec.title,
      description: spec.description,
      undo: spec.undo,
      example: spec.example,
      input: z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>,
    };
  });
  return described;
}

/** Any action's input, checked — the catalog's or the homepage's, by its kind; else what is wrong, said plainly. */
export function parseAction(input: unknown): { ok: true; data: ActionInput } | { ok: false; error: string } {
  const kind = typeof input === "object" && input != null ? (input as { kind?: unknown }).kind : undefined;
  if (typeof kind !== "string" || !(kind in ACTIONS)) return { ok: false, error: words().input.operation };
  return isPageActionKind(kind) ? parsePageActionInput(input) : parseOperationInput(input);
}
