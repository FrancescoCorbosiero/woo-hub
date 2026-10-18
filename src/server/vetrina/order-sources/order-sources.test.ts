import { describe, expect, it } from "vitest";
import { nameKey, parseOrderSource, skuKey } from "./format";
import { matchSource, matchSummary, type MatchProduct } from "./match";

const items = (text: string) => {
  const res = parseOrderSource(text);
  if (!res.ok) throw new Error(res.error);
  return res.source.items;
};

describe("parseOrderSource — the agreed format", () => {
  it("reads the format as documented", () => {
    const res = parseOrderSource(
      JSON.stringify({
        format: "woo-hub.order-source/1",
        name: "StockX — più venduti",
        origin: "https://stockx.com/sneakers/most-popular",
        items: [{ sku: "DD1391-100", name: "Nike Dunk Low Retro White Black Panda" }, { name: "adidas Samba OG Cloud White" }, { sku: "IE3437" }],
      }),
    );
    expect(res).toEqual({
      ok: true,
      source: {
        name: "StockX — più venduti",
        origin: "https://stockx.com/sneakers/most-popular",
        items: [
          { sku: "DD1391-100", name: "Nike Dunk Low Retro White Black Panda" },
          { sku: null, name: "adidas Samba OG Cloud White" },
          { sku: "IE3437", name: null },
        ],
        duplicates: 0,
      },
    });
  });

  it("takes an LLM's answer as it comes: a sentence, a fence, a trailing comma", () => {
    const text = 'Ecco il JSON richiesto:\n\n```json\n{\n  "name": "Nike.com",\n  "items": [\n    {"sku": "DD1391-100"},\n    {"sku": "FD6475-001"},\n  ]\n}\n```\nFammi sapere se serve altro.';
    const res = parseOrderSource(text);
    expect(res.ok && res.source.name).toBe("Nike.com");
    expect(items(text).map((i) => i.sku)).toEqual(["DD1391-100", "FD6475-001"]);
  });

  it("reads a bare list, of objects or of strings, and other key names", () => {
    expect(items('[{"SKU":"DD1391-100"},{"Nome":"Air Jordan 4 Bred"}]')).toEqual([
      { sku: "DD1391-100", name: null },
      { sku: null, name: "Air Jordan 4 Bred" },
    ]);
    expect(items('["DD1391-100", "Air Jordan 4 Retro Bred Reimagined"]')).toEqual([
      { sku: "DD1391-100", name: null },
      { sku: null, name: "Air Jordan 4 Retro Bred Reimagined" },
    ]);
    expect(items('{"sneakers": [{"style_code": "IE3437"}]}')).toEqual([{ sku: "IE3437", name: null }]);
  });

  it("orders by rank when every item has one", () => {
    expect(items('[{"sku":"BBB222","rank":2},{"sku":"AAA111","rank":1}]').map((i) => i.sku)).toEqual(["AAA111", "BBB222"]);
    // Not every item: the text's order.
    expect(items('[{"sku":"BBB222","rank":2},{"sku":"AAA111"}]').map((i) => i.sku)).toEqual(["BBB222", "AAA111"]);
  });

  it("reads a CSV with a header, in any order of columns and with quoted names", () => {
    expect(items('nome;sku\n"Nike Dunk Low; Panda";DD1391-100\nadidas Samba;')).toEqual([
      { sku: "DD1391-100", name: "Nike Dunk Low; Panda" },
      { sku: null, name: "adidas Samba" },
    ]);
  });

  it("reads one product per line, numbered or not, with or without a code first", () => {
    expect(items("1. DD1391-100 Nike Dunk Low Panda\n2) Air Jordan 1 Mid Olive Grey\n- IE3437\n# a comment\n\nGel-1130 Blush")).toEqual([
      { sku: "DD1391-100", name: "DD1391-100 Nike Dunk Low Panda" },
      { sku: null, name: "Air Jordan 1 Mid Olive Grey" },
      { sku: "IE3437", name: null },
      { sku: "Gel-1130", name: "Gel-1130 Blush" },
    ]);
  });

  it("counts the same product twice once", () => {
    const res = parseOrderSource('[{"sku":"DD1391-100"},{"sku":"dd1391 100"},{"name":"Samba OG"},{"name":"samba og"}]');
    expect(res.ok && res.source.items.length).toBe(2);
    expect(res.ok && res.source.duplicates).toBe(2);
  });

  it("says why it cannot read a text", () => {
    expect(parseOrderSource("  ")).toEqual({ ok: false, error: "empty" });
    expect(parseOrderSource('{"items": [}')).toEqual({ ok: false, error: "invalidJson" });
    expect(parseOrderSource('{"items": []}')).toEqual({ ok: false, error: "noItems" });
    expect(parseOrderSource(JSON.stringify({ items: Array.from({ length: 20_001 }, (_, i) => `SKU${i}00`) }))).toEqual({
      ok: false,
      error: "tooMany",
    });
  });

  it("compares codes and names the way the shop's are written", () => {
    expect(skuKey("dd1391 100")).toBe(skuKey("DD1391-100"));
    expect(nameKey("Nike Air Force 1 '07 Crème")).toBe("nike air force 1 07 creme");
  });
});

