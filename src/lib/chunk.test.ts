import { describe, expect, it } from "vitest";
import { withinBudget } from "./chunk";

describe("withinBudget — the whole-store sync's instalment", () => {
  const changes = new Map([
    ["A", 300],
    ["B", 150],
    ["C", 100],
    ["D", 20],
  ]);
  const cost = (sku: string) => changes.get(sku)!;

  it("takes whole products in order while they fit, and counts what waits", () => {
    expect(withinBudget(["A", "B", "C", "D"], cost, 500)).toEqual({ taken: ["A", "B"], deferred: 120 });
  });

  it("stops at the first that does not fit: the run's order is kept, not filled around", () => {
    // D (20) would still fit after A and B — it waits with C all the same.
    expect(withinBudget(["A", "B", "C", "D"], cost, 470).taken).toEqual(["A", "B"]);
  });

  it("everything fits: nothing waits", () => {
    expect(withinBudget(["A", "B", "C", "D"], cost, 570)).toEqual({ taken: ["A", "B", "C", "D"], deferred: 0 });
  });

  it("always takes the first, so a run moves even when one product is past the budget", () => {
    expect(withinBudget(["A", "B"], cost, 100)).toEqual({ taken: ["A"], deferred: 150 });
  });

  it("nothing to write: nothing taken, nothing waits", () => {
    expect(withinBudget([], cost, 500)).toEqual({ taken: [], deferred: 0 });
  });
});
