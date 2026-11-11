import { describe, expect, it } from "vitest";
import type { AppConfig } from "@core/config";
import type { SourceProduct } from "@core/core-spine";
import { checkHandmade, type HandmadeInput, type HandmadeProduct } from "@/lib/handmade";
import { buildDefaultConfig } from "@/server/config/defaults";
import { planPublish } from "@/server/woo/publish-plan";
import { handmadeSizeLabel, handmadeVariationSku, planHandmade } from "./handmade-plan";

const config: AppConfig = buildDefaultConfig({
  kicksDbApiKey: "",
  woo: { baseUrl: "", consumerKey: "", consumerSecret: "" },
  marketToCurrency: { IT: "EUR" },
});

function made(over: Partial<HandmadeInput> = {}): HandmadeProduct {
  const result = checkHandmade({
    sku: "hm-abc123",
    title: "Dunk fatta a mano",
    sizes: [
      { label: "43", price: 150, stock: 1 },
      { label: "42,5", price: 140.5, stock: 0 },
    ],
    visible: true,
    ...over,
  });
  if (!result.ok) throw new Error(`invalid: ${result.invalid.join(", ")}`);
  return result.product;
}

describe("a product made by hand, planned", () => {
  it("is a variable product on pa_taglia, its sizes in order, each priced and counted", () => {
    const plan = planHandmade({ product: made(), tagliaAttributeId: 7 });
    expect(plan.sku).toBe("HM-ABC123");
    expect(plan.parentBody).toMatchObject({
      name: "Dunk fatta a mano",
      type: "variable",
      sku: "HM-ABC123",
      // No photo: hidden, whatever the switch says.
      status: "draft",
      attributes: [{ id: 7, name: "pa_taglia", variation: true, visible: true, options: ["42.5", "43"] }],
    });
    expect(plan.variations.map((v) => v.payload)).toEqual([
      {
        sku: "HM-ABC123-EU42.5",
        attributes: [{ id: 7, option: "42.5" }],
        regular_price: "140.50",
        manage_stock: true,
        stock_quantity: 0,
        stock_status: "outofstock",
      },
      {
        sku: "HM-ABC123-EU43",
        attributes: [{ id: 7, option: "43" }],
        regular_price: "150.00",
        manage_stock: true,
        stock_quantity: 1,
        stock_status: "instock",
      },
    ]);
  });

  it("writes an EU size exactly as Publish writes it: the same label, the same SKU", () => {
    const sizes = ["36 2/3", "42.5", "44"];
    const catalog: SourceProduct = {
      stockxId: "",
      sku: "HM-ABC123",
      title: "x",
      brand: "",
      image: "",
      market: "IT",
      currency: "EUR",
      variants: sizes.map((label, i) => ({ stockxVariantId: `v${i}`, sizeLabel: label, sizeType: "eu", offers: [] })),
    };
    const manualPrices = Object.fromEntries(sizes.map((s, i) => [String(Number(s.includes("/") ? 36.67 : s)), 100 + i]));
    const published = planPublish({ catalog, config, manualPrices, tagliaAttributeId: 7 });
    const handmade = planHandmade({
      product: made({ sizes: sizes.map((label, i) => ({ label, price: 100 + i, stock: 1 })) }),
      tagliaAttributeId: 7,
    });
    expect(handmade.variations.map((v) => [v.sku, v.sizeLabel, v.payload.attributes, v.payload.regular_price])).toEqual(
      published.variations.map((v) => [v.sku, v.sizeLabel, v.payload.attributes, v.payload.regular_price]),
    );
    expect(handmade.parentBody.attributes).toEqual(published.parentBody.attributes);
  });

  it("gives a clothes size and the one size their own label and SKU", () => {
    expect(handmadeSizeLabel("m")).toBe("M");
    // A word stays as written; only short sizes are upper-cased.
    expect(handmadeSizeLabel("Unica")).toBe("Unica");
    expect(handmadeVariationSku("hm-1", "xl")).toBe("HM-1-XL");
    expect(handmadeVariationSku("hm-1", "Unica")).toBe("HM-1-UNICA");
    expect(handmadeVariationSku("hm-1", "42,5")).toBe("HM-1-EU42.5");
    const plan = planHandmade({
      product: made({
        sizes: [
          { label: "XL", price: 60, stock: 3 },
          { label: "s", price: 60, stock: 1 },
        ],
      }),
    });
    expect(plan.variations.map((v) => [v.sizeLabel, v.sku])).toEqual([
      ["S", "HM-ABC123-S"],
      ["XL", "HM-ABC123-XL"],
    ]);
    // Without the attribute's id, bound by name — as Publish does.
    expect(plan.variations[0].payload.attributes).toEqual([{ name: "pa_taglia", option: "S" }]);
  });

  it("goes on sale at once with an uploaded photo; a linked one waits for the queue", () => {
    const uploaded = planHandmade({ product: made({ photos: [{ id: 5, url: "https://shop.test/a.jpg" }, { url: "https://cdn.test/b.jpg" }] }) });
    expect(uploaded.status).toBe("publish");
    expect(uploaded.parentBody.images).toEqual([{ id: 5 }]);
    expect(uploaded.photoUrls).toEqual(["https://cdn.test/b.jpg"]);

    const linked = planHandmade({ product: made({ photos: [{ url: "https://cdn.test/b.jpg" }, { url: "https://cdn.test/b.jpg" }] }) });
    expect(linked.status).toBe("draft");
    expect(linked.parentBody.images).toBeUndefined();
    expect(linked.photoUrls).toEqual(["https://cdn.test/b.jpg"]);

    const hidden = planHandmade({ product: made({ visible: false, photos: [{ id: 5 }] }) });
    expect(hidden.status).toBe("draft");
  });

  it("writes only valid barcodes, each to one size", () => {
    const plan = planHandmade({
      product: made({
        sizes: [
          { label: "42", price: 100, stock: 1, barcode: "0195866123458" },
          { label: "43", price: 100, stock: 1, barcode: "0195866123458" },
          { label: "44", price: 100, stock: 1, barcode: "123" },
          { label: "45", price: 100, stock: 1, barcode: "4006381333931" },
        ],
      }),
    });
    expect(plan.variations.map((v) => v.payload.global_unique_id ?? null)).toEqual([null, null, null, "4006381333931"]);
    expect(plan.rejectedGtins.map((r) => [r.sizeLabel, r.reason]).sort()).toEqual([
      ["42", "duplicate"],
      ["43", "duplicate"],
      ["44", expect.any(String)],
    ]);
  });

  it("takes the owner's categories, the brand both ways, the address and the SEO fields", () => {
    const plan = planHandmade({
      product: made({ categoryIds: [3, 9], description: "Bella.\n\nNuova.", seo: { title: "", description: "", slug: "Dunk Fatta a Mano!" } }),
      identity: { brandId: 11, categoryIds: [99], attributes: [{ id: 4, option: "Nike", field: "brand" }] },
      meta: [{ key: "rank_math_title", value: "Dunk" }],
    });
    expect(plan.parentBody).toMatchObject({
      brands: [{ id: 11 }],
      categories: [{ id: 3 }, { id: 9 }],
      slug: "dunk-fatta-a-mano",
      description: "<p>Bella.</p>\n<p>Nuova.</p>",
      meta_data: [{ key: "rank_math_title", value: "Dunk" }],
    });
    expect((plan.parentBody.attributes as { id?: number; options: string[] }[]).at(-1)).toMatchObject({ id: 4, options: ["Nike"], variation: false });
    // No category chosen: none written, never the resolver's guess.
    const none = planHandmade({ product: made(), identity: { categoryIds: [99] } });
    expect(none.parentBody.categories).toBeUndefined();
  });
});
