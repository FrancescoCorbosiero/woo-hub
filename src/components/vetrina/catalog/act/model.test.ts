import { describe, expect, it } from "vitest";
import { getDictionary } from "@/i18n/dictionary";
import {
  addDays,
  refusedText,
  clearPicked,
  comingSunday,
  endChoiceFor,
  endsOnFor,
  fold,
  formatDay,
  isActive,
  isDay,
  isPicked,
  matches,
  NO_SELECTION,
  orderedIds,
  outcomeOf,
  pollDelay,
  queryTarget,
  readersOfTag,
  saleChange,
  sameName,
  selectAll,
  selectedCount,
  selectionTarget,
  startSelection,
  togglePicked,
  canLeaveOneOut,
  visibilityAction,
  weekdayOf,
  type PickedProduct,
} from "./model";

const p = (id: number, hidden = false): PickedProduct => ({ id, name: `Product ${id}`, hidden });

describe("selection", () => {
  it("starts with the long-pressed product, or none", () => {
    expect([...startSelection(p(4)).picked.keys()]).toEqual([4]);
    expect(startSelection().picked.size).toBe(0);
    expect(startSelection().active).toBe(true);
  });

  it("toggles products in and out, keeping the order picked", () => {
    let s = startSelection(p(3));
    s = togglePicked(s, p(1), []);
    s = togglePicked(s, p(2), []);
    s = togglePicked(s, p(3), []);
    expect([...s.picked.keys()]).toEqual([1, 2]);
    expect(isPicked(s, 1)).toBe(true);
    expect(isPicked(s, 3)).toBe(false);
  });

  it("leaves 'all' for the rows on screen less the one tapped", () => {
    const s = togglePicked(selectAll(), p(2), [p(1), p(2), p(3)]);
    expect(s.all).toBe(false);
    expect([...s.picked.keys()]).toEqual([1, 3]);
    expect(togglePicked(selectAll(), p(2), [p(1), p(2), p(3)], 3).all).toBe(false);
  });

  it("keeps 'all' while not every match is on screen: one tap must not drop the rest", () => {
    const all = selectAll();
    expect(canLeaveOneOut(all, 50, 500)).toBe(false);
    expect(togglePicked(all, p(2), [p(1), p(2), p(3)], 500)).toBe(all);
    expect(canLeaveOneOut(all, 500, 500)).toBe(true);
    expect(canLeaveOneOut(startSelection(p(1)), 1, 500)).toBe(true);
  });

  it("counts the query's total under 'all', the picks otherwise", () => {
    expect(selectedCount(selectAll(), 120)).toBe(120);
    expect(selectedCount(startSelection(p(1)), 120)).toBe(1);
    expect(selectedCount(NO_SELECTION, 120)).toBe(0);
    expect(isPicked(selectAll(), 99)).toBe(true);
    expect(isPicked(NO_SELECTION, 1)).toBe(false);
  });

  it("clears without leaving selection", () => {
    expect(clearPicked()).toEqual({ active: true, all: false, picked: new Map() });
  });
});

describe("targets", () => {
  it("drops the page from a query", () => {
    expect(queryTarget({ taxonomy: "brand", termId: 7, q: "dunk", sort: "name", offset: 40, limit: 40 })).toEqual({
      kind: "query",
      query: { taxonomy: "brand", termId: 7, q: "dunk", sort: "name" },
    });
  });

  it("orders hand-picked ids as on screen, the rest after in the order picked", () => {
    expect(orderedIds([9, 3, 1, 7], [1, 2, 3, 4])).toEqual([1, 3, 9, 7]);
    expect(orderedIds([], [1, 2])).toEqual([]);
  });

  it("is the query under 'all', the ids otherwise, nothing when none is chosen", () => {
    const query = { view: "soldout" as const, sort: "shop" as const, offset: 0 };
    expect(selectionTarget(selectAll(), query, [])).toEqual({ kind: "query", query: { view: "soldout", sort: "shop" } });
    let s = startSelection(p(3));
    s = togglePicked(s, p(1), []);
    expect(selectionTarget(s, query, [1, 2, 3])).toEqual({ kind: "ids", ids: [1, 3] });
    expect(selectionTarget(clearPicked(), query, [1])).toBeNull();
    expect(selectionTarget(NO_SELECTION, query, [1])).toBeNull();
  });

  it("offers Mostra only when everything chosen is hidden", () => {
    expect(visibilityAction(startSelection(p(1, true)), {})).toBe("show");
    expect(visibilityAction(togglePicked(startSelection(p(1, true)), p(2), []), {})).toBe("hide");
    expect(visibilityAction(clearPicked(), {})).toBe("hide");
    expect(visibilityAction(selectAll(), { visibility: "hidden" })).toBe("show");
    expect(visibilityAction(selectAll(), { view: "hidden" })).toBe("show");
    expect(visibilityAction(selectAll(), { view: "soldout" })).toBe("hide");
  });
});

