import { describe, it, expect } from "vitest";
import { decideLiveWrites } from "./live-check";
import type { ApplyChange } from "./apply";

const change = (over: Partial<ApplyChange> = {}): ApplyChange => ({
  sku: "DD1391-100",
  sizeLabel: "42",
  stockxVariantId: "v42",
  storeProductId: 7,
  storeVariationId: 71,
  currentPrice: 120,
  newPrice: 110,
  newStock: null,
  newGtin: null,
  euSize: "42",
  ...over,
});

const live = (id: number, price: string | null, gtin: string | null = null, qty: number | null = null) => ({
  id,
  regular_price: price,
  global_unique_id: gtin,
  manage_stock: qty != null,
  stock_quantity: qty,
});

/** A live size on sale: the regular price as planned, a sale price on top. */
const onSale = (id: number, price: string, sale: string, qty: number | null = null) => ({ ...live(id, price, null, qty), sale_price: sale });

describe("decideLiveWrites — the last look before a live write", () => {
  it("writes as planned while the store is where the plan left it", () => {
    const d = decideLiveWrites([change()], [live(71, "120.00")]);
    expect(d.write).toEqual([change()]);
    expect(d.kept).toEqual([]);
    expect(d.gone).toEqual([]);
  });

  it("keeps a price changed on the store since the plan was made", () => {
    const d = decideLiveWrites([change()], [live(71, "149.99")]);
    expect(d.write).toEqual([]); // nothing else to write on that size
    expect(d.kept).toEqual([{ change: change(), storePrice: 149.99 }]);
  });

  it("still writes the stock of a size whose price it keeps", () => {
    const d = decideLiveWrites([change({ newStock: 2 })], [live(71, "149.99", null, 5)]);
    expect(d.write).toEqual([change({ newStock: 2, newPrice: null })]);
    expect(d.kept).toHaveLength(1);
  });

  it("…but not a quantity the store already shows: nothing is left to write", () => {
    const d = decideLiveWrites([change({ newStock: 2 })], [live(71, "149.99", null, 2)]);
    expect(d.write).toEqual([]);
    expect(d.kept).toHaveLength(1);
  });

  it("someone set exactly the price the Hub wanted: written, nothing to keep", () => {
    const d = decideLiveWrites([change()], [live(71, "110.00")]);
    expect(d.write).toEqual([change()]);
    expect(d.kept).toEqual([]);
  });

  it("a size gone from the store is not written to", () => {
    const d = decideLiveWrites([change(), change({ storeVariationId: 72, stockxVariantId: "v43" })], [live(71, "120")]);
    expect(d.write.map((c) => c.storeVariationId)).toEqual([71]);
    expect(d.gone.map((c) => c.storeVariationId)).toEqual([72]);
  });

  it("a price taken off the store is not written over, and there is nothing to keep", () => {
    const d = decideLiveWrites([change()], [live(71, "")]);
    expect(d.write).toEqual([]);
    expect(d.kept).toEqual([]);
  });

  it("a size the snapshot knew without a price is written when it still has none", () => {
    const d = decideLiveWrites([change({ currentPrice: null })], [live(71, null)]);
    expect(d.write).toEqual([change({ currentPrice: null })]);
  });

  it("an identifier that appeared meanwhile is never overwritten", () => {
    const d = decideLiveWrites([change({ newGtin: "0195866123456", newPrice: null, newStock: 1 })], [live(71, "120", "0195866999999")]);
    expect(d.write).toEqual([change({ newGtin: null, newPrice: null, newStock: 1 })]);
  });

  it("stock-only changes go through whatever the store's price is", () => {
    const d = decideLiveWrites([change({ newPrice: null, newStock: 0 })], [live(71, "999")]);
    expect(d.write).toEqual([change({ newPrice: null, newStock: 0 })]);
    expect(d.kept).toEqual([]);
  });

  describe("a size put on sale since the plan was made", () => {
    const yields = { yieldsToSale: () => true };

    it("keeps its price while the product follows the sale rule — the plan would have held it", () => {
      const d = decideLiveWrites([change()], [onSale(71, "120.00", "99.00")], yields);
      expect(d.write).toEqual([]);
      expect(d.onSale).toEqual([change()]);
      expect(d.kept).toEqual([]); // a sale is not a price changed on WordPress
    });

    it("still writes its stock", () => {
      const d = decideLiveWrites([change({ newStock: 1 })], [onSale(71, "120.00", "99.00", 4)], yields);
      expect(d.write).toEqual([change({ newStock: 1, newPrice: null })]);
      expect(d.onSale).toHaveLength(1);
    });

    it("is written when the size gives no way to sales: a lock, or a product repricing its discounted sizes", () => {
      const d = decideLiveWrites([change()], [onSale(71, "120.00", "99.00")], { yieldsToSale: () => false });
      expect(d.write).toEqual([change()]);
      expect(d.onSale).toEqual([]);
    });

    it("an empty or zero sale price is no sale", () => {
      const d = decideLiveWrites([change(), change({ storeVariationId: 72, stockxVariantId: "v43" })], [onSale(71, "120.00", ""), onSale(72, "120.00", "0")], yields);
      expect(d.write.map((c) => c.storeVariationId)).toEqual([71, 72]);
    });

    it("without the Hub's rules nothing gives way (the default)", () => {
      const d = decideLiveWrites([change()], [onSale(71, "120.00", "99.00")]);
      expect(d.write).toEqual([change()]);
    });
  });

  describe("a size a person decided just now", () => {
    const decided = (c: { storeVariationId: number }) => c.storeVariationId === 71;

    it("is written though the store moved since the plan — the decision is the newer word", () => {
      const d = decideLiveWrites([change(), change({ storeVariationId: 72, stockxVariantId: "v43" })], [live(71, "149.99"), live(72, "135.00")], { decided });
      expect(d.write).toEqual([change()]);
      // The size nobody decided is kept, as always.
      expect(d.kept).toEqual([{ change: change({ storeVariationId: 72, stockxVariantId: "v43" }), storePrice: 135 }]);
    });

    it("still gives way to a sale when its size does (a lock does not: see yieldsToSale)", () => {
      const d = decideLiveWrites([change()], [onSale(71, "149.99", "99.00")], { decided, yieldsToSale: () => true });
      expect(d.write).toEqual([]);
      expect(d.onSale).toHaveLength(1);
      expect(d.kept).toEqual([]);
    });
  });
});
