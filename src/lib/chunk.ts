/** Chunk an array into pieces of at most `size`. Client-safe (no server-only). */
export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The items that fit a budget of `max`, each costing `cost(item)`: whole items
 * in the order given, as long as they fit. The first always goes, so a run
 * moves even when one item alone is past the budget. From the first that does
 * not fit on, everything is left out, and `deferred` is what that costs — the
 * whole-store sync's instalment (see apply.ts): the next run plans the rest
 * again, and finds the products written here already done.
 */
export function withinBudget<T>(
  items: readonly T[],
  cost: (item: T) => number,
  max: number,
): { taken: T[]; deferred: number } {
  const taken: T[] = [];
  let spent = 0;
  let deferred = 0;
  let full = false;
  for (const item of items) {
    const c = cost(item);
    full ||= taken.length > 0 && spent + c > max;
    if (full) {
      deferred += c;
    } else {
      taken.push(item);
      spent += c;
    }
  }
  return { taken, deferred };
}
