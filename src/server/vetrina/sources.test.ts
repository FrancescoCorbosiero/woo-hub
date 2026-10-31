import { describe, expect, it, vi } from "vitest";

// No database: only the rule.
vi.mock("@/lib/env", () => ({ env: {} }));

import { isDeletable } from "@/lib/vetrina/catalog";
import { productSource, type SourceFacts } from "./sources";

const facts = (over: Partial<SourceFacts> = {}): SourceFacts => ({
  carried: new Set(),
  listed: new Set(),
  catalog: new Map(),
  pinned: new Set(),
  ...over,
});

describe("where a product comes from", () => {
  it("the feed first: a product it carries is the supplier's, whatever the catalog or a pin say — and Elimina refuses it", () => {
    const f = facts({ carried: new Set(["DD1391-100"]), listed: new Set(["DD1391-100"]), catalog: new Map([["DD1391-100", "kicksdb"]]) });
    expect(productSource("DD1391-100", f)).toBe("goldensneakers");
    // Pinned to KicksDB's prices: the feed still decides it is in the shop, and would bring it back.
    expect(productSource("DD1391-100", { ...f, pinned: new Set(["DD1391-100"]) })).toBe("goldensneakers");
    expect(isDeletable("goldensneakers")).toBe(false);
  });

  it("a product the feed dropped is delisted — unless the Hub pinned it to KicksDB, which prices it now", () => {
    const f = facts({ listed: new Set(["FB2207-001"]), catalog: new Map([["FB2207-001", "kicksdb"]]) });
    expect(productSource("FB2207-001", f)).toBe("delisted");
    expect(productSource("FB2207-001", { ...f, pinned: new Set(["FB2207-001"]) })).toBe("kicksdb");
    // A catalog row the feed registered, its rows since gone: still the feed's, dropped.
    expect(productSource("GS-ONLY", facts({ catalog: new Map([["GS-ONLY", "goldensneakers"]]) }))).toBe("delisted");
    expect(isDeletable("delisted")).toBe(true);
  });

  it("the catalog's KicksDB rows are the Hub's own picks; the rest was made in the shop", () => {
    const f = facts({ catalog: new Map([["CW2288-111", "kicksdb"], ["HANDMADE-1", "woo"]]) });
    expect(productSource("CW2288-111", f)).toBe("kicksdb");
    expect(productSource("HANDMADE-1", f)).toBe("woo");
    expect(productSource("NOWHERE-1", f)).toBe("woo");
    expect([isDeletable("kicksdb"), isDeletable("woo")]).toEqual([true, true]);
  });

  it("reads a SKU as the feed and the catalog file it: any case, spaces around; none links nothing", () => {
    const f = facts({ carried: new Set(["DD1391-100"]), listed: new Set(["DD1391-100"]) });
    expect(productSource(" dd1391-100 ", f)).toBe("goldensneakers");
    expect(productSource("", f)).toBe("woo");
  });
});
