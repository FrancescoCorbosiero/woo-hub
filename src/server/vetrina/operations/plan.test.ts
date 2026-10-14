import { describe, expect, it } from "vitest";
import type { OperationInput } from "@/lib/vetrina/catalog-ops";
import {
  NO_SALE,
  dayIn,
  euro,
  keptForTerm,
  labelParams,
  labelText,
  listAfter,
  otherTerms,
  pinList,
  planSale,
  planUnsale,
  priceCents,
  productSkip,
  raisesPrice,
  salePriceCents,
  salePriceWords,
  saleOf,
  sameSale,
  sectionCounts,
  standingHide,
  standingSale,
  standingSales,
  undoList,
  undoVerdict,
  undoable,
  visibilityAfter,
  type LiveSize,
  type OperationFacts,
} from "./plan";
import { words } from "./words";

/** Intl writes "€" after a non-breaking space: the tests write a plain one. */
const plain = (text: string) => text.replace(/\u00a0/g, " ");

const size = (variationId: number | null, regular: string | null, sale = ""): LiveSize => ({
  variationId,
  regular: priceCents(regular),
  sale: saleOf({ sale_price: sale }),
});

describe("prices", () => {
  it("reads the store's prices in cents and writes them back as the store takes them", () => {
    expect(priceCents("129.00")).toBe(12900);
    expect(priceCents("102.99")).toBe(10299);
    expect(priceCents(119)).toBe(11900);
    expect(priceCents("0")).toBeNull();
    expect(priceCents("")).toBeNull();
    expect(priceCents(null)).toBeNull();
    expect(priceCents("abc")).toBeNull();
    // As the catalog's lists write a price.
    expect(plain(euro(12900))).toBe("129,00 €");
    expect(plain(euro(10299))).toBe("102,99 €");
    // Italian groups thousands from five digits on, as the lists do.
    expect(plain(euro(129900))).toBe("1299,00 €");
    expect(plain(euro(1299900))).toBe("12.999,00 €");
    expect(plain(euro(905))).toBe("9,05 €");
  });

  it("charm: down to the largest x,99 not above the discounted price, from 10 € up", () => {
    // 129 − 20% = 103,20 → 102,99 (the contract's example)
    expect(salePriceCents(12900, 20, "charm")).toBe(10299);
    // Exactly on a ,99 stays there.
    expect(salePriceCents(12874, 20, "charm")).toBe(10299); // 102,992 → 102,99
    // 103,00 → 102,99: never rounded up to 103,99.
    expect(salePriceCents(12875, 20, "charm")).toBe(10299);
    // 10,00 is already ≥ 10 €: 9,99 is the largest x,99 not above it.
    expect(salePriceCents(2000, 50, "charm")).toBe(999);
    // Below 10 €: to the cent, down.
    expect(salePriceCents(1199, 20, "charm")).toBe(959); // 9,592 → 9,59
  });

  it("exact: down to the cent, never a smaller discount than announced", () => {
    expect(salePriceCents(12900, 20, "exact")).toBe(10320);
    expect(salePriceCents(9999, 15, "exact")).toBe(8499); // 84,9915 → 84,99
    expect(salePriceCents(1, 50, "exact")).toBe(0);
  });
});

