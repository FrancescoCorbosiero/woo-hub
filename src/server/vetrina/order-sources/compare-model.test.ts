import { describe, expect, it } from "vitest";
import type { SourceProduct } from "@core/core-spine";
import type { IndexFacts } from "@/server/collections/repo";
import { catalogSpellings, closest, compareItems, differs, nameCandidates, priceGap, similarity } from "./compare-model";
import { matchPaired, pairKey } from "./match";

const fact = (id: number, sku: string, name: string, price: number | null, more: Partial<IndexFacts> = {}): IndexFacts => ({
  id,
  sku,
  name,
  status: "publish",
  visibility: "visible",
  stockStatus: "instock",
  onSale: false,
  price,
  hasImage: true,
  menuOrder: 0,
  totalSales: 0,
  created: null,
  categories: [],
  brands: [],
  ...more,
});

describe("priceGap — the shop's price against the other site's", () => {
  it("is a percentage of theirs, to one decimal: positive when the shop asks more", () => {
    expect(priceGap(144.99, 129)).toBe(12.4);
    expect(priceGap(171.99, 189)).toBe(-9);
    expect(priceGap(100, 100)).toBe(0);
  });

  it("calls a cent no difference, and says nothing without both prices", () => {
    expect(priceGap(129.99, 129.995)).toBe(0);
    expect(Object.is(priceGap(137.99, 138), 0)).toBe(true);
    expect(priceGap(null, 129)).toBeNull();
    expect(priceGap(129, null)).toBeNull();
    expect(priceGap(129, 0)).toBeNull();
  });

  it("differs beyond the threshold as the gap is shown: 2.04% is not more than 2%", () => {
    expect(differs(priceGap(102.04, 100), 2)).toBe(false);
    expect(differs(priceGap(102.06, 100), 2)).toBe(true);
    expect(differs(priceGap(97.9, 100), 2)).toBe(true);
    expect(differs(null, 2)).toBe(false);
  });
});

describe("nameCandidates — the shop's products whose names come closest", () => {
  const shop = [
    { id: 1, sku: "A", name: "Nike Dunk Low Panda Black" },
    { id: 2, sku: "B", name: "Nike Dunk Low Panda White" },
    { id: 3, sku: "C", name: "adidas Samba OG Cloud White" },
    { id: 4, sku: "D", name: "Nike Air Force 1 Low '07 White" },
  ];

  it("ranks by the words shared over all the words, at most three, none too far", () => {
    const found = nameCandidates(new Map([[0, "Nike Dunk Low Panda"]]), shop).get(0)!;
    // The Air Force shares "Nike" and "Low" only: too far to offer.
    expect(found.map((c) => c.id)).toEqual([1, 2]);
    expect(nameCandidates(new Map([[0, "Jordan 4 Military Blue"]]), shop).get(0)).toEqual([]);
  });
});

describe("matchPaired — the items paired by hand honoured", () => {
  const products = [
    { id: 1, sku: "NIK025-1", name: "Nike Dunk Low Panda Black" },
    { id: 2, sku: "NIK026-2", name: "Nike Dunk Low Panda White" },
    { id: 3, sku: "ADI035-5", name: "adidas Samba OG Cloud White Sail" },
  ];
  const items = [{ sku: null, name: "Nike Dunk Low Panda" }, { sku: "ADI035-5", name: null }, { sku: null, name: "Samba Sail" }];

  it("keys an item by its SKU, else its name, as compared", () => {
    expect(pairKey({ sku: "dd1391 100", name: "x" })).toBe("sku:DD1391100");
    expect(pairKey({ sku: null, name: "Nike Dunk Low '07" })).toBe("name:nike dunk low 07");
  });

  it("gives a pair its product before any item takes it, and the rest as the matcher does", () => {
    // Unpaired, the first is uncertain (two products fit) and the third finds nothing.
    expect(matchPaired(items, products, null).unmatched.map((u) => [u.position, u.ambiguous])).toEqual([
      [1, true],
      [3, false],
    ]);
    // Paired: the Samba is the third item's, so the second (its own SKU) finds it taken.
    const match = matchPaired(items, products, { "name:samba sail": 3 });
    expect(match.perItem).toEqual([[], [], [3]]);
    expect(match.ranked).toEqual([3]);
  });

  it("lets a pairing settle an uncertain name: with one of its products paired elsewhere, the other is it", () => {
    const match = matchPaired([...items, { sku: null, name: "Panda nera" }], products, { "name:panda nera": 1 });
    expect(match.perItem[0]).toEqual([2]);
    expect(match.perItem[3]).toEqual([1]);
  });

  it("leaves out an item paired with none, and ignores a pair whose product is gone", () => {
    expect(matchPaired(items, products, { "sku:ADI0355": null }).perItem[1]).toEqual([]);
    expect(matchPaired(items, products, { "sku:ADI0355": 999 }).perItem[1]).toEqual([3]);
  });
});