describe("a sale's last day", () => {
  it("adds days across months and clock changes", () => {
    expect(addDays("2026-10-24", 7)).toBe("2026-10-31");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
  });

  it("finds the coming Sunday, today when it is one", () => {
    expect(weekdayOf("2026-10-13")).toBe(2);
    expect(comingSunday("2026-10-13")).toBe("2026-10-18");
    expect(comingSunday("2026-10-18")).toBe("2026-10-18");
    expect(comingSunday("2026-10-17")).toBe("2026-10-18");
  });

  it("turns a choice into a day", () => {
    const today = "2026-10-13";
    expect(endsOnFor("none", today, "2026-11-01")).toBeNull();
    expect(endsOnFor("sunday", today, null)).toBe("2026-10-18");
    expect(endsOnFor("week", today, null)).toBe("2026-10-20");
    expect(endsOnFor("pick", today, "2026-11-01")).toBe("2026-11-01");
    expect(endsOnFor("pick", today, today)).toBe(today);
    expect(endsOnFor("pick", today, "2026-10-12")).toBeNull();
    expect(endsOnFor("pick", today, "")).toBeNull();
    expect(endsOnFor("pick", today, null)).toBeNull();
  });

  it("reads a running sale's last day back as the chip that gives it, else as the day picked", () => {
    const today = "2026-10-13";
    expect(endChoiceFor("2026-10-18", today)).toEqual({ choice: "sunday", picked: "" });
    expect(endChoiceFor("2026-10-20", today)).toEqual({ choice: "week", picked: "" });
    expect(endChoiceFor("2026-10-19", today)).toEqual({ choice: "pick", picked: "2026-10-19" });
    expect(endChoiceFor(today, today)).toEqual({ choice: "pick", picked: today });
    expect(endChoiceFor(null, today)).toEqual({ choice: "none", picked: "" });
    // A day gone by: the change starts with none.
    expect(endChoiceFor("2026-10-12", today)).toEqual({ choice: "none", picked: "" });
    // On a Sunday, "Domenica" is today and "7 giorni" the next one.
    expect(endChoiceFor("2026-10-18", "2026-10-18")).toEqual({ choice: "sunday", picked: "" });
    expect(endChoiceFor("2026-10-25", "2026-10-18")).toEqual({ choice: "week", picked: "" });
  });

  it("checks days for real", () => {
    expect(isDay("2026-02-28")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-2-3")).toBe(false);
  });

  it("names the day", () => {
    expect(formatDay("2026-10-18", "it")).toBe("domenica 18 ottobre");
    expect(formatDay("2026-10-18", "en")).toBe("Sunday 18 October");
  });
});

describe("following an action", () => {
  it("is going while running or undoing", () => {
    expect(isActive({ status: "running" })).toBe(true);
    expect(isActive({ status: "undoing" })).toBe(true);
    expect(isActive({ status: "done" })).toBe(false);
  });

  it("says how it ended", () => {
    expect(outcomeOf("running", { status: "running" })).toBeNull();
    expect(outcomeOf("running", { status: "done" })).toBe("done");
    expect(outcomeOf("running", { status: "failed" })).toBe("failed");
    expect(outcomeOf("undoing", { status: "undone" })).toBe("undone");
    // A failed undo puts the action back where it was.
    expect(outcomeOf("undoing", { status: "done" })).toBe("undoFailed");
    expect(outcomeOf("undoing", { status: "failed" })).toBe("undoFailed");
    expect(outcomeOf("undoing", { status: "undoing" })).toBeNull();
  });

  it("asks quickly at first, then less often, and backs off on failures", () => {
    expect(pollDelay(0, 0)).toBe(800);
    expect(pollDelay(10, 0)).toBe(1_500);
    expect(pollDelay(60, 0)).toBe(3_000);
    expect(pollDelay(0, 1)).toBe(2_000);
    expect(pollDelay(0, 3)).toBe(8_000);
    expect(pollDelay(0, 9)).toBe(10_000);
  });
});

describe("searching a sheet's list", () => {
  it("ignores case, accents and extra spaces", () => {
    expect(fold("  Più   Venduti ")).toBe("piu venduti");
    expect(matches("Saldi › Nike Dunk", "nike  saldi")).toBe(true);
    expect(matches("Saldi › Nike", "adidas")).toBe(false);
    expect(matches("anything", "  ")).toBe(true);
  });

  it("finds the item with the same name", () => {
    const tags = [
      { id: 1, name: "saldi" },
      { id: 2, name: "Novità" },
    ];
    expect(sameName(tags, " Saldi ")?.id).toBe(1);
    expect(sameName(tags, "novita")?.id).toBe(2);
    expect(sameName(tags, "sald")).toBeUndefined();
    expect(sameName(tags, "")).toBeUndefined();
  });

  it("names the automatic categories reading a tag, paused ones aside", () => {
    const rule = (conditions: { field: string; op: string; value: string }[], enabled = true) => ({ enabled, conditions });
    const categories = [
      { name: "Saldi", automatic: rule([{ field: "tag", op: "is", value: "5" }]) },
      {
        name: "Outlet",
        automatic: rule([
          { field: "brand", op: "is", value: "5" },
          { field: "tag", op: "isNot", value: "5" },
        ]),
      },
      { name: "Nike", automatic: rule([{ field: "brand", op: "is", value: "5" }]) },
      { name: "In pausa", automatic: rule([{ field: "tag", op: "is", value: "5" }], false) },
      { name: "Manuale", automatic: null },
    ];
    expect(readersOfTag(categories, 5)).toEqual(["Saldi", "Outlet"]);
    expect(readersOfTag(categories, 6)).toEqual([]);
  });
});

describe("refusedText", () => {
  const it_ = getDictionary("it").vetrinaCatalog.act.toast;
  it("counts sizes for a margin, products for every other action", () => {
    const words = { products: it_.refused, sizes: it_.refusedSizes };
    expect(refusedText("margin", 8, words)).toBe("8 taglie rifiutate dal negozio.");
    expect(refusedText("margin", 1, words)).toBe("1 taglia rifiutata dal negozio.");
    expect(refusedText("sale", 3, words)).toBe("3 prodotti rifiutati dal negozio.");
  });
});

describe("Cambia lo sconto", () => {
  const running = { percent: 20, rounding: "charm" as const, endsOn: "2026-10-31" };

  it("names a change of the last day alone: put, moved or taken away", () => {
    expect(saleChange(running, { ...running, endsOn: "2026-11-15" })).toBe("endMoved");
    expect(saleChange(running, { ...running, endsOn: null })).toBe("endRemoved");
    expect(saleChange({ ...running, endsOn: null }, running)).toBe("endAdded");
  });

  it("is a new discount when the percent or the rounding moves too, and nothing outside a running sale", () => {
    expect(saleChange(running, { ...running, percent: 30, endsOn: "2026-11-15" })).toBe("discount");
    expect(saleChange(running, { ...running, rounding: "exact", endsOn: null })).toBe("discount");
    expect(saleChange(running, running)).toBe("discount");
    expect(saleChange(null, running)).toBeNull();
  });

  it("has the button's words in both languages", () => {
    for (const locale of ["it", "en"] as const) {
      const words = getDictionary(locale).vetrinaCatalog.act.sale.endChange;
      for (const change of ["endAdded", "endMoved", "endRemoved"] as const) expect(words[change]).toBeTruthy();
    }
    expect(getDictionary("it").vetrinaCatalog.act.sale.endChange.endMoved).toBe("Sposta la fine del saldo");
  });
});
