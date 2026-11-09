import "server-only";
import { z } from "zod";
import { OPERATION_UNDO_DAYS, type ActionInput, type ActionKind, type OperationTarget } from "@/lib/vetrina/catalog-ops";
import { isMenuActionKind } from "@/lib/vetrina/menu-ops";
import { isTermActionKind } from "@/lib/vetrina/term-ops";
import { isPageActionKind } from "@/lib/vetrina/page-ops";
import { OperationInputSchema, parseOperationInput } from "./input";
import { MenuActionInputSchema, parseMenuActionInput } from "./menu-input";
import { parseTermActionInput, TermActionInputSchema } from "./term-input";
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

export type ActionScope = "catalog" | "homepage" | "menu" | "taxonomy";

export interface ActionSpec<K extends ActionKind = ActionKind> {
  /** The catalog's actions change products; the homepage's its sections and blocks; a menu's the site's navigation menus; the taxonomy's the store's categories, brands and tags. */
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

const UNDO_MENU_ITEM = "while it is as the action left it (found by its id; the items around it may have changed). Refused when it changed since — the newer change stands.";

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
      "A product the supplier's feed (GoldenSneakers) carries is refused: the feed decides what is in the shop and would bring it back; hide it instead. " +
      'A product\'s `source` says which ("goldensneakers"); `"source": "kicksdb"` in a query takes the Hub\'s own picks only. ' +
      "A query is fixed to what it matches when the action is filed.",
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
  menuItemAdd: {
    scope: "menu",
    title: "Add items to a navigation menu",
    description:
      "Add items, in order, to one of the site's navigation menus (GET /api/v1/menus): product categories and brands by id (GET /api/v1/catalog/terms), pages by id, " +
      "or links (`url`, `label`). `place`: under an item (`parent`) or at the top level, at a 1-based `position` there, else after the last. " +
      "An item shows its category's, brand's or page's name, and follows it when renamed, unless given a `label`. The menu is renumbered as WordPress's own editor numbers it.",
    undo: `Within ${OPERATION_UNDO_DAYS} days: the items it added are taken away, each ${UNDO_MENU_ITEM} An item given items of its own since stays.`,
    example: { kind: "menuItemAdd", menuId: 2, items: [{ kind: "category", id: 12 }, { kind: "brand", id: 7, label: "Nike" }], place: { parent: 31, position: 1 } },
  },
  menuItemMove: {
    scope: "menu",
    title: "Move a navigation menu item",
    description:
      "Move an item of a navigation menu, with every item under it, to another place: under another item (`place.parent`) or at the top level, " +
      "at a 1-based `place.position` among the items there once it has left its own place (so 3 puts it third), else after the last. Not under itself or its own items.",
    undo: `Within ${OPERATION_UNDO_DAYS} days, ${UNDO_MENU_ITEM} It goes back under the same item, after the same neighbour.`,
    example: { kind: "menuItemMove", menuId: 2, itemId: 45, place: { parent: 0, position: 2 } },
  },
  menuItemRemove: {
    scope: "menu",
    title: "Take an item out of a navigation menu",
    description:
      "Take an item out of a navigation menu; the items under it take its place, in their order, as WordPress's menu editor does. " +
      "The category, brand or page it led to stays in the shop.",
    undo: `Within ${OPERATION_UNDO_DAYS} days: the item comes back where it was, after the same neighbour, with its label and settings, and its items go back under it — those still where it left them. Refused when the item it was under is gone.`,
    example: { kind: "menuItemRemove", menuId: 2, itemId: 45 },
  },
  menuItemRename: {
    scope: "menu",
    title: "Rename a navigation menu item",
    description:
      "Give a navigation menu item a `label` of its own, or `null` to show its category's, brand's or page's own name again (and follow it when renamed). A link always keeps a label.",
    undo: `Within ${OPERATION_UNDO_DAYS} days, while it has the label the action gave it: its label goes back.`,
    example: { kind: "menuItemRename", menuId: 2, itemId: 45, label: "Saldi" },
  },
  menuCreate: {
    scope: "menu",
    title: "Make a navigation menu",
    description:
      "Make a new navigation menu, empty or starting with a copy of another menu's items (`copyOf`; items leading to something gone are left out). " +
      "It is in no place of the theme — the site does not show it — until put in one (menuLocation): a copy is the safe way to rework a menu before showing it. " +
      "Two menus never share a name.",
    undo: `Within ${OPERATION_UNDO_DAYS} days, while it is as the action made it and the theme shows it nowhere: it is deleted.`,
    example: { kind: "menuCreate", name: "Menu Black Friday", copyOf: 2 },
  },
  menuRename: {
    scope: "menu",
    title: "Rename a navigation menu",
    description: "Give a navigation menu another name (WordPress's own: the theme shows its items, not its name). Two menus never share a name.",
    undo: `Within ${OPERATION_UNDO_DAYS} days, while it has the name the action gave it: its name goes back.`,
    example: { kind: "menuRename", menuId: 2, name: "Menu principale" },
  },
  menuDelete: {
    scope: "menu",
    title: "Delete a navigation menu",
    description:
      "Delete a navigation menu with its items. Refused while a place of the theme shows it: put another menu there first, or empty the place (menuLocation). " +
      "The categories, brands and pages it led to stay.",
    undo: `Within ${OPERATION_UNDO_DAYS} days: the menu is made again with its items as they were (new ids), in no place, as it was. Refused when another menu has its name by then.`,
    example: { kind: "menuDelete", menuId: 5 },
  },
  menuLocation: {
    scope: "menu",
    title: "Choose the menu a place of the theme shows",
    description:
      "Put a navigation menu in a place of the theme (`location`, its slug as GET /api/v1/menu-locations lists it: the header's, the footer's…), " +
      "instead of the menu there; `menuId: null` shows none there. The site shows it at once.",
    undo: `Within ${OPERATION_UNDO_DAYS} days, while the place shows what the action put there: the menu it showed before goes back, if it still exists.`,
    example: { kind: "menuLocation", location: "primary", menuId: 5 },
  },
  termCreate: {
    scope: "taxonomy",
    title: "Make a category, a brand or a tag",
    description:
      "Make a product category, a brand or a tag in the store, at the top level or under a `parent` (categories and brands). " +
      "Under one parent two terms never share a name (WordPress ignores case).",
    undo: `Within ${OPERATION_UNDO_DAYS} days, while it is as made and nothing holds it (no product, no sub-term): it is deleted.`,
    example: { kind: "termCreate", taxonomy: "category", name: "Sneakers in saldo", parent: 12 },
  },
  termRename: {
    scope: "taxonomy",
    title: "Rename a category, a brand or a tag",
    description:
      "Give a store term another name. Its slug — its address on the site — stays, and so does every link to it (homepage sections, menus). " +
      "A category's or brand's old name is kept as an alias, so Publish files products named the old way into it instead of making a new term.",
    undo: `Within ${OPERATION_UNDO_DAYS} days, while it has the name the action gave it: its name goes back, and the alias goes.`,
    example: { kind: "termRename", taxonomy: "brand", termId: 7, name: "Nike" },
  },
  termMove: {
    scope: "taxonomy",
    title: "Move a category or a brand under another",
    description:
      "Put a category or a brand, with its sub-terms, under another term of the same taxonomy (`parent`), or at the top level (0). Not under itself or a term below it. " +
      "A margin set on a term covers the terms below it: the preview says when its products may take another margin from the next price sync.",
    undo: `Within ${OPERATION_UNDO_DAYS} days, while it is where the action put it: it goes back under its old parent.`,
    example: { kind: "termMove", taxonomy: "category", termId: 31, parent: 12 },
  },
  termMerge: {
    scope: "taxonomy",
    title: "Merge a category, a brand or a tag into another",
    description:
      "Every product holding the term holds `into` instead, product by product, in the background (follow it at /operations/{id}); its sub-terms go under `into`; " +
      "then the term is deleted, its name kept as an alias of `into` for Publish. Refused for an automatic category (its rule decides its products), " +
      "a term with a margin of its own, a term the homepage shows, and a merge into itself or a term below it.",
    undo: `Within ${OPERATION_UNDO_DAYS} days: the term is made again (same name, slug, parent, description; a new id), its sub-terms go back under it, and each product holds it again instead of \`into\` — a product changed since stays as it is.`,
    example: { kind: "termMerge", taxonomy: "category", termId: 45, into: 12 },
  },
  termDelete: {
    scope: "taxonomy",
    title: "Delete a category, a brand or a tag",
    description:
      "Every product holding the term lets go of it, product by product, in the background (a product left with no category goes to the shop's default one, as WooCommerce does); " +
      "then the term is deleted, its sub-terms moving up to its parent. The products stay in the shop. Refused for an automatic category, a term with a margin of its own and a term the homepage shows.",
    undo: `Within ${OPERATION_UNDO_DAYS} days: the term is made again (same name, slug, parent, description; a new id), its sub-terms go back under it, and each product holds it again — a product changed since stays as it is.`,
    example: { kind: "termDelete", taxonomy: "tag", termId: 88 },
  },
};

export const ACTION_KINDS = Object.keys(ACTIONS) as ActionKind[];

/** Each kind's own schema, out of the two unions the server checks with. */
function schemasByKind(): Map<string, z.ZodType> {
  const out = new Map<string, z.ZodType>();
  for (const option of [
    ...OperationInputSchema.options,
    ...PageActionInputSchema.options,
    ...MenuActionInputSchema.options,
    ...TermActionInputSchema.options,
  ]) {
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

/** Any action's input, checked — the catalog's, the homepage's or a menu's, by its kind; else what is wrong, said plainly. */
export function parseAction(input: unknown): { ok: true; data: ActionInput } | { ok: false; error: string } {
  const kind = typeof input === "object" && input != null ? (input as { kind?: unknown }).kind : undefined;
  if (typeof kind !== "string" || !(kind in ACTIONS)) return { ok: false, error: words().input.operation };
  if (isPageActionKind(kind)) return parsePageActionInput(input);
  if (isMenuActionKind(kind)) return parseMenuActionInput(input);
  if (isTermActionKind(kind)) return parseTermActionInput(input);
  return parseOperationInput(input);
}
