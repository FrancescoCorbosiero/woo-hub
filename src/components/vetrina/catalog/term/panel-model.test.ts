import { describe, expect, it } from "vitest";
import type { OperationStatus, OperationView, TermActionsState } from "@/lib/vetrina/catalog-ops";
import { hasActions, saleState, saleUndoBack, toggleOn, visibilityState } from "./panel-model";

function op(kind: OperationView["kind"], status: OperationStatus): OperationView {
  return {
    id: `${kind}-${status}`,
    kind,
    label: "",
    status,
    via: "app",
    progress: { done: 0, total: 10 },
    changed: status === "running" ? 0 : 10,
    failed: 0,
    error: null,
    termKey: "brand:7",
    createdAt: "2026-10-13T10:00:00.000Z",
    finishedAt: status === "running" ? null : "2026-10-13T10:01:00.000Z",
    undoable: status === "done",
    undoneAt: null,
  };
}

const none: TermActionsState = { hiddenBy: null, sale: null };
const NO_HELD = { count: 0, terms: [] };

describe("visibilityState", () => {
  it("guesses from the counts while the term's actions are read", () => {
    expect(visibilityState({ count: 10, hidden: 2 }, undefined)).toEqual({ kind: "loading", on: true });
    expect(visibilityState({ count: 10, hidden: 10 }, undefined)).toEqual({ kind: "loading", on: false });
  });

  it("is visible with no hide standing, counting those hidden one by one", () => {
    const state = visibilityState({ count: 10, hidden: 3 }, none);
    expect(state).toEqual({ kind: "visible", hiddenHere: 3, held: NO_HELD });
    expect(toggleOn(state)).toBe(true);
  });

  it("is off when every product is hidden one by one, with no hide of the term", () => {
    const state = visibilityState({ count: 4, hidden: 4 }, none);
    expect(state).toEqual({ kind: "allHidden", hidden: 4, held: NO_HELD });
    expect(toggleOn(state)).toBe(false);
  });

  it("decides from the counts read with the actions, not the screen's older ones", () => {
    // "Mostra" just ended: the screen still counts all 10 hidden, the actions' read knows 1 is.
    const state = visibilityState({ count: 10, hidden: 10 }, { ...none, counts: { count: 10, hidden: 1 } });
    expect(state).toEqual({ kind: "visible", hiddenHere: 1, held: NO_HELD });
    expect(toggleOn(state)).toBe(true);
  });

  it("counts as hidden one by one only what no other term's hide holds", () => {
    // "Mostra" on the category: 7 still hidden, 6 of them held by the Adidas hide.
    const held = { count: 10, hidden: 7, held: [{ term: "Adidas", count: 6 }] };
    const state = visibilityState({ count: 10, hidden: 7 }, { ...none, counts: held });
    expect(state).toEqual({ kind: "visible", hiddenHere: 1, held: { count: 6, terms: ["Adidas"] } });
    expect(toggleOn(state)).toBe(true);
    // Two terms hold them: both named, the count is theirs together.
    const two = { count: 10, hidden: 5, held: [{ term: "Adidas", count: 3 }, { term: "Nike", count: 2 }] };
    expect(visibilityState({ count: 10, hidden: 5 }, { ...none, counts: two })).toMatchObject({
      kind: "visible",
      hiddenHere: 0,
      held: { count: 5, terms: ["Adidas", "Nike"] },
    });
  });

  it("all hidden: shows only those hidden one by one, and has nothing to show when other hides hold them all", () => {
    const some = visibilityState({ count: 4, hidden: 4 }, { ...none, counts: { count: 4, hidden: 4, held: [{ term: "Nike", count: 3 }] } });
    expect(some).toEqual({ kind: "allHidden", hidden: 1, held: { count: 3, terms: ["Nike"] } });
    expect(toggleOn(some)).toBe(false);
    // A sub-brand while its brand is hidden: every product is the brand's to show.
    const all = visibilityState({ count: 4, hidden: 4 }, { ...none, counts: { count: 4, hidden: 4, held: [{ term: "Nike", count: 4 }] } });
    expect(all).toEqual({ kind: "held", held: { count: 4, terms: ["Nike"] } });
    expect(toggleOn(all)).toBe(false);
  });

  it("an empty term is not 'all hidden'", () => {
    expect(visibilityState({ count: 0, hidden: 0 }, none).kind).toBe("visible");
  });

  it("follows the term's hide: running, standing, being undone", () => {
    const counts = { count: 10, hidden: 10 };
    expect(visibilityState(counts, { ...none, hiddenBy: op("hide", "running") }).kind).toBe("hiding");
    expect(visibilityState(counts, { ...none, hiddenBy: op("hide", "done") }).kind).toBe("hidden");
    expect(visibilityState(counts, { ...none, hiddenBy: op("hide", "failed") }).kind).toBe("hidden");
    const showing = visibilityState(counts, { ...none, hiddenBy: op("hide", "undoing") });
    expect(showing.kind).toBe("showing");
    expect(toggleOn(showing)).toBe(true);
    expect(toggleOn(visibilityState(counts, { ...none, hiddenBy: op("hide", "running") }))).toBe(false);
  });
});

