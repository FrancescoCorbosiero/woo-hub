import { describe, expect, it } from "vitest";
import type { RailTerm } from "@/lib/vetrina/types";
import { railCatalogHref, sectionHref } from "./links";

const term = (id: number): RailTerm => ({ id, slug: `t-${id}`, name: `Term ${id}`, count: 3, link: null });

describe("railCatalogHref", () => {
  it("opens the one category or brand a section shows", () => {
    expect(railCatalogHref({ taxonomy: "product_cat", terms: [term(12)] })).toBe("/vetrina/catalogo/categoria/12");
    expect(railCatalogHref({ taxonomy: "product_brand", terms: [term(7)] })).toBe("/vetrina/catalogo/brand/7");
  });

  it("has nothing to open for several terms, none, or another taxonomy", () => {
    expect(railCatalogHref({ taxonomy: "product_cat", terms: [term(12), term(13)] })).toBeNull();
    expect(railCatalogHref({ taxonomy: "product_cat", terms: [] })).toBeNull();
    expect(railCatalogHref({ taxonomy: "product_tag", terms: [term(5)] })).toBeNull();
    expect(railCatalogHref({ taxonomy: null, terms: [term(5)] })).toBeNull();
    // An object's own keys are not taxonomies.
    expect(railCatalogHref({ taxonomy: "constructor", terms: [term(5)] })).toBeNull();
  });
});

describe("sectionHref", () => {
  it("opens the section editor by the section's key", () => {
    expect(sectionHref("category:saldi-sneakers-outlet#0")).toBe("/vetrina/sezione/category.saldi-sneakers-outlet.0");
  });
});