describe("compareItems — each item against the shop", () => {
  const facts = [
    fact(1, "NIK025-1", "Nike Dunk Low Panda Black", 146.99),
    fact(2, "NIK026-2", "Nike Dunk Low Panda White", 137.99),
    fact(3, "ADI035-5", "adidas Samba OG Cloud White Sail", 144.99, { onSale: true }),
    fact(4, "NIK030-6", "Nike Dunk Low Panda Olive", 164.99),
  ];
  const items = [
    { sku: "ADI035-5", name: "adidas Samba OG Cloud White Sail", price: 129 },
    { sku: null, name: "Nike Dunk Low Panda White", price: 137.5 },
    { sku: null, name: "Nike Dunk Low Panda", price: 120 },
    { sku: "DD1391-100", name: "Nike Dunk Low Retro White Black Panda" },
  ];
  const products = facts.map((f) => ({ id: f.id, sku: f.sku, name: f.name }));

  it("says each one's product and price gap, the missing and the uncertain, and counts them", () => {
    const compared = compareItems(items, facts, matchPaired(items, products, null), null, { threshold: 2, inCatalog: new Set([3]) });
    expect(compared.items.map((i) => [i.position, i.status, i.product?.id ?? null, i.gap, i.differs])).toEqual([
      [1, "matched", 3, 12.4, true],
      [2, "matched", 2, 0.4, false],
      [3, "ambiguous", null, null, false],
      [4, "missing", null, null, false],
    ]);
    expect(compared.items[0].product).toMatchObject({ onSale: true, price: 144.99 });
    // The White is the second item's: of the two left with every word, neither is it more than the other.
    expect(compared.items[2].candidates.map((c) => c.id)).toEqual([1, 2, 4]);
    expect(compared.items[3]).toMatchObject({ inCatalog: true, price: null });
    expect(compared.summary).toEqual({ items: 4, matched: 2, differ: 1, dearer: 1, cheaper: 0, missing: 1, importable: 1, ambiguous: 1 });
  });

  it("marks what was paired by hand: a product, or none", () => {
    const pairs = { "name:nike dunk low panda": 1, "sku:DD1391100": null };
    const compared = compareItems(items, facts, matchPaired(items, products, pairs), pairs, { threshold: 2, inCatalog: new Set() });
    expect(compared.items[2]).toMatchObject({ status: "matched", paired: true, product: { id: 1 } });
    expect(compared.items[3]).toMatchObject({ status: "missing", paired: true });
    expect(compared.items[0].paired).toBe(false);
  });
});

describe("catalogSpellings — a SKU as the Hub's catalog may hold it", () => {
  it("as written, and with its spaces as dashes", () => {
    expect(catalogSpellings(" dd1391-100 ")).toEqual(["DD1391-100"]);
    expect(catalogSpellings("DD1391 100")).toEqual(["DD1391 100", "DD1391-100"]);
  });
});

describe("closest — KicksDB's answers for a name", () => {
  const product = (sku: string, title: string): SourceProduct => ({
    stockxId: sku,
    sku,
    title,
    brand: "",
    image: "",
    market: "IT",
    currency: "EUR",
    variants: [],
  });

  it("keeps the near ones, closest first, each SKU once", () => {
    const found = closest("Nike Dunk Low Panda", [
      product("DD1503-101", "Nike Dunk Low Panda (W)"),
      product("DD1391-100", "Nike Dunk Low Retro White Black Panda"),
      product("DD1391-100", "Nike Dunk Low Retro White Black Panda (2021)"),
      product("CW1590-100", "Nike Dunk Low Panda (GS)"),
      product("555088-063", "Jordan 1 Retro High Shadow"),
    ]);
    expect(found.map((m) => m.product.sku)).toEqual(["DD1503-101", "CW1590-100", "DD1391-100"]);
    expect(found[0].score).toBe(0.8);
    expect(similarity("", "Nike")).toBe(0);
  });
});
