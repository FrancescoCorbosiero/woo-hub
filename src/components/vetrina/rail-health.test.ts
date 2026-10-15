import { describe, expect, it } from "vitest";
import { homeEn } from "@/i18n/dictionaries/catalog/home.en";
import { homeIt } from "@/i18n/dictionaries/catalog/home.it";
import type { ProductCard } from "@/lib/vetrina/types";
import { railHealth } from "./rail-health";

function card(id: number, extra: Partial<ProductCard> = {}): ProductCard {
  return {
    id,
    sku: `SKU-${id}`,
    name: `Product ${id}`,
    type: "variable",
    status: "publish",
    visibility: "visible",
    stockStatus: "instock",
    price: 100,
    priceMax: null,
    onSale: false,
    image: "https://shop.example/thumb.jpg",
    permalink: "",
    editLink: "",
    created: null,
    ...extra,
  };
}

const it_ = homeIt.rail;

describe("railHealth: the rail card's «esauriti / nascosti» line", () => {
  it("is empty when everything the section shows can be bought and found", () => {
    expect(railHealth({ limit: 8, products: [card(1), card(2)] }, it_)).toBe("");
    expect(railHealth({ limit: 8, products: [] }, it_)).toBe("");
  });

  it("counts the sold out and the hidden from the shop, in agreement with the count", () => {
    const products = [
      card(1, { stockStatus: "outofstock" }),
      card(2, { visibility: "hidden" }),
      card(3),
      card(4, { stockStatus: "outofstock" }),
    ];
    expect(railHealth({ limit: 8, products }, it_)).toBe("2 esauriti · 1 nascosto dal negozio");
    expect(railHealth({ limit: 8, products: [card(1, { stockStatus: "outofstock" })] }, it_)).toBe("1 esaurito");
    expect(railHealth({ limit: 8, products }, homeEn.rail)).toBe("2 sold out · 1 hidden from the shop");
  });

  it("counts a product both sold out and hidden in each", () => {
    const products = [card(1, { stockStatus: "outofstock", visibility: "hidden" })];
    expect(railHealth({ limit: 8, products }, it_)).toBe("1 esaurito · 1 nascosto dal negozio");
  });

  it("only what the section shows: past its size, and products gone from the shop, do not count", () => {
    const products = [
      card(1),
      card(2, { missing: true, stockStatus: "outofstock" }),
      card(3, { visibility: "hidden" }),
      card(4, { stockStatus: "outofstock" }),
    ];
    // Shows 3: Product 4 is past the section's size; Product 2 is gone.
    expect(railHealth({ limit: 3, products }, it_)).toBe("1 nascosto dal negozio");
  });

  it("counts a product shown without a photo", () => {
    const products = [card(1, { image: "" }), card(2), card(3, { image: "", stockStatus: "outofstock" })];
    expect(railHealth({ limit: 8, products }, it_)).toBe("1 esaurito · 2 senza foto");
    expect(railHealth({ limit: 8, products }, homeEn.rail)).toBe("1 sold out · 2 without a photo");
  });

  it("«solo nel catalogo» or «solo nella ricerca» is not hidden from the shop", () => {
    const products = [card(1, { visibility: "catalog" }), card(2, { visibility: "search" })];
    expect(railHealth({ limit: 8, products }, it_)).toBe("");
  });
});
