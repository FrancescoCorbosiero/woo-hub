import { describe, expect, it } from "vitest";
import {
  checkHandmade,
  duplicateSizes,
  generateSku,
  isEuSize,
  isMadeUp,
  paragraphs,
  sizeKey,
  slugify,
  snippet,
  sortSizes,
  type HandmadeInput,
} from "./handmade";

const product: HandmadeInput = {
  sku: "HM-ABC123",
  title: "Borsa in pelle",
  sizes: [{ label: "Unica", price: 120, stock: 2 }],
  visible: true,
};

describe("a product made by hand, checked", () => {
  it("takes what the form sends, with the defaults for what it leaves out", () => {
    const result = checkHandmade(product);
    expect(result).toEqual({
      ok: true,
      product: {
        ...product,
        brand: "",
        categoryIds: [],
        description: "",
        photos: [],
        sizes: [{ label: "Unica", price: 120, stock: 2, barcode: "" }],
        seo: { title: "", description: "", slug: "" },
      },
    });
  });

  it("names the fields that are wrong", () => {
    const result = checkHandmade({ ...product, sku: "HM 1", title: " ", sizes: [{ label: "42", price: 0, stock: 1 }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.invalid.sort()).toEqual(["sizes", "sku", "title"]);
  });

  it("refuses no sizes, a size twice, and a photo that is not a web address", () => {
    expect(checkHandmade({ ...product, sizes: [] })).toEqual({ ok: false, invalid: ["sizes"] });
    expect(
      checkHandmade({
        ...product,
        sizes: [
          { label: "42", price: 100, stock: 1 },
          { label: "42,0", price: 100, stock: 1 },
        ],
      }),
    ).toEqual({ ok: false, invalid: ["sizes"] });
    expect(checkHandmade({ ...product, photos: [{ url: "javascript:alert(1)" }] })).toEqual({ ok: false, invalid: ["photos"] });
  });

  it("takes uploaded photos by id and others by address", () => {
    const result = checkHandmade({ ...product, photos: [{ id: 12, url: "https://shop.test/a.jpg" }, { url: "https://cdn.test/b.jpg" }] });
    expect(result.ok && result.product.photos).toEqual([{ id: 12, url: "https://shop.test/a.jpg" }, { url: "https://cdn.test/b.jpg" }]);
  });
});

describe("sizes", () => {
  it("tell an EU shoe size from a clothes size", () => {
    for (const eu of ["42", "42.5", "42,5", "36 2/3", "16"]) expect(isEuSize(eu)).toBe(true);
    for (const other of ["M", "XL", "2XL", "Unica", "9", "100", "US 9"]) expect(isEuSize(other)).toBe(false);
  });

  it("are one key each, whatever way written", () => {
    expect(sizeKey("42,5")).toBe("42.5");
    expect(sizeKey("42.50")).toBe("42.5");
    expect(sizeKey("36 2/3")).toBe("36.67");
    expect(sizeKey(" m ")).toBe("M");
    expect(duplicateSizes(["42", "42.0", "M", "m", "43"])).toEqual(["42.0", "m"]);
  });

  it("sort as the shop shows them: EU by value, clothes small to large, the rest by name", () => {
    expect(sortSizes(["XL", "44", "Unica", "S", "38.5", "M", "36 2/3"], (s) => s)).toEqual(["36 2/3", "38.5", "44", "S", "M", "XL", "Unica"]);
  });
});

describe("the words for Google", () => {
  it("make an address of a name", () => {
    expect(slugify("Nike Dunk Low «Panda» – Più bella")).toBe("nike-dunk-low-panda-piu-bella");
    expect(slugify("  ---  ")).toBe("");
  });

  it("cut a description where Google would, on a word", () => {
    expect(snippet("Breve.")).toBe("Breve.");
    const long = "Scarpa in pelle bianca con dettagli neri, suola in gomma e lacci piatti. ".repeat(4);
    const cut = snippet(long);
    expect(cut.length).toBeLessThanOrEqual(160);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/\s…$/);
  });

  it("turn the owner's text into paragraphs, escaped", () => {
    expect(paragraphs("Prima riga\nseconda <b>\n\nAltro paragrafo")).toBe("<p>Prima riga<br>\nseconda &lt;b&gt;</p>\n<p>Altro paragrafo</p>");
    expect(paragraphs("  \n ")).toBe("");
  });
});

describe("a code made up", () => {
  it("is HM- and six letters or digits nobody misreads", () => {
    let i = 0;
    expect(generateSku(() => i++)).toBe("HM-234567");
    expect(generateSku()).toMatch(/^HM-[2-9A-HJ-NP-Z]{6}$/);
    expect(isMadeUp(generateSku())).toBe(true);
    expect(isMadeUp("HM-BORSA1")).toBe(false);
    expect(isMadeUp("DD1391-100")).toBe(false);
  });
});
