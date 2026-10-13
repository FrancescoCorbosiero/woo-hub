import { describe, expect, it } from "vitest";
import type { CatalogTerm } from "@/lib/vetrina/catalog";
import { byLetter, letterOf, readParams, statsLine, termHref, topLevel, viewHref, withParams } from "./model";

const term = (id: number, name: string, extra: Partial<CatalogTerm> = {}): CatalogTerm => ({
  taxonomy: "category",
  id,
  name,
  slug: name.toLowerCase(),
  parent: 0,
  path: name,
  children: [],
  count: 1,
  soldOut: 0,
  hidden: 0,
  onSale: 0,
  sections: [],
  automatic: null,
  ...extra,
});

describe("catalog home links", () => {
  it("opens a category, a brand and a quick view on their own screens", () => {
    expect(termHref({ taxonomy: "category", id: 12 })).toBe("/vetrina/catalogo/categoria/12");
    expect(termHref({ taxonomy: "brand", id: 7 })).toBe("/vetrina/catalogo/brand/7");
    expect(viewHref("soldout")).toBe("/vetrina/catalogo/vista/soldout");
  });
});

describe("readParams / withParams", () => {
  it("reads the defaults when the address says nothing, or something unknown", () => {
    expect(readParams(new URLSearchParams(""))).toEqual({ tab: "category", order: "name", q: "" });
    expect(readParams(new URLSearchParams("tab=tags&sort=price"))).toEqual({ tab: "category", order: "name", q: "" });
  });

  it("reads the brand list, the count order and the search", () => {
    expect(readParams(new URLSearchParams("tab=brand&sort=count&q=dunk%20panda"))).toEqual({
      tab: "brand",
      order: "count",
      q: "dunk panda",
    });
  });

  it("sets and drops parameters, keeping the others", () => {
    expect(withParams("/vetrina/catalogo?tab=brand", { q: "nike" })).toBe("/vetrina/catalogo?tab=brand&q=nike");
    expect(withParams("/vetrina/catalogo?tab=brand&q=nike", { q: "" })).toBe("/vetrina/catalogo?tab=brand");
    expect(withParams("/vetrina/catalogo?q=a", { q: null, tab: null })).toBe("/vetrina/catalogo");
    expect(withParams("/vetrina/catalogo", { q: "dunk & co" })).toBe("/vetrina/catalogo?q=dunk+%26+co");
  });
});

describe("topLevel", () => {
  const list = [
    term(1, "Saldi", { count: 40 }),
    term(2, "Nike", { count: 0 }),
    term(3, "Adidas", { count: 12 }),
    term(4, "Dunk", { parent: 1, count: 30 }),
    term(5, "Jordan 11", { count: 12 }),
    term(6, "Jordan 4", { count: 5 }),
  ];

  it("keeps the top level only, A to Z as a person sorts, the empty ones apart", () => {
    const { filled, empty } = topLevel(list, "name");
    expect(filled.map((t) => t.name)).toEqual(["Adidas", "Jordan 4", "Jordan 11", "Saldi"]);
    expect(empty.map((t) => t.name)).toEqual(["Nike"]);
  });

  it("sorts by count, ties by name", () => {
    expect(topLevel(list, "count").filled.map((t) => t.name)).toEqual(["Saldi", "Adidas", "Jordan 11", "Jordan 4"]);
  });

  it("does not reorder what it was given", () => {
    const before = list.map((t) => t.id);
    topLevel(list, "count");
    expect(list.map((t) => t.id)).toEqual(before);
  });
});

describe("statsLine", () => {
  const words = { soldOut: (n: number) => `${n} esauriti`, hidden: (n: number) => `${n} nascosti` };

  it("names only what is not zero", () => {
    expect(statsLine({ soldOut: 12, hidden: 3 }, words)).toBe("12 esauriti · 3 nascosti");
    expect(statsLine({ soldOut: 0, hidden: 3 }, words)).toBe("3 nascosti");
    expect(statsLine({ soldOut: 0, hidden: 0 }, words)).toBe("");
  });
});

describe("letterOf / byLetter", () => {
  it("files accents under their letter and anything else under #", () => {
    expect(letterOf("Ébène")).toBe("E");
    expect(letterOf("  adidas")).toBe("A");
    expect(letterOf("361°")).toBe("#");
    expect(letterOf("")).toBe("#");
  });

  it("groups A to Z, names in order inside, # last", () => {
    const groups = byLetter([term(1, "Nike"), term(2, "361°"), term(3, "adidas"), term(4, "New Balance"), term(5, "Asics")]);
    expect(groups.map((g) => g.letter)).toEqual(["A", "N", "#"]);
    expect(groups[0].terms.map((t) => t.name)).toEqual(["adidas", "Asics"]);
    expect(groups[1].terms.map((t) => t.name)).toEqual(["New Balance", "Nike"]);
  });
});
