import { describe, expect, it, vi } from "vitest";

// No database, no network: only the rules.
vi.mock("@/lib/env", () => ({ env: {} }));
import type { SourceProduct } from "@core/core-spine";
import type { GsOwnedProduct } from "@/server/feeds/owner";
import { pluginOf, seoMeta } from "@/server/wordpress/seo";
import { routeOne, type LookupFacts } from "./lookup";

function product(sku: string, sizes: { label: string; type: string }[], over: Partial<SourceProduct> = {}): SourceProduct {
  return {
    stockxId: sku,
    sku,
    title: `Prodotto ${sku}`,
    brand: "Nike",
    image: `https://img.test/${sku}.jpg`,
    market: "IT",
    currency: "EUR",
    variants: sizes.map((s, i) => ({ stockxVariantId: `${sku}-${i}`, sizeLabel: s.label, sizeType: s.type, offers: [] })),
    ...over,
  };
}
const eu = (...labels: string[]) => labels.map((label) => ({ label, type: "eu" }));

function facts(over: Partial<LookupFacts> = {}): LookupFacts {
  return { onStore: new Map(), feed: new Map(), delisted: new Set(), catalog: new Map(), kicksdb: new Map(), ...over };
}

describe("which way a code comes in", () => {
  it("never twice: the shop's product first, with the shop's name", () => {
    const route = routeOne("dd1391-100", facts({ onStore: new Map([["DD1391-100", { id: 7, title: "Dunk Low Panda" }]]) }));
    expect(route).toMatchObject({ route: "onStore", productId: 7, title: "Dunk Low Panda" });
  });

  it("from the feed when it carries it, counting the sizes in stock", () => {
    const owned: GsOwnedProduct = {
      product: product("FV5029-010", eu("42", "43", "44"), { source: "goldensneakers" }),
      stockBySize: { "42": 2, "43": 0, "44": 1 },
      knownSizes: new Set(["42", "43", "44"]),
    };
    expect(routeOne("FV5029-010", facts({ feed: new Map([["FV5029-010", owned]]) }))).toMatchObject({ route: "feed", sizes: 2, brand: "Nike" });
  });

  it("from the catalog or KicksDB when they have EU sizes; by hand when they do not", () => {
    const withSizes = product("B75806", eu("40", "41"));
    const clothes = product("HOODIE-1", [{ label: "M", type: "us m" }]);
    expect(routeOne("B75806", facts({ catalog: new Map([["B75806", withSizes]]) }))).toMatchObject({ route: "catalog", sizes: 2 });
    expect(routeOne("B75806", facts({ kicksdb: new Map([["B75806", withSizes]]) }))).toMatchObject({ route: "kicksdb", sizes: 2 });
    expect(routeOne("HOODIE-1", facts({ kicksdb: new Map([["HOODIE-1", clothes]]) }))).toMatchObject({ route: "noSizes", title: "Prodotto HOODIE-1" });
  });

  it("by hand when the supplier no longer sells it", () => {
    expect(routeOne("X-1", facts({ delisted: new Set(["X-1"]) }))).toMatchObject({ route: "delisted" });
    const feedRow = product("X-2", eu("42"), { source: "goldensneakers" });
    expect(routeOne("X-2", facts({ catalog: new Map([["X-2", feedRow]]) }))).toMatchObject({ route: "delisted" });
  });

  it("finds a code written with a space under its dashed spelling", () => {
    expect(routeOne("DD1391 100", facts({ catalog: new Map([["DD1391-100", product("DD1391-100", eu("42"))]]) }))).toMatchObject({
      route: "catalog",
      sku: "DD1391 100",
    });
  });

  it("asks again when KicksDB did not answer; by hand when nobody knows it", () => {
    expect(routeOne("Q-1", facts({ kicksdb: new Map([["Q-1", "unreachable"]]) })).route).toBe("unreachable");
    expect(routeOne("Q-2", facts({ kicksdb: new Map([["Q-2", null]]) }))).toEqual({
      sku: "Q-2",
      route: "unknown",
      title: null,
      brand: null,
      image: null,
      sizes: 0,
      productId: null,
    });
  });
});

describe("the SEO plugin", () => {
  it("is read off the REST index's namespaces", () => {
    expect(pluginOf(["wp/v2", "wc/v3", "rankmath/v1"])).toBe("rankmath");
    expect(pluginOf(["wp/v2", "yoast/v1"])).toBe("yoast");
    expect(pluginOf(["wp/v2", "yoast/v1", "rankmath/v1"])).toBe("rankmath");
    expect(pluginOf(["wp/v2"])).toBeNull();
  });

  it("gets the fields it reads, the empty ones left out", () => {
    expect(seoMeta("rankmath", { title: " Dunk ", description: "" })).toEqual([{ key: "rank_math_title", value: "Dunk" }]);
    expect(seoMeta("yoast", { title: "T", description: "D" })).toEqual([
      { key: "_yoast_wpseo_title", value: "T" },
      { key: "_yoast_wpseo_metadesc", value: "D" },
    ]);
    expect(seoMeta(null, { title: "T", description: "D" })).toEqual([]);
  });
});