describe("matchSource — which product each item is", () => {
  const shop: MatchProduct[] = [
    { id: 1, sku: "DD1391-100", name: "Nike Dunk Low Retro White Black Panda" },
    { id: 2, sku: "IE3437", name: "adidas Samba OG Cloud White Core Black" },
    { id: 3, sku: "1203A537-100", name: "ASICS Gel-1130 Blush Pure Silver" },
    { id: 4, sku: "DQ8423-100", name: "Air Jordan 1 Mid Olive Grey" },
    { id: 5, sku: "DQ8423-101", name: "Air Jordan 1 Mid Olive Grey (GS)" },
    { id: 6, sku: "CW2288-111", name: "Nike Air Force 1 &#8217;07 White" },
    { id: 7, sku: "FB9658-001", name: "Nike Dunk Low Grey Fog" },
    { id: 8, sku: "FB9658-002", name: "Nike Dunk Low Grey Fog Pink" },
  ];

  it("takes a SKU however it is written, then a name, in the source's order", () => {
    const m = matchSource(
      [{ sku: "ie 3437", name: null }, { sku: null, name: "nike dunk low retro white black panda" }, { sku: "1203a537100", name: null }],
      shop,
    );
    expect(m.ranked).toEqual([2, 1, 3]);
    expect(m.unmatched).toEqual([]);
  });

  it("takes a name whose every word is in only one product's — or, of several, the one with no other word", () => {
    expect(matchSource([{ sku: null, name: "Nike Dunk Low Panda" }], shop).ranked).toEqual([1]);
    // Both Olive Grey fit: the one without "(GS)" has no other word.
    expect(matchSource([{ sku: null, name: "Air Jordan 1 Mid Olive Grey" }], shop).ranked).toEqual([4]);
  });

  it("leaves out a name two products fit as well, and says it was ambiguous", () => {
    const m = matchSource([{ sku: null, name: "Nike Dunk Low" }], shop);
    expect(m.ranked).toEqual([]);
    expect(m.unmatched).toEqual([{ position: 1, sku: null, name: "Nike Dunk Low", ambiguous: true }]);
  });

  it("never takes a product twice, nor a name of one word", () => {
    const m = matchSource(
      [
        { sku: "DD1391-100", name: null },
        { sku: null, name: "Nike Dunk Low Retro White Black Panda" },
        { sku: null, name: "Samba" },
      ],
      shop,
    );
    expect(m.ranked).toEqual([1]);
    expect(m.unmatched.map((u) => u.position)).toEqual([2, 3]);
  });

  it("finds a code written inside a name, and a model taken for a code by its name", () => {
    expect(matchSource([{ sku: null, name: "Air Force 1 (CW2288-111)" }], shop).ranked).toEqual([6]);
    // "Gel-1130" is no product's code: as a name, one product has it.
    expect(matchSource([{ sku: "Gel-1130", name: null }], shop).ranked).toEqual([3]);
    const two = [...shop, { id: 9, sku: "1203A537-200", name: "ASICS Gel-1130 Black Pure Silver" }];
    expect(matchSource([{ sku: "Gel-1130", name: null }], two).unmatched[0]?.ambiguous).toBe(true);
    expect(matchSource([{ sku: "Gel-1130", name: "Gel-1130 Blush" }], two).ranked).toEqual([3]);
  });

  it("an unknown SKU with a name falls back to the name", () => {
    expect(matchSource([{ sku: "ZZ0000-000", name: "Nike Dunk Low Grey Fog Pink" }], shop).ranked).toEqual([8]);
  });

  it("sums a match up for the screens", () => {
    const list = [{ sku: "DD1391-100", name: null }, { sku: "NOPE-0000", name: null }];
    expect(matchSummary(list, matchSource(list, shop))).toEqual({
      items: 2,
      matched: 1,
      unmatched: [{ position: 2, sku: "NOPE-0000", name: null, ambiguous: false }],
      unmatchedCount: 1,
    });
  });
});
