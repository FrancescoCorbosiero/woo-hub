import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceProduct } from "@core/core-spine";
import type { TaxonomyConfig } from "@core/config";

/**
 * Publish's identity resolver and the store's renamed terms: a category or a
 * brand renamed, moved or merged in the Hub leaves its old name as an alias
 * (term-aliases.ts), so a product the source still names the old way is
 * filed into the term as it is now — never into a new term with the old name.
 */
const aliases = vi.hoisted(() => ({ rows: [] as { taxonomy: string; parent: number; nameKey: string; termId: number }[] }));
vi.mock("./term-aliases", async () => {
  const { decodeEntities } = await import("@/server/collections/index-rows");
  return {
    termKey: (name: string) => decodeEntities(name).trim().toLowerCase().replace(/\s+/g, " "),
    listAliases: async (taxonomy: string) => aliases.rows.filter((a) => a.taxonomy === taxonomy),
  };
});

import { buildIdentityResolver } from "./identity";
import type { WooClient } from "./client";

const TAXONOMY: TaxonomyConfig = {
  useSourceTree: ["kicksdb"],
  defaultCategory: "Sneakers",
  rules: [],
  write: { brandTaxonomy: true, brandAttribute: false, genderAttribute: false },
};

const product = (over: Partial<SourceProduct> = {}): SourceProduct =>
  ({ stockxId: "x1", sku: "IE4931", title: "Yeezy Foam RNNR", brand: "adidas", category: "Yeezy", secondaryCategory: "Foam RNNR", variants: [], ...over }) as SourceProduct;

function store(categories: { id: number; name: string; parent: number }[], brands: { id: number; name: string }[]) {
  const created: string[] = [];
  const client = {
    listCategories: async () => categories.map((c) => ({ ...c, slug: c.name.toLowerCase() })),
    listBrands: async () => brands.map((b) => ({ ...b, slug: b.name.toLowerCase() })),
    createCategory: async (name: string, parent?: number) => {
      created.push(`category ${name} under ${parent ?? 0}`);
      return { id: 999, name, slug: name.toLowerCase() };
    },
    createBrand: async (name: string) => {
      created.push(`brand ${name}`);
      return { id: 998, name, slug: name.toLowerCase() };
    },
  } as unknown as WooClient;
  return { client, created };
}

beforeEach(() => {
  aliases.rows = [];
});

describe("the identity resolver and the Hub's renamed terms", () => {
  it("files a product named the old way into the renamed category and brand, making nothing", async () => {
    // "Yeezy" was renamed "Yeezy (adidas)"; the brand "adidas" became "Adidas Originals".
    const { client, created } = store(
      [
        { id: 10, name: "Yeezy (adidas)", parent: 0 },
        { id: 11, name: "Foam RNNR", parent: 10 },
      ],
      [{ id: 20, name: "Adidas Originals" }],
    );
    aliases.rows = [
      { taxonomy: "category", parent: 0, nameKey: "yeezy", termId: 10 },
      { taxonomy: "brand", parent: 0, nameKey: "adidas", termId: 20 },
    ];
    const resolver = await buildIdentityResolver(client, [product()], TAXONOMY);
    expect(resolver.for(product())).toEqual({ brandId: 20, categoryIds: [10, 11] });
    expect(created).toEqual([]);
  });

  it("lets a real term of the old name win over the alias, and ignores an alias of a term gone", async () => {
    const { client, created } = store(
      [
        { id: 10, name: "Yeezy (adidas)", parent: 0 },
        { id: 12, name: "Yeezy", parent: 0 },
        { id: 13, name: "Foam RNNR", parent: 12 },
      ],
      [],
    );
    aliases.rows = [
      { taxonomy: "category", parent: 0, nameKey: "yeezy", termId: 10 },
      { taxonomy: "brand", parent: 0, nameKey: "adidas", termId: 77 },
    ];
    const resolver = await buildIdentityResolver(client, [product()], TAXONOMY);
    expect(resolver.for(product())).toMatchObject({ categoryIds: [12, 13] });
    // The brand's alias leads to a brand that is gone: the brand is made, as without an alias.
    expect(created).toEqual(["brand adidas"]);
  });

  it("reads a name with an entity as WooCommerce answers it", async () => {
    const { client, created } = store([{ id: 30, name: "Saldi &amp; Outlet", parent: 0 }], []);
    const resolver = await buildIdentityResolver(client, [product({ category: "Saldi & Outlet", secondaryCategory: "" })], TAXONOMY);
    expect(resolver.for(product({ category: "Saldi & Outlet", secondaryCategory: "" }))).toMatchObject({ categoryIds: [30] });
    expect(created.filter((c) => c.startsWith("category"))).toEqual([]);
  });
});
