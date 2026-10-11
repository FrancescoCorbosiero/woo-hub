import { describe, expect, it } from "vitest";
import { planMissingSizes, type MissingSizeRow } from "./missing-sizes-plan";
import type { StoreVariation } from "./model";

const SKU = "AR3566-002";
const vrt = (id: number, eu: string, gtin = ""): StoreVariation => ({
  id,
  sku: `${SKU}-EU${eu}`,
  regular_price: "138.00",
  global_unique_id: gtin,
  attributes: [{ id: 3, name: "pa_taglia", option: eu }],
});
const row = (eu: string, over: Partial<MissingSizeRow> = {}): MissingSizeRow => ({
  stockxVariantId: `gs:${SKU}:${eu}`,
  sizeLabel: eu,
  euSize: eu,
  proposedPrice: 138,
  stockQuantity: 5,
  ...over,
});
const parent = (options: string[]) => [
  { id: 7, name: "Brand", options: ["Nike"], variation: false },
  { id: 3, name: "pa_taglia", options, variation: true, visible: true },
];

describe("planMissingSizes", () => {
  it("creates only the sizes the product lacks, as Publish would, and lists them on the parent", () => {
    const plan = planMissingSizes({
      parentSku: SKU,
      parentAttributes: parent(["36"]),
      variations: [vrt(11, "36")],
      rows: [row("36"), row("36.5"), row("42", { upc: "0194276123456" })],
    });
    expect(plan.create.map((c) => c.label)).toEqual(["36.5", "42"]);
    expect(plan.skipped).toEqual([{ stockxVariantId: `gs:${SKU}:36`, reason: "onStore" }]);
    expect(plan.create[0].payload).toEqual({
      sku: "AR3566-002-EU36.5",
      attributes: [{ id: 3, option: "36.5" }],
      regular_price: "138.00",
      manage_stock: true,
      stock_quantity: 5,
      stock_status: "instock",
    });
    // The other attributes are untouched; pa_taglia gains the sizes, loses none.
    expect(plan.parentAttributes).toEqual([
      { id: 7, name: "Brand", options: ["Nike"], variation: false },
      { id: 3, name: "pa_taglia", options: ["36", "36.5", "42"], variation: true, visible: true },
    ]);
  });

  it("writes 2/3 sizes with their human label, also when the source labels them in US", () => {
    const plan = planMissingSizes({
      parentSku: SKU,
      parentAttributes: parent([]),
      variations: [],
      rows: [row("36.67", { sizeLabel: "36 2/3" }), row("40.67", { sizeLabel: "7.5" }), row("41.33", { sizeLabel: "8" })],
    });
    expect(plan.create.map((c) => c.label)).toEqual(["36 2/3", "40 2/3", "41 1/3"]);
  });

  it("leaves out sold-out, unpriced, unsized and repeated sizes", () => {
    const plan = planMissingSizes({
      parentSku: SKU,
      parentAttributes: parent(["36"]),
      variations: [vrt(11, "36")],
      rows: [
        row("37", { stockQuantity: 0 }),
        row("38", { proposedPrice: null }),
        row("x", { euSize: null, sizeLabel: "M" }),
        row("39"),
        row("39", { stockxVariantId: "other" }),
      ],
    });
    expect(plan.create.map((c) => c.label)).toEqual(["39"]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["noStock", "noPrice", "noSize", "duplicate"]);
  });

  it("sells KicksDB sizes on demand, and never writes a barcode another size already has", () => {
    const plan = planMissingSizes({
      parentSku: SKU,
      parentAttributes: parent(["36"]),
      variations: [vrt(11, "36", "0194276123456")],
      rows: [row("37", { stockQuantity: undefined, upc: "0194276123456" })],
    });
    expect(plan.create[0].payload).toMatchObject({ manage_stock: false, stock_status: "instock" });
    expect(plan.create[0].payload).not.toHaveProperty("global_unique_id");
  });

  it("puts the sizes the product already sells back on a parent that lost them from its list", () => {
    const plan = planMissingSizes({
      parentSku: SKU,
      parentAttributes: parent([]),
      variations: [vrt(11, "36"), vrt(12, "38")],
      rows: [row("37")],
    });
    expect(plan.parentAttributes?.[1]).toMatchObject({ options: ["36", "37", "38"] });
  });

  it("has nothing to do when every size is on the store", () => {
    const plan = planMissingSizes({
      parentSku: SKU,
      parentAttributes: parent(["36"]),
      variations: [vrt(11, "36")],
      rows: [row("36")],
    });
    expect(plan.create).toEqual([]);
    expect(plan.parentAttributes).toBeNull();
  });
});