describe("saleState", () => {
  it("is none without a term-wide sale, counting those on sale on their own", () => {
    expect(saleState({ onSale: 2 }, none)).toEqual({ kind: "none", onSale: 2 });
    expect(saleState({ onSale: 2 }, undefined)).toEqual({ kind: "loading", onSale: 2 });
    // The server's count, read with the actions, leaves out the term's own sale.
    expect(saleState({ onSale: 5 }, { ...none, counts: { count: 5, hidden: 0, ownSale: 1 } })).toEqual({ kind: "none", onSale: 1 });
  });

  it("stands with its percent and last day, and is busy while it runs or is undone", () => {
    const done = op("sale", "done");
    expect(saleState({ onSale: 0 }, { ...none, sale: { percent: 20, endsOn: "2026-10-18", operation: done } })).toEqual({
      kind: "on",
      percent: 20,
      endsOn: "2026-10-18",
      view: done,
    });
    const changed = { percent: 30, endsOn: null, operation: done, rounding: "exact" as const, replaces: 20 };
    expect(saleState({ onSale: 0 }, { ...none, sale: changed })).toMatchObject({ kind: "on", rounding: "exact", replaces: 20 });
    for (const status of ["running", "undoing"] as const) {
      const sale = { percent: 30, endsOn: null, operation: op("sale", status) };
      expect(saleState({ onSale: 0 }, { ...none, sale }).kind).toBe("busy");
    }
  });
});

describe("saleUndoBack", () => {
  it("says what «Annulla» brings back: the prices from before, the earlier discount, or the earlier end", () => {
    const done = op("sale", "done");
    const on = (sale: Record<string, unknown>) => {
      const state = saleState({ onSale: 0 }, { ...none, sale: { percent: 30, endsOn: "2026-10-31", operation: done, ...sale } });
      if (state.kind !== "on") throw new Error("not on sale");
      return saleUndoBack(state);
    };
    expect(on({})).toEqual({ kind: "plain" });
    expect(on({ replaces: 20, replacesEndsOn: null })).toEqual({ kind: "percent", percent: 20 });
    // The same −30%, only the end moved: its undo puts the earlier end back, not "−30%" again.
    expect(on({ replaces: 30, replacesEndsOn: "2026-10-15" })).toEqual({ kind: "end", endsOn: "2026-10-15" });
    expect(on({ replaces: 30, replacesEndsOn: null })).toEqual({ kind: "end", endsOn: null });
  });
});

describe("hasActions", () => {
  it("offers the actions on a term with products, or with an action standing on it", () => {
    expect(hasActions({ count: 3 }, undefined)).toBe(true);
    expect(hasActions({ count: 0 }, none)).toBe(false);
    expect(hasActions({ count: 0 }, { ...none, hiddenBy: op("hide", "done") })).toBe(true);
  });
});
