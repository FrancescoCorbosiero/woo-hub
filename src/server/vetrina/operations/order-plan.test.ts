import { describe, expect, it } from "vitest";
import { ORDER_STEP, planOrder, type OrderMember, type OrderPlan } from "./order-plan";

/** Products 1..n, in this order, with these numbers. */
const term = (values: number[]): OrderMember[] => values.map((menuOrder, i) => ({ id: i + 1, menuOrder }));

/**
 * The order the store would show after the plan: by number, then — for a
 * tie — by the name, which is the term's order before (members come sorted).
 */
function storeOrder(members: OrderMember[], plan: OrderPlan): number[] {
  const after = new Map(plan.writes.map((w) => [w.id, w.after]));
  return members
    .map((m, rank) => ({ id: m.id, rank, value: after.get(m.id) ?? m.menuOrder }))
    .sort((a, b) => a.value - b.value || a.rank - b.rank)
    .map((m) => m.id);
}

describe("planOrder", () => {
  it("puts a product first in a shop never ordered with one write", () => {
    const members = term([0, 0, 0, 0, 0]);
    const plan = planOrder(members, [4], 1);
    expect(plan.order).toEqual([4, 1, 2, 3, 5]);
    expect(plan.writes).toEqual([{ id: 4, before: 0, after: -ORDER_STEP }]);
    expect(storeOrder(members, plan)).toEqual(plan.order);
    expect(plan.position).toBe(1);
  });

  it("puts a product last with one write", () => {
    const members = term([0, 0, 0, 0]);
    const plan = planOrder(members, [1], null);
    expect(plan.order).toEqual([2, 3, 4, 1]);
    expect(plan.writes).toEqual([{ id: 1, before: 0, after: ORDER_STEP }]);
    expect(storeOrder(members, plan)).toEqual(plan.order);
  });

  it("places in the middle of a run of ties by renumbering the shorter side", () => {
    const members = term(new Array(20).fill(0));
    const plan = planOrder(members, [20], 3);
    expect(plan.order.slice(0, 4)).toEqual([1, 2, 20, 3]);
    // 1, 2 and the product moved go below the ties; 3…19 keep their 0.
    expect(plan.writes.map((w) => w.id)).toEqual([1, 2, 20]);
    expect(storeOrder(members, plan)).toEqual(plan.order);
  });

  it("writes only the product moved where the numbers leave room", () => {
    const members = term([10, 20, 30, 40, 50]);
    const plan = planOrder(members, [5], 2);
    expect(plan.order).toEqual([1, 5, 2, 3, 4]);
    expect(plan.writes).toEqual([{ id: 5, before: 50, after: 15 }]);
    expect(storeOrder(members, plan)).toEqual(plan.order);
  });

  it("places several in the order given", () => {
    const members = term([0, 0, 0, 0, 0, 0]);
    const plan = planOrder(members, [6, 2, 4], 1);
    expect(plan.order).toEqual([6, 2, 4, 1, 3, 5]);
    expect(storeOrder(members, plan)).toEqual(plan.order);
    expect(plan.writes).toHaveLength(3);
  });

  it("writes nothing when they are already there", () => {
    const members = term([0, 1, 2]);
    expect(planOrder(members, [1, 2], 1).writes).toEqual([]);
  });

  it("leaves out the products the term does not hold", () => {
    const plan = planOrder(term([0, 0]), [9, 2], 1);
    expect(plan.outside).toEqual([9]);
    expect(plan.order).toEqual([2, 1]);
    expect(planOrder(term([0]), [9], 1)).toMatchObject({ writes: [], position: null, outside: [9] });
  });

  it("clamps a position past the end", () => {
    expect(planOrder(term([0, 0, 0]), [1], 99).order).toEqual([2, 3, 1]);
  });

  it("a drag in the first rows writes the product dragged only", () => {
    const values = Array.from({ length: 200 }, (_, i) => i * ORDER_STEP);
    const members = term(values);
    // The editor sends its first 50 rows in their new order: the 40th dragged to 3rd.
    const window = members.slice(0, 50).map((m) => m.id);
    const dragged = window.splice(39, 1)[0];
    window.splice(2, 0, dragged);
    const plan = planOrder(members, window, 1);
    expect(plan.writes).toEqual([{ id: 40, before: 390, after: 15 }]);
    expect(storeOrder(members, plan)).toEqual(plan.order);
  });

  it("always reaches the order asked, whatever the numbers", () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 200; round++) {
      const n = 1 + rand(30);
      const values = Array.from({ length: n }, () => rand(5) - 2).sort((a, b) => a - b);
      const members = term(values);
      const targets = Array.from({ length: 1 + rand(4) }, () => 1 + rand(n));
      const position = rand(3) === 0 ? null : 1 + rand(n + 2);
      const plan = planOrder(members, targets, position);
      expect(storeOrder(members, plan)).toEqual(plan.order);
    }
  });
});
