import { beforeEach, describe, expect, it } from "vitest";

/**
 * Real-SQL test of the overrides blob's writes: every lock, pin and sale rule
 * lives in one row, and its writers run at once (the owner's sheet, the
 * operator's drawer, "Mantieni" on the list). Opt-in, like the other DB
 * suites; it empties store_overrides.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

const load = async () => ({
  ...(await import("@/server/db/client")),
  ...(await import("@/server/db/schema")),
  ...(await import("./repo")),
  ...(await import("./model")),
});

describe.skipIf(!enabled)("the overrides blob (real SQL)", () => {
  beforeEach(async () => {
    const { db, storeOverrides } = await load();
    await db.delete(storeOverrides);
  });

  it("keeps every writer's change when they land at once: none saves over another's", async () => {
    const { updateOverrides, getOverrides, withVariationPrice, manualPriceFor } = await load();
    const sizes = ["40", "41", "42", "43", "44", "45", "46", "47"];
    await Promise.all(sizes.map((eu, i) => updateOverrides((current) => withVariationPrice(current, "LOCK-1", eu, 100 + i))));
    const saved = await getOverrides();
    expect(sizes.map((eu) => manualPriceFor(saved, "LOCK-1", eu))).toEqual(sizes.map((_, i) => 100 + i));
  });
});