describe("planning a sale", () => {
  const spec = { percent: 20, rounding: "charm" as const, endsOn: null };

  it("writes each size's sale price from its own regular price, with no dates unless an end is chosen", () => {
    const plans = planSale([size(1, "129.00"), size(2, "139.00")], spec);
    expect(plans).toEqual([
      { variationId: 1, write: true, before: NO_SALE, after: { price: "102.99", from: null, to: null } },
      { variationId: 2, write: true, before: NO_SALE, after: { price: "110.99", from: null, to: null } },
    ]);
    const ending = planSale([size(1, "129.00")], { ...spec, endsOn: "2026-10-31" });
    expect(ending[0]).toMatchObject({ write: true, after: { to: "2026-10-31T23:59:59", from: null } });
  });

  it("skips a size without a regular price, where the sale would not be lower, or already on this very sale", () => {
    const plans = planSale(
      [size(1, null), size(2, "0.01"), size(3, "129.00", "102.99"), size(4, "129.00", "99.00")],
      { percent: 1, rounding: "exact", endsOn: null },
    );
    expect(plans.map((p) => (p.write ? "write" : p.reason))).toEqual(["noPrice", "notLower", "write", "write"]);
    const same = planSale([size(3, "129.00", "102.99")], spec);
    expect(same[0]).toMatchObject({ write: false, reason: "same" });
  });

  it("records the size's previous sale, dates included, to put it back", () => {
    const sized: LiveSize = {
      variationId: 9,
      regular: 15000,
      sale: saleOf({ sale_price: "135.00", date_on_sale_from: "2026-10-01T00:00:00", date_on_sale_to: "" }),
    };
    const [plan] = planSale([sized], spec);
    expect(plan).toMatchObject({ write: true, before: { price: "135.00", from: "2026-10-01T00:00:00", to: null } });
  });

  it("never touches the regular price: a plan only carries sale states", () => {
    const [plan] = planSale([size(1, "129.00")], spec);
    expect(JSON.stringify(plan)).not.toContain("regular");
  });

  it("ends a sale only on the sizes that have one", () => {
    const plans = planUnsale([size(1, "129.00", "102.99"), size(2, "129.00")]);
    expect(plans).toEqual([
      { variationId: 1, write: true, before: { price: "102.99", from: null, to: null }, after: NO_SALE },
      { variationId: 2, write: false, reason: "noSale" },
    ]);
  });

  it("says why a product is left alone, and its prices before → after", () => {
    expect(productSkip(planSale([size(1, null), size(2, null)], spec))).toBe("noPrice");
    expect(productSkip(planSale([size(1, null), size(2, "129.00")], spec))).toBeNull();
    expect(productSkip([])).toBe("noPrice");
    const sizes = [size(1, "129.00"), size(2, "139.00")];
    const words2 = (w: { before: string; after: string }) => ({ before: plain(w.before), after: plain(w.after) });
    expect(words2(salePriceWords(sizes, planSale(sizes, spec)))).toEqual({ before: "da 129,00 €", after: "da 102,99 €" });
    const one = [size(1, "129.00", "102.99")];
    expect(words2(salePriceWords(one, planUnsale(one)))).toEqual({ before: "102,99 €", after: "129,00 €" });
    expect(words2(salePriceWords(one, planUnsale(one), words("en")))).toEqual({ before: "102,99 €", after: "129,00 €" });
    expect(salePriceWords(sizes, planSale(sizes, spec), words("en")).before).toMatch(/^from /);
  });

  it("knows when a sale puts a price up: a deeper sale of the size's own, replaced", () => {
    const deeper = [size(1, "129.00", "80.00")];
    expect(raisesPrice(deeper, planSale(deeper, spec))).toBe(true);
    const shallow = [size(1, "129.00", "120.00")];
    expect(raisesPrice(shallow, planSale(shallow, spec))).toBe(false);
    const none = [size(1, "129.00")];
    expect(raisesPrice(none, planSale(none, spec))).toBe(false);
  });

  it("compares sales to the cent and the day, as the store answers them", () => {
    expect(sameSale({ price: "102.990", from: null, to: "2026-10-31T23:59:59" }, { price: "102.99", from: "", to: "2026-10-31" } as never)).toBe(
      true,
    );
    expect(sameSale(NO_SALE, { price: "1.00", from: null, to: null })).toBe(false);
  });
});

describe("visibility, tags and categories", () => {
  it("hides what is not hidden, and shows only what is hidden", () => {
    expect(visibilityAfter("hide", "visible")).toBe("hidden");
    expect(visibilityAfter("hide", "search")).toBe("hidden");
    expect(visibilityAfter("hide", "hidden")).toBeNull();
    expect(visibilityAfter("show", "hidden")).toBe("visible");
    // "Only in search" was someone's choice: "Mostra" leaves it.
    expect(visibilityAfter("show", "search")).toBeNull();
  });

  it("adds or removes one term on the whole list, or says nothing changes", () => {
    expect(listAfter([1, 2], { add: 3 })).toEqual([1, 2, 3]);
    expect(listAfter([1, 2], { add: 2 })).toBeNull();
    expect(listAfter([1, 2], { remove: 1 })).toEqual([2]);
    expect(listAfter([1, 2], { remove: 5 })).toBeNull();
  });
});

describe("pins", () => {
  it("puts the targets first in the order given, then the earlier pins without them", () => {
    expect(pinList([7, 3], [1, 3, 2], 60)).toEqual({ pin: [7, 3, 1, 2], placed: [7, 3], overflow: [], dropped: [] });
    expect(pinList([3, 3, 7], [], 60).placed).toEqual([3, 7]);
  });

  it("stops at the ceiling: earlier pins pushed out, targets past it left as they are", () => {
    expect(pinList([5, 6], [1, 2, 3], 3)).toEqual({ pin: [5, 6, 1], placed: [5, 6], overflow: [], dropped: [2, 3] });
    expect(pinList([5, 6, 7, 8], [1], 3)).toEqual({ pin: [5, 6, 7], placed: [5, 6, 7], overflow: [8], dropped: [1] });
  });
});

