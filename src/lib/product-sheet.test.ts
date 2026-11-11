import { describe, expect, it } from "vitest";
import { checkHandmade } from "./handmade";
import {
  categoryKey,
  headerColumn,
  matchCategories,
  parseAmount,
  parseCount,
  parseTable,
  readProductSheet,
  sheetToHandmade,
  splitSizes,
} from "./product-sheet";

describe("a product sheet's headers", () => {
  it("are read in Italian or English, whatever their accents, spaces or case", () => {
    expect(headerColumn("Codice")).toBe("sku");
    expect(headerColumn("Style code")).toBe("sku");
    expect(headerColumn("Nome prodotto")).toBe("title");
    expect(headerColumn("Quantità")).toBe("stock");
    expect(headerColumn("Prezzo (€)")).toBe("price");
    expect(headerColumn("PREZZO_EUR")).toBe("price");
    expect(headerColumn("Codice a barre")).toBe("barcode");
    expect(headerColumn("URL foto")).toBe("photos");
    expect(headerColumn("Titolo SEO")).toBe("seoTitle");
    expect(headerColumn("Colore")).toBe(null);
  });
});

describe("a table's cells", () => {
  it("keep a quoted cell whole: its delimiters, its quotes, its line breaks", () => {
    expect(parseTable('a;"b; c";"riga 1\nriga 2"\nd;"say ""hi""";\n\n', ";")).toEqual([
      ["a", "b; c", "riga 1\nriga 2"],
      ["d", 'say "hi"', ""],
    ]);
  });
});

describe("amounts and pieces", () => {
  it("read as a shop writes them", () => {
    expect(parseAmount("149,90")).toBe(149.9);
    expect(parseAmount("149.90")).toBe(149.9);
    expect(parseAmount("€ 1.234,50")).toBe(1234.5);
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("1.234")).toBe(1234);
    expect(parseAmount("89 EUR")).toBe(89);
    expect(parseAmount("12.5.3")).toBeNull();
    expect(parseAmount("gratis")).toBeNull();
    expect(parseCount("3")).toBe(3);
    expect(parseCount("-2")).toBe(0);
    expect(parseCount("tanti")).toBeNull();
  });

  it("several sizes in a cell, never a size with a decimal comma", () => {
    expect(splitSizes("40, 41, 42.5")).toEqual(["40", "41", "42.5"]);
    expect(splitSizes("S|M|L")).toEqual(["S", "M", "L"]);
    expect(splitSizes("42,5")).toEqual(["42,5"]);
    expect(splitSizes("36 2/3")).toEqual(["36 2/3"]);
  });
});

describe("a product sheet", () => {
  it("is not a list of codes, nor a table without a name or a price", () => {
    expect(readProductSheet("DD1391-100\nFV5029-010")).toBeNull();
    expect(readProductSheet("SKU\nDD1391-100")).toBeNull();
    expect(readProductSheet("Codice;Colore\nDD1391-100;Bianco")).toBeNull();
  });

  it("groups one row a size into one product, a row without a code continuing the one above", () => {
    const sheet = readProductSheet(
      [
        "Codice;Nome;Marca;Taglia;Prezzo;Pezzi;EAN;Foto;Categoria",
        "HM-1;Dunk fatta a mano;Nike;42;149,90;1;4006381333931;https://img.test/a.jpg | https://img.test/b.jpg;Scarpe > Sneakers",
        ";;;42.5;149,90;2;;;",
        "HM-1;;;43;159,90;0;;https://img.test/a.jpg;Saldi",
        "HM-2;Borsa;;;89,90;;;;",
      ].join("\n"),
    );
    expect(sheet?.columns).toEqual(["sku", "title", "brand", "size", "price", "stock", "barcode", "photos", "category"]);
    expect(sheet?.products).toEqual([
      {
        sku: "HM-1",
        rows: [2, 3, 4],
        title: "Dunk fatta a mano",
        brand: "Nike",
        categories: ["Scarpe > Sneakers", "Saldi"],
        description: "",
        sizes: [
          { label: "42", price: 149.9, stock: 1, barcode: "4006381333931" },
          { label: "42.5", price: 149.9, stock: 2, barcode: "" },
          { label: "43", price: 159.9, stock: 0, barcode: "" },
        ],
        photos: ["https://img.test/a.jpg", "https://img.test/b.jpg"],
        seo: { title: "", description: "", slug: "" },
        visible: null,
      },
      expect.objectContaining({ sku: "HM-2", title: "Borsa", sizes: [{ label: "Unica", price: 89.9, stock: null, barcode: "" }] }),
    ]);
  });

  it("takes one row a product with its sizes in one cell, pasted from a spreadsheet", () => {
    const sheet = readProductSheet("SKU\tTitle\tSizes\tPrice\tVisible\nhm-3\tHoodie\tS, M, L\t60\tno");
    expect(sheet?.products[0]).toMatchObject({
      sku: "hm-3",
      visible: false,
      sizes: [
        { label: "S", price: 60 },
        { label: "M", price: 60 },
        { label: "L", price: 60 },
      ],
    });
  });

  it("names the rows it could not attach to a product", () => {
    expect(readProductSheet("Codice,Nome\n,orfano\nHM-4,Cappello")?.unattached).toEqual([2]);
  });
});

describe("a sheet's categories", () => {
  const shop = [
    { id: 1, path: "Scarpe" },
    { id: 2, path: "Scarpe › Sneakers" },
    { id: 3, path: "Saldi" },
    { id: 4, path: "Uomo › Sneakers" },
  ];

  it("are the shop's, by path, or by a name only one category has", () => {
    expect(categoryKey("Scarpe › Sneakers")).toBe(categoryKey("scarpe > sneakers"));
    expect(matchCategories(["Scarpe > Sneakers", "saldi", "Sneakers", "Accessori"], shop)).toEqual({
      ids: [2, 3],
      unknown: ["Sneakers", "Accessori"],
    });
  });
});

describe("a sheet's product, made by hand", () => {
  it("is ready when it has a name and a price for each size; a size without pieces counts one", () => {
    const sheet = readProductSheet("Codice;Nome;Taglia;Prezzo\nHM-5;Felpa;M;60\nHM-5;;L;\nHM-6;Cappello;;25");
    const [felpa, cappello] = sheet!.products;
    expect(checkHandmade(sheetToHandmade(felpa, [])).ok).toBe(false);
    const ready = checkHandmade(sheetToHandmade(cappello, [7]));
    expect(ready.ok && ready.product).toMatchObject({
      sku: "HM-6",
      title: "Cappello",
      categoryIds: [7],
      sizes: [{ label: "Unica", price: 25, stock: 1 }],
      visible: true,
    });
  });
});
