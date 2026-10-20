import { z } from "zod";

/**
 * The shape of hub.config.ts — the Hub's code configuration.
 *
 * Code config decides what exists and what may be edited (which tabs, which
 * homepage blocks, which rail settings); data (margins, locks, the homepage
 * itself) is what gets edited. Validated once at import, so a typo in the
 * config fails the build instead of hiding a tab at runtime.
 */

/** WooCommerce catalog orderings a rail may fall back to after its pins. */
export const RAIL_FALLBACKS = ["menu_order", "date", "popularity", "price", "price-desc", "rating"] as const;
export type RailFallback = (typeof RAIL_FALLBACKS)[number];

/**
 * The shop-wide lists a section can show instead of a category or a brand
 * ([gh_product_rail type="…"]): the newest products, the best sellers, what
 * is on sale, the featured ones, the best rated.
 */
export const RAIL_LISTS = ["recent", "best_selling", "sale", "featured", "top_rated"] as const;
export type RailList = (typeof RAIL_LISTS)[number];

const BlockConfigSchema = z.object({
  /**
   * How the Vetrina shows the block:
   *  - "rail": a product rail, opened in the rail editor;
   *  - "summary": a thin placeholder (title + how many slides/cards/logos);
   *  - "hidden": not shown at all.
   */
  show: z.enum(["rail", "summary", "hidden"]),
  /** Label override. Default: the dictionary's name for the block. */
  label: z.string().min(1).optional(),
  /**
   * What the customer may change. Each needs the plugin to accept it too:
   * golden-hive-blocks ≥ 5.9.0 for pins / exclude / fallback, ≥ 5.10.0 for
   * limit and fields.
   */
  edit: z
    .object({
      pins: z.boolean().default(false),
      exclude: z.boolean().default(false),
      fallback: z.boolean().default(false),
      /** Rails: how many products the section shows. */
      limit: z.boolean().default(false),
      /**
       * Block fields (title, eyebrow, button, background…), by attribute
       * name. The plugin's own list is the ceiling (lib/vetrina/fields.ts).
       */
      fields: z.array(z.string().min(1)).default([]),
      /**
       * Rails, with golden-hive-blocks ≥ 5.15.0: what the section shows (another
       * category, brand or shop-wide list), new sections of this kind, their
       * order on the page, taking one away, and its on/off switch.
       */
      source: z.boolean().default(false),
      add: z.boolean().default(false),
      move: z.boolean().default(false),
      remove: z.boolean().default(false),
      switchOff: z.boolean().default(false),
    })
    .default({
      pins: false,
      exclude: false,
      fallback: false,
      limit: false,
      fields: [],
      source: false,
      add: false,
      move: false,
      remove: false,
      switchOff: false,
    }),
});
export type BlockConfig = z.infer<typeof BlockConfigSchema>;

export const HubConfigSchema = z.object({
  ui: z.object({
    /**
     * Where the installed home-screen app opens. (Signing in is Authelia's,
     * docs/auth.md: it returns people to the page they asked for.)
     */
    landing: z.string().startsWith("/"),
    /**
     * The guided path, in order: the steps a product walks from the catalog
     * to a sold order. The dock draws them as one line, starting from the
     * overview ("/"), which is always there. A page left out still exists
     * at its URL.
     */
    journey: z.array(z.string().startsWith("/")).min(1),
    /**
     * Pages set up once and rarely touched (rules, taxonomies, sources): off
     * the path, in the dock's setup menu.
     */
    setup: z.array(z.string().startsWith("/")).default([]),
  }),
  vetrina: z.object({
    /**
     * Where the homepage comes from:
     *  - "wordpress": the live site, through golden-hive-blocks' wc-gh/v1 API;
     *  - "fixture": an in-memory demo shop, for trying the editor without a site.
     * The VETRINA_SOURCE env variable overrides it (e.g. fixture in local dev).
     */
    source: z.enum(["wordpress", "fixture"]),
    /** Konsta UI look. */
    theme: z.enum(["ios", "material"]),
    /** The page edited: the site's static front page, or a page id. */
    page: z.union([z.literal("front"), z.object({ id: z.number().int().positive() })]),
    /** Per block type (the block's name); "*" covers every other block. */
    blocks: z.record(z.string(), BlockConfigSchema),
    /** Orderings offered for the products after the pinned ones. */
    fallbacks: z.array(z.enum(RAIL_FALLBACKS)).min(1),
    /** Shop-wide lists a section may show, besides a category or a brand (edit.source, edit.add). */
    lists: z.array(z.enum(RAIL_LISTS)).default(["recent", "best_selling", "sale"]),
    /** Most products a rail may pin. The plugin's own ceiling is 100. */
    maxPins: z.number().int().min(1).max(100),
    /** Most products a rail may show (edit.limit). The plugin's own ceiling is 100. */
    maxLimit: z.number().int().min(1).max(100).default(48),
    /** Products loaded per rail in the editor (the rest on demand). */
    pageSize: z.number().int().min(10).max(200),
  }),
});

export type HubConfig = z.infer<typeof HubConfigSchema>;
export type HubConfigInput = z.input<typeof HubConfigSchema>;

/** Identity helper that type-checks a config literal against the schema's input. */
export function defineHubConfig(config: HubConfigInput): HubConfigInput {
  return config;
}
