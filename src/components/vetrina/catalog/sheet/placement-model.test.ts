import { describe, expect, it } from "vitest";
import type { OperationView } from "@/lib/vetrina/catalog-ops";
import {
  cardShows,
  isWorking,
  pendingFrom,
  removingFrom,
  saleAfter,
  shopState,
  visibilitySwitch,
  type PendingAction,
  type ShopWords,
} from "./placement-model";

const words: ShopWords = {
  shown: {
    visible: "Visibile",
    catalog: "Solo nelle categorie",
    search: "Solo nella ricerca",
    hidden: "Nascosto",
    unpublished: "Visibile appena pubblicato",
  },
  stock: { instock: "disponibile", outofstock: "esaurito", onbackorder: "su ordinazione" },
};

const pending = (kind: PendingAction["kind"], extra: Partial<PendingAction> = {}): PendingAction => ({
  id: `${kind}-${extra.categoryId ?? 0}`,
  kind,
  categoryId: null,
  settled: false,
  ...extra,
});

describe("shopState", () => {
  it("says a sold-out visible product plainly", () => {
    expect(shopState(words, { status: "publish", visibility: "visible", stockStatus: "outofstock" })).toEqual({
      shown: "Visibile",
      stock: "esaurito",
      soldOut: true,
      hidden: false,
    });
  });

  it("names a partial visibility and a hidden one", () => {
    expect(shopState(words, { status: "publish", visibility: "catalog", stockStatus: "instock" }).shown).toBe("Solo nelle categorie");
    expect(shopState(words, { status: "publish", visibility: "search" }).shown).toBe("Solo nella ricerca");
    const hidden = shopState(words, { status: "publish", visibility: "hidden", stockStatus: "instock" });
    expect(hidden).toMatchObject({ shown: "Nascosto", stock: "disponibile", hidden: true });
  });

  it("says an unpublished product shows once published, unless hidden", () => {
    expect(shopState(words, { status: "draft", visibility: "visible" }).shown).toBe("Visibile appena pubblicato");
    expect(shopState(words, { status: "draft", visibility: "hidden" }).shown).toBe("Nascosto");
  });

  it("leaves an unknown stock unsaid", () => {
    expect(shopState(words, { status: "publish", visibility: "", stockStatus: "" })).toMatchObject({
      shown: "Visibile",
      stock: null,
      soldOut: false,
    });
    expect(shopState(words, { status: "publish", visibility: "visible", stockStatus: "weird" }).stock).toBeNull();
  });
});

describe("visibilitySwitch", () => {
  it("follows the shop when nothing runs", () => {
    expect(visibilitySwitch(true, [], null)).toEqual({ on: true, busy: false, going: null });
    expect(visibilitySwitch(false, [pending("sale")], null)).toEqual({ on: false, busy: false, going: null });
  });

  it("shows the owner's flip at once, before the server answers", () => {
    expect(visibilitySwitch(true, [], false)).toEqual({ on: false, busy: true, going: "hide" });
  });

  it("holds the way an action is turning it until the product is read again", () => {
    expect(visibilitySwitch(true, [pending("hide")], null)).toEqual({ on: false, busy: true, going: "hide" });
    expect(visibilitySwitch(true, [pending("hide", { settled: true })], null)).toMatchObject({ on: false });
    // The latest one wins.
    expect(visibilitySwitch(false, [pending("hide"), pending("show")], null)).toMatchObject({ on: true, going: "show" });
  });
});

describe("pending actions", () => {
  it("keeps the category an action adds or removes", () => {
    const remove = pendingFrom(
      { id: "a", kind: "uncategorize" },
      { kind: "uncategorize", target: { kind: "ids", ids: [1] }, categoryId: 7 },
      false,
    );
    expect(remove).toEqual({ id: "a", kind: "uncategorize", categoryId: 7, settled: false });
    expect(pendingFrom({ id: "b", kind: "pin" }, null, true)).toEqual({ id: "b", kind: "pin", categoryId: null, settled: true });
  });

  it("knows which categories are on their way out", () => {
    const list = [pending("uncategorize", { categoryId: 7 }), pending("categorize", { categoryId: 9 }), pending("hide")];
    expect([...removingFrom(list)]).toEqual([7]);
    expect(isWorking(list, "categorize")).toBe(true);
    expect(isWorking(list, "sale", "unsale")).toBe(false);
  });
});

describe("cardShows", () => {
  it("re-reads the card when the card shows what changed", () => {
    expect(cardShows("sale")).toBe(true);
    expect(cardShows("unsale")).toBe(true);
    expect(cardShows("hide")).toBe(true);
    expect(cardShows("margin")).toBe(true);
    expect(cardShows("pin")).toBe(false);
    expect(cardShows("uncategorize")).toBe(false);
  });
});

describe("saleAfter", () => {
  const view = (kind: PendingAction["kind"], status: OperationView["status"], changed = 1) => ({ kind, status, changed });

  it("knows the product's sale once a sale or its end changed it", () => {
    expect(saleAfter(view("sale", "done"))).toBe(true);
    expect(saleAfter(view("unsale", "done"))).toBe(false);
    // Stopped part-way, it still changed this one product.
    expect(saleAfter(view("sale", "failed"))).toBe(true);
  });

  it("leaves it to the store's card otherwise", () => {
    expect(saleAfter(view("sale", "done", 0))).toBeNull();
    // An undo may put back an older sale: only the card knows.
    expect(saleAfter(view("sale", "undone"))).toBeNull();
    expect(saleAfter(view("unsale", "running"))).toBeNull();
    expect(saleAfter(view("hide", "done"))).toBeNull();
  });
});
