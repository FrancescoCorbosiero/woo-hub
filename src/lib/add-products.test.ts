import { describe, expect, it } from "vitest";
import { codesIn, groupLookups, splitEntry, splitRow, type AddLookup } from "./add-products";

describe("the codes the owner writes", () => {
  it("are one per line, or separated by commas, semicolons or tabs, each once", () => {
    expect(splitEntry("DD1391-100\ncw2288-111, FV5029-010;DD1391-100\n\n  ")).toEqual(["DD1391-100", "cw2288-111", "FV5029-010"]);
  });

  it("keep a code written with a space whole, and split a line of codes", () => {
    expect(splitEntry("DD1391 100")).toEqual(["DD1391 100"]);
    expect(splitEntry("DD1391-100 CW2288-111")).toEqual(["DD1391-100", "CW2288-111"]);
  });

  it("drop a pasted column's header, quotes, and anything as long as a sentence", () => {
    expect(splitEntry('SKU\n"DD1391-100"\nCodice')).toEqual(["DD1391-100"]);
    expect(splitEntry(`${"x".repeat(80)}\nB75806`)).toEqual(["B75806"]);
  });

  it("keep a code the owner made up, without digits", () => {
    expect(splitEntry("BORSA-NERA")).toEqual(["BORSA-NERA"]);
  });
});

describe("the codes in a table", () => {
  it("are the column headed like codes, in a CSV or a spreadsheet's paste", () => {
    const csv = 'Nome;SKU;Prezzo\n"Dunk Low; Panda";DD1391-100;120\nJordan 4;FV5029-010;250';
    expect(codesIn(csv)).toEqual(["DD1391-100", "FV5029-010"]);
    expect(codesIn("Codice\tNome\nB75806\tSamba\nIE3437\tGazelle")).toEqual(["B75806", "IE3437"]);
  });

  it("are the first column of a table without a header", () => {
    expect(codesIn("DD1391-100\tDunk\t120\nFV5029-010\tJordan\t250")).toEqual(["DD1391-100", "FV5029-010"]);
    expect(codesIn("DD1391-100,Dunk,120\nFV5029-010,Jordan,250\nB75806,Samba,100")).toEqual(["DD1391-100", "FV5029-010", "B75806"]);
  });

  it("leave a list a list: a line of codes separated by commas", () => {
    expect(codesIn("DD1391-100, CW2288-111")).toEqual(["DD1391-100", "CW2288-111"]);
    expect(codesIn("DD1391-100\nCW2288-111")).toEqual(["DD1391-100", "CW2288-111"]);
  });

  it("split a row on its delimiter, a quoted cell kept whole", () => {
    expect(splitRow('a,"b, c",d', ",")).toEqual(["a", "b, c", "d"]);
    expect(splitRow('"say ""hi""";x', ";")).toEqual(['say "hi"', "x"]);
  });
});

describe("the look-ups, grouped", () => {
  const one = (sku: string, route: AddLookup["route"]): AddLookup => ({ sku, route, title: null, brand: null, image: null, sizes: 0, productId: null });

  it("ready with one tap, by hand, on the shop, unanswered", () => {
    const groups = groupLookups([
      one("A", "feed"),
      one("B", "unknown"),
      one("C", "onStore"),
      one("D", "kicksdb"),
      one("E", "noSizes"),
      one("F", "unreachable"),
      one("G", "catalog"),
      one("H", "delisted"),
    ]);
    expect(groups.ready.map((l) => l.sku)).toEqual(["A", "D", "G"]);
    expect(groups.byHand.map((l) => l.sku)).toEqual(["B", "E", "H"]);
    expect(groups.onStore.map((l) => l.sku)).toEqual(["C"]);
    expect(groups.unreachable.map((l) => l.sku)).toEqual(["F"]);
  });
});