describe("undo", () => {
  const same = (a: string, b: string) => a === b;

  it("writes back only where the store still shows what the action wrote", () => {
    expect(undoVerdict("hidden", "visible", "hidden", same)).toBe("restore");
    expect(undoVerdict("visible", "visible", "hidden", same)).toBe("already");
    // Someone set "search only" since: the newer word stands.
    expect(undoVerdict("search", "visible", "hidden", same)).toBe("changed");
    expect(undoVerdict("hidden", "hidden", "hidden", same)).toBe("already");
  });

  it("compares a sale to the cent and the day", () => {
    const after = { price: "102.99", from: null, to: null };
    expect(undoVerdict({ price: "102.99", from: null, to: null }, NO_SALE, after, sameSale)).toBe("restore");
    // Ended by WooCommerce at its date, or by hand: nothing to put back.
    expect(undoVerdict(NO_SALE, NO_SALE, after, sameSale)).toBe("already");
    // Re-priced by hand since: left alone.
    expect(undoVerdict({ price: "99.00", from: null, to: null }, NO_SALE, after, sameSale)).toBe("changed");
  });

  it("takes a list's change back around what was added since", () => {
    // Tag 9 added; an automatic category added tag 4 since: 9 goes, 4 stays.
    expect(undoList([1, 9, 4], [1], [1, 9])).toEqual({ verdict: "restore", list: [1, 4] });
    // Category 5 removed; still absent: it comes back.
    expect(undoList([2], [2, 5], [2])).toEqual({ verdict: "restore", list: [2, 5] });
    // Already as before.
    expect(undoList([1], [1], [1, 9])).toMatchObject({ verdict: "already" });
    // 9 added and 5 removed; 5 was put back by hand since: changed, left alone.
    expect(undoList([1, 9, 5], [1, 5], [1, 9])).toMatchObject({ verdict: "changed" });
  });
});

describe("the log", () => {
  const at = (iso: string) => new Date(iso);
  const op = (over: Partial<OperationFacts> & Pick<OperationFacts, "kind">): OperationFacts => ({
    status: "done",
    changed: 3,
    input: { kind: "hide", target: { kind: "ids", ids: [1] } },
    createdAt: at("2026-10-10T10:00:00Z"),
    finishedAt: at("2026-10-10T10:01:00Z"),
    undoneAt: null,
    termKey: null,
    ...over,
  });
  const sale = (endsOn: string | null, over: Partial<OperationFacts> = {}) =>
    op({
      kind: "sale",
      input: { kind: "sale", target: { kind: "ids", ids: [1] }, percent: 20, rounding: "charm", endsOn },
      ...over,
    });

  it("finds a term's standing hide: not undone, and done, under way, or part-way", () => {
    expect(standingHide([op({ kind: "hide", undoneAt: at("2026-10-11T00:00:00Z") })])).toBeNull();
    expect(standingHide([op({ kind: "hide", status: "failed", changed: 0 })])).toBeNull();
    const partial = op({ kind: "hide", status: "failed", changed: 2 });
    expect(standingHide([partial])).toBe(partial);
    const running = op({ kind: "hide", status: "running", changed: 0 });
    expect(standingHide([op({ kind: "sale" }), running])).toBe(running);
  });

  it("finds a term's sale: the newest that stands and has not ended, unless ended since", () => {
    const today = "2026-10-13";
    const open = sale(null);
    expect(standingSale([open], today)).toBe(open);
    expect(standingSale([sale("2026-10-12")], today)).toBeNull();
    expect(standingSale([sale("2026-10-13")], today)).not.toBeNull();
    // A newer sale replaces an older one; one undone gives the older back.
    const newer = sale("2026-10-20");
    expect(standingSale([newer, open], today)).toBe(newer);
    expect(standingSale([sale(null, { undoneAt: at("2026-10-12T00:00:00Z") }), open], today)).toBe(open);
    // "Togli il saldo" on the whole term ends it.
    expect(standingSale([op({ kind: "unsale" }), open], today)).toBeNull();
    expect(standingSale([op({ kind: "unsale", undoneAt: at("2026-10-12T00:00:00Z") }), open], today)).toBe(open);
    // The sale a newer one replaced is said too (undoing the newer brings it back) — not past a sale's end.
    expect(standingSales([newer, open], today)).toEqual([newer, open]);
    expect(standingSales([newer, op({ kind: "unsale" }), open], today)).toEqual([newer]);
    expect(standingSales([open], today)).toEqual([open]);
  });

  it("keeps a whole term's actions in the log while they stand", () => {
    expect(keptForTerm(op({ kind: "hide", termKey: "brand:7" }))).toBe(true);
    expect(keptForTerm(sale(null, { termKey: "category:3" }))).toBe(true);
    expect(keptForTerm(op({ kind: "unsale", termKey: "category:3" }))).toBe(true);
    expect(keptForTerm(op({ kind: "hide", termKey: "brand:7", undoneAt: at("2026-10-12T00:00:00Z") }))).toBe(false);
    expect(keptForTerm(op({ kind: "hide", termKey: "brand:7", status: "failed", changed: 0 }))).toBe(false);
    expect(keptForTerm(op({ kind: "tag" }))).toBe(false);
  });

  it("offers undo for 7 days — a whole term's hide for as long as it stands", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    expect(undoable(op({ kind: "tag" }), now, 7)).toBe(true);
    expect(undoable(op({ kind: "tag", finishedAt: at("2026-10-01T00:00:00Z") }), now, 7)).toBe(false);
    expect(undoable(op({ kind: "hide", termKey: "brand:7", finishedAt: at("2026-09-01T00:00:00Z") }), now, 7)).toBe(true);
    expect(undoable(op({ kind: "tag", status: "running" }), now, 7)).toBe(false);
    expect(undoable(op({ kind: "tag", status: "failed", changed: 0 }), now, 7)).toBe(false);
    expect(undoable(op({ kind: "tag", status: "failed", changed: 4 }), now, 7)).toBe(true);
    expect(undoable(op({ kind: "tag", undoneAt: at("2026-10-12T00:00:00Z") }), now, 7)).toBe(false);
  });

  it("knows the shop's day", () => {
    expect(dayIn("Europe/Rome", at("2026-10-13T22:30:00Z"))).toBe("2026-10-14");
    expect(dayIn("Europe/Rome", at("2026-10-13T21:30:00Z"))).toBe("2026-10-13");
  });
});

