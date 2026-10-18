import "server-only";

/**
 * "Ordina", decided: where products land in a category's or a brand's own
 * order, and the fewest `menu_order` values that put them there. Pure — no
 * store, no database — so every rule here is pinned down by order-plan.test.ts.
 *
 * The shop's order is WooCommerce's: `menu_order` ascending, then the name.
 * The storefront's category and brand pages follow it (its "Ordinamento
 * predefinito"), and so does the catalog's "Ordina: Negozio". It is ONE
 * number per product, shared by every category the product is in: a plan
 * changes only the products it must, and keeps every other product's number
 * — so the other categories keep their order, but for the products moved.
 */

/** A term's product, in the term's order now (menu_order, then name): its place is its index. */
export interface OrderMember {
  id: number;
  menuOrder: number;
}

export interface OrderWrite {
  id: number;
  before: number;
  after: number;
}

export interface OrderPlan {
  /** The term's products in their new order. */
  order: number[];
  /** The products whose number changes, and how: the targets, and the few around them that make room. */
  writes: OrderWrite[];
  /** Targets the term does not hold: left out. */
  outside: number[];
  /** Where the first target lands, 1-based; null when none of them is in the term. */
  position: number | null;
}

/** The room left between two numbers rewritten one after another: a later move between them writes one product, not a run. */
export const ORDER_STEP = 10;

/**
 * How far back a product kept as it is looks for the previous one kept: the
 * search is quadratic within it. A term past it still gets a valid order,
 * with possibly more writes than the fewest.
 */
const LOOK_BACK = 3000;

/**
 * Place `targets` (in the order given) at `position` (1-based, among the
 * term's other products; null = after all of them) in the term's order.
 *
 * The new order is fixed by the move; which numbers change is chosen: the
 * largest set of products that can keep their number (the others are
 * renumbered in between) — two kept neighbours already in that order (a
 * smaller number, or the same number and the name before), two kept with
 * products between them far enough apart to fit a whole number for each.
 */
export function planOrder(members: readonly OrderMember[], targets: readonly number[], position: number | null): OrderPlan {
  const inTerm = new Set(members.map((m) => m.id));
  const block = [...new Set(targets)].filter((id) => inTerm.has(id));
  const outside = [...new Set(targets)].filter((id) => !inTerm.has(id));
  if (block.length === 0) return { order: members.map((m) => m.id), writes: [], outside, position: null };

  const moving = new Set(block);
  const rest = members.filter((m) => !moving.has(m.id));
  const at = position == null ? rest.length : Math.min(Math.max(Math.floor(position) - 1, 0), rest.length);
  const byId = new Map(members.map((m, rank) => [m.id, { ...m, rank }]));
  const order = [...rest.slice(0, at).map((m) => m.id), ...block, ...rest.slice(at).map((m) => m.id)];
  const seq = order.map((id) => byId.get(id)!);

  const after = numbers(seq);
  const writes: OrderWrite[] = [];
  seq.forEach((m, i) => {
    if (after[i] !== m.menuOrder) writes.push({ id: m.id, before: m.menuOrder, after: after[i] });
  });
  return { order, writes, outside, position: at + 1 };
}

/** Whether `a` then `b`, both kept as they are with `between` products renumbered between them, still read in that order. */
function fits(a: { menuOrder: number; rank: number }, b: { menuOrder: number; rank: number }, between: number): boolean {
  if (between === 0) return a.menuOrder < b.menuOrder || (a.menuOrder === b.menuOrder && a.rank < b.rank);
  return b.menuOrder - a.menuOrder - 1 >= between;
}

/** The numbers of a sequence in its new order: the most kept as they are, the rest spread in the room between them. */
function numbers(seq: readonly { menuOrder: number; rank: number }[]): number[] {
  const n = seq.length;
  // kept[j]: the most products kept up to j, j itself kept; from[j]: the previous one kept (-1: none).
  const kept = new Array<number>(n).fill(1);
  const from = new Array<number>(n).fill(-1);
  for (let j = 0; j < n; j++) {
    for (let i = Math.max(0, j - LOOK_BACK); i < j; i++) {
      if (kept[i] + 1 > kept[j] && fits(seq[i], seq[j], j - i - 1)) {
        kept[j] = kept[i] + 1;
        from[j] = i;
      }
    }
  }
  let last = 0;
  for (let j = 1; j < n; j++) if (kept[j] > kept[last]) last = j;
  const keep: number[] = [];
  for (let j = last; j >= 0; j = from[j]) keep.unshift(j);

  const out = seq.map((m) => m.menuOrder);
  const first = keep[0];
  // Before the first kept: downwards from it, a step apart.
  for (let i = first - 1; i >= 0; i--) out[i] = out[i + 1] - ORDER_STEP;
  // Between two kept: spread evenly in the room between their numbers.
  for (let k = 0; k + 1 < keep.length; k++) {
    const a = keep[k];
    const b = keep[k + 1];
    const runs = b - a - 1;
    if (runs === 0) continue;
    const gap = out[b] - out[a];
    for (let t = 1; t <= runs; t++) out[a + t] = out[a] + Math.floor((t * gap) / (runs + 1));
  }
  // After the last kept: upwards from it.
  for (let i = keep[keep.length - 1] + 1; i < n; i++) out[i] = out[i - 1] + ORDER_STEP;
  return out;
}

/**
 * The targets an order moved, in words a person would use: those that left
 * their place among the others — not the ones only pushed along. Of all the
 * ways to read the new order as "these moved, the rest kept their order",
 * the one that keeps the most of the other products, then of the targets
 * (a heaviest increasing subsequence of the old places). From where to
 * where, 1-based, in their new order; one left at its old number is not
 * said to move.
 */
export function movedTargets(
  members: readonly OrderMember[],
  order: readonly number[],
  targets: readonly number[],
): { id: number; from: number; to: number }[] {
  const was = new Map(members.map((m, i) => [m.id, i]));
  const asked = new Set(targets);
  const n = order.length;
  // Fenwick tree over the old places: the heaviest chain ending below a place, and where it ends.
  const tree = new Array<number>(n + 1).fill(0);
  const treeAt = new Array<number>(n + 1).fill(-1);
  const best = new Array<number>(n).fill(0);
  const prev = new Array<number>(n).fill(-1);
  const query = (rank: number) => {
    let value = 0;
    let at = -1;
    for (let i = rank; i > 0; i -= i & -i) if (tree[i] > value) [value, at] = [tree[i], treeAt[i]];
    return { value, at };
  };
  const update = (rank: number, value: number, at: number) => {
    for (let i = rank; i <= n; i += i & -i) if (value > tree[i]) [tree[i], treeAt[i]] = [value, at];
  };
  let top = -1;
  order.forEach((id, i) => {
    const rank = was.get(id)!;
    // Another product kept counts more than a target: a target is what is said to move.
    const weight = asked.has(id) ? 1 : n + 1;
    const below = query(rank);
    best[i] = below.value + weight;
    prev[i] = below.at;
    update(rank + 1, best[i], i);
    if (top < 0 || best[i] > best[top]) top = i;
  });
  const kept = new Set<number>();
  for (let i = top; i >= 0; i = prev[i]) kept.add(order[i]);
  // One whose place is the same number as before (the others moved around it) reads as not moved.
  return order.flatMap((id, i) => (asked.has(id) && !kept.has(id) && was.get(id) !== i ? [{ id, from: was.get(id)! + 1, to: i + 1 }] : []));
}
