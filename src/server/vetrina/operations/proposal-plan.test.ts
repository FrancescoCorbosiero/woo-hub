import { describe, expect, it } from "vitest";
import type { OperationPreview } from "@/lib/vetrina/catalog-ops";
import { digestOf, stableJson, summaryOf } from "./proposal-plan";

const sale: OperationPreview = {
  kind: "sale",
  changes: 12,
  untouched: [
    { reason: "già in saldo", count: 3 },
    { reason: "senza prezzo", count: 1 },
  ],
  sample: [{ id: 4810, name: "Nike Dunk Low Panda", before: "129,00 €", after: "102,99 €" }],
  warnings: ["12 sono anche in Nike: lì vanno in saldo allo stesso modo."],
};

describe("a preview's fingerprint", () => {
  it("is the same for the same preview, however its keys were put", () => {
    const shuffled = { warnings: sale.warnings, sample: sale.sample, untouched: sale.untouched, changes: 12, kind: "sale" } as OperationPreview;
    expect(digestOf(shuffled)).toBe(digestOf(sale));
    expect(stableJson({ b: 1, a: [2, { d: 3, c: undefined }] })).toBe('{"a":[2,{"d":3}],"b":1}');
  });

  it("changes with anything the owner was shown", () => {
    expect(digestOf({ ...sale, changes: 13 })).not.toBe(digestOf(sale));
    expect(digestOf({ ...sale, sample: [{ ...sale.sample[0], after: "103,00 €" }] })).not.toBe(digestOf(sale));
    expect(digestOf({ ...sale, warnings: [] })).not.toBe(digestOf(sale));
  });
});

describe("a preview in sentences", () => {
  it("says what changes, an example, what stays and why, then the warnings", () => {
    expect(summaryOf({ kind: "sale", count: 12, percent: 20, term: "Nike" }, sale)).toEqual([
      "Saldo −20% · Nike",
      "Cambia 12 prodotti.",
      "Restano come sono: 3 già in saldo e 1 senza prezzo.",
      "Nike Dunk Low Panda: 129,00 € → 102,99 €",
      "12 sono anche in Nike: lì vanno in saldo allo stesso modo.",
    ]);
  });

  it("says when the numbers are an estimate on the products read", () => {
    const lines = summaryOf({ kind: "sale", count: 40, percent: 20 }, { ...sale, changes: 40, sampled: 20 });
    expect(lines).toContain("I numeri sono una stima sui primi 20 prodotti letti dal negozio: l'azione conta esatto.");
  });

  it("tells a homepage action by its own sentences", () => {
    const preview: OperationPreview = {
      kind: "sectionSwitch",
      changes: 1,
      untouched: [],
      sample: [],
      warnings: [],
      page: { lines: ["«SALDI» resta nella homepage ma non si vede più sul sito."] },
    };
    expect(summaryOf({ kind: "sectionSwitch", count: 1, section: "SALDI", on: false }, preview)).toEqual([
      "«SALDI» spenta sul sito",
      "«SALDI» resta nella homepage ma non si vede più sul sito.",
    ]);
  });
});