describe("labels", () => {
  const ids = { kind: "ids" as const, ids: [1] };
  const label = (input: OperationInput, names: Parameters<typeof labelParams>[1]) => labelText(labelParams(input, names));

  it("says what the action did, in the owner's words", () => {
    expect(
      label({ kind: "sale", target: ids, percent: 20, rounding: "charm", endsOn: null, termKey: "category:102" }, { count: 12, term: "Saldi outlet" }),
    ).toBe("Saldo −20% · Saldi outlet");
    expect(label({ kind: "sale", target: ids, percent: 30, rounding: "exact", endsOn: null }, { count: 5 })).toBe("Saldo −30% · 5 prodotti");
    expect(label({ kind: "hide", target: ids }, { count: 12 })).toBe("12 prodotti nascosti");
    expect(label({ kind: "hide", target: ids, termKey: "brand:7" }, { count: 1, term: "Nike" })).toBe("1 prodotto nascosto · Nike");
    expect(label({ kind: "tag", target: ids, tag: { name: "saldi" } }, { count: 8 })).toBe("Tag «saldi» a 8 prodotti");
    expect(label({ kind: "pin", target: ids, sectionKey: "category:x#0" }, { count: 3, section: "TENDENZA" })).toBe(
      "3 prodotti fissati in TENDENZA",
    );
    expect(label({ kind: "unsale", target: ids }, { count: 1 })).toBe("Saldo tolto · 1 prodotto");
    expect(label({ kind: "categorize", target: ids, categoryId: 3 }, { count: 2, category: "Saldi" })).toBe(
      "Categoria «Saldi» a 2 prodotti",
    );
  });

  it("keeps a label as data, so it reads in the owner's language when shown", () => {
    const params = labelParams(
      { kind: "sale", target: ids, percent: 20, rounding: "charm", endsOn: null, termKey: "category:102" },
      { count: 12, term: "Saldi outlet" },
    );
    expect(params).toEqual({ kind: "sale", count: 12, term: "Saldi outlet", percent: 20 });
    expect(labelText(params, words("en"))).toBe("Sale −20% · Saldi outlet");
    expect(labelText(labelParams({ kind: "hide", target: ids }, { count: 1 }), words("en"))).toBe("1 product hidden");
    expect(labelText(labelParams({ kind: "show", target: ids }, { count: 3 }))).toBe("3 prodotti di nuovo visibili");
  });
});

describe("preview warnings", () => {
  it("names the other terms the most products share", () => {
    const names = new Map([
      ["brand:1", "Nike"],
      ["category:2", "Novità"],
      ["category:3", "Saldi"],
      ["category:4", "Estate"],
    ]);
    const other = otherTerms(
      [
        { terms: ["brand:1", "category:2"] },
        { terms: ["brand:1", "category:3", "category:9"] },
        { terms: ["brand:1", "category:4", "category:2"] },
        { terms: ["category:9"] },
      ],
      names,
    );
    expect(other).toEqual({ count: 3, names: ["Nike", "Novità", "Estate"], total: 4 });
  });

  it("counts the homepage sections the products are in", () => {
    const presence = new Map([
      [1, [{ key: "a", title: "TENDENZA" }]],
      [2, [{ key: "a", title: "TENDENZA" }, { key: "b", title: "SALDI" }]],
    ]);
    expect(sectionCounts([1, 2, 3], presence)).toEqual(["TENDENZA (2)", "SALDI (1)"]);
  });
});
