import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Real-SQL tests of the orders pull's writes. The pull runs every quarter of
 * an hour over the same recent orders, almost all of them as the last pull
 * left them: those must not be rewritten (a row Postgres rewrote has a new
 * xmin, whatever its values) — and "last pulled" must still say when the
 * last pull ran. Opt-in: they need a THROWAWAY Postgres with the migrations
 * applied, and they empty store_orders. Run with
 *
 *   DATABASE_URL=postgres://…@localhost:…/hub_test npm run test:db
 *
 * Imports are dynamic because the db client validates the environment on load.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

const load = async () => ({
  ...(await import("drizzle-orm")),
  ...(await import("@/server/db/client")),
  ...(await import("@/server/db/schema")),
  ...(await import("@/server/db/rows")),
  ...(await import("./model")),
  ...(await import("./repo")),
});

/** An order as the REST API sends it. */
const wooOrder = (id: number, status = "processing") => ({
  id,
  number: String(id),
  status,
  currency: "EUR",
  total: "189.90",
  date_created: "2026-11-01T10:00:00",
  date_modified: "2026-11-02T10:00:00",
  billing: { first_name: "Mario", last_name: "Rossi", email: "mario@example.com", phone: "+39 333 0000000", address_1: "Via Roma 1", city: "Piacenza", postcode: "29121", country: "IT" },
  shipping: { first_name: "Mario", last_name: "Rossi", address_1: "Via Roma 1", city: "Piacenza", postcode: "29121", country: "IT" },
  payment_method_title: "Carta di credito",
  line_items: [{ name: "Nike Dunk Low Panda - 42", sku: "DD1391-100-42", quantity: 1, total: "180.00", meta_data: [{ key: "pa_taglia", value: "42" }] }],
  meta_data: [{ id: 1, key: "_stripe_intent", value: "pi_123" }],
});

async function versions(): Promise<Map<number, string>> {
  const { db, sql, rowsOf } = await load();
  const res = await db.execute(sql`select id, xmin::text as v from store_orders`);
  return new Map(rowsOf<{ id: number; v: string }>(res).map((r) => [Number(r.id), r.v]));
}

describe.skipIf(!enabled)("the orders pull's writes (real SQL)", () => {
  async function empty() {
    const { db, storeOrders } = await load();
    await db.delete(storeOrders);
  }
  beforeEach(empty);
  // The suites share one database, file after file.
  afterAll(empty);

  it("writes only the orders that changed", async () => {
    const { upsertOrders, normalizeWooOrder } = await load();
    const pull = (orders: ReturnType<typeof wooOrder>[]) => upsertOrders(orders.map((o) => normalizeWooOrder(o)!));
    expect(await pull([wooOrder(1), wooOrder(2), wooOrder(3)])).toBe(3);
    const before = await versions();

    expect(await pull([wooOrder(1), wooOrder(2), wooOrder(3)])).toBe(0);
    expect(await versions()).toEqual(before);

    // Order 2 completed on the store, order 4 is new.
    expect(await pull([wooOrder(1), wooOrder(2, "completed"), wooOrder(3), wooOrder(4)])).toBe(2);
    const after = await versions();
    expect([...after].filter(([id, v]) => before.get(id) !== v).map(([id]) => id).sort()).toEqual([2, 4]);
  });

  it("says when the last pull ran, even one that wrote nothing", async () => {
    const { upsertOrders, normalizeWooOrder, notePulled, lastPulledAt } = await load();
    await upsertOrders([normalizeWooOrder(wooOrder(1))!]);
    const stored = Date.parse((await lastPulledAt())!);

    const later = new Date(stored + 15 * 60_000);
    expect(await upsertOrders([normalizeWooOrder(wooOrder(1))!])).toBe(0);
    notePulled(later);
    expect(await lastPulledAt()).toBe(later.toISOString());
  });
});
