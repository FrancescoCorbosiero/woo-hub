import { beforeEach, describe, expect, it } from "vitest";

/**
 * Real-SQL tests of the snapshot's many-product patch: read, changed and
 * written back under one write lock. Opt-in: they need a THROWAWAY Postgres
 * with the migrations applied, and they replace the snapshot. Run with
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://…@localhost:…/… REDIS_URL=… npx vitest run --no-file-parallelism <this file>
 *
 * Imports are dynamic because the db client validates the environment on load.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

const load = async () => ({
  ...(await import("@/server/db/client")),
  ...(await import("@/server/db/schema")),
  ...(await import("./repo")),
});

const size = (id: number, sale = "") => ({ id, sku: `V-${id}`, regular_price: "100.00", sale_price: sale });

describe.skipIf(!enabled)("patching many products of the snapshot (real SQL)", () => {
  beforeEach(async () => {
    const { saveSnapshot } = await load();
    await saveSnapshot(
      {
        products: [
          { id: 1, sku: "SNAP-1", name: "One", variations: [size(11), size(12)] },
          // No SKU: the snapshot cannot be keyed by it, the patch finds it by id.
          { id: 2, sku: "", name: "Two", variations: [size(21)] },
          { id: 3, sku: "SNAP-3", name: "Three", variations: [size(31)] },
        ],
      } as never,
      "rest",
    );
  });

  const sales = async () => {
    const { getSnapshotProductsByIds } = await load();
    const products = await getSnapshotProductsByIds([1, 2, 3, 4]);
    return Object.fromEntries(products.map((p) => [p.id, p.variations.map((v) => v.sale_price ?? "")]));
  };

  it("changes the products asked for, those without a SKU included, and leaves the rest as they were", async () => {
    const { patchSnapshotProducts, getSnapshotInfo, getSnapshotProductsByIds, PATCHED_AT } = await load();
    const changed = await patchSnapshotProducts([1, 2, 2, 99], (product) => {
      for (const v of product.variations) v.sale_price = "80.00";
    });
    expect(changed).toBe(2);
    expect(await sales()).toEqual({ 1: ["80.00", "80.00"], 2: ["80.00"], 3: [""] });
    expect((await getSnapshotInfo())?.productCount).toBe(3);
    // Marked as the Hub's own write: a pull started before it keeps it.
    const [one, , three] = await getSnapshotProductsByIds([1, 2, 3]);
    expect(one[PATCHED_AT]).toBeTruthy();
    expect(three[PATCHED_AT]).toBeUndefined();
    expect(await patchSnapshotProducts([], () => undefined)).toBe(0);
  });

  it("loses nothing written meanwhile: another write waits for the lock and lands on top", async () => {
    const { patchSnapshotProducts, patchSnapshotProduct, upsertSnapshotProducts, getSnapshotProductsByIds } = await load();
    let meanwhile: Promise<unknown> | null = null;
    await patchSnapshotProducts([1, 2], (product) => {
      // Other writers start while the products are being changed: a product added, another patched —
      // and one of these very products, whose change must land on top of this one, not under it.
      meanwhile ??= Promise.all([
        upsertSnapshotProducts([{ id: 4, sku: "SNAP-4", name: "Four", variations: [size(41, "50.00")] }]),
        patchSnapshotProduct(3, (p) => {
          p.variations[0].sale_price = "70.00";
        }),
        patchSnapshotProduct(1, (p) => {
          p.variations[0].regular_price = "120.00";
        }),
      ]);
      for (const v of product.variations) v.sale_price = "80.00";
    });
    await meanwhile;
    expect(await sales()).toEqual({ 1: ["80.00", "80.00"], 2: ["80.00"], 3: ["70.00"], 4: ["50.00"] });
    const [one] = await getSnapshotProductsByIds([1]);
    expect(one.variations.map((v) => v.regular_price)).toEqual(["120.00", "100.00"]);
  });

  it("changes nothing without a snapshot", async () => {
    const { db, storeSnapshot, patchSnapshotProducts } = await load();
    await db.delete(storeSnapshot);
    expect(await patchSnapshotProducts([1], () => undefined)).toBe(0);
  });
});
