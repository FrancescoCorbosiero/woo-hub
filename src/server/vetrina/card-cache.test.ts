import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductCard } from "@/lib/vetrina/types";
import { CARD_TTL_MS, cachedCards, forgetCards } from "./card-cache";

const card = (id: number, price = 100) => ({ id, sku: `SKU-${id}`, name: `P${id}`, price }) as unknown as ProductCard;

let clock = 1_000_000;
const now = () => clock;
/** A stand-in site: every id it is asked for, at the price it holds now. */
const prices = new Map<number, number>();
const fetch = vi.fn(async (ids: number[]) => ids.filter((id) => prices.has(id)).map((id) => card(id, prices.get(id))));

beforeEach(() => {
  // The cards live for the whole process: each test starts from none.
  delete (globalThis as { __vetrinaCards?: unknown }).__vetrinaCards;
  fetch.mockClear();
  prices.clear();
  for (const id of [1, 2, 3]) prices.set(id, 100);
  clock += 10 * CARD_TTL_MS;
});

describe("product cards, remembered", () => {
  it("asks the site only for the cards it has not seen lately, in the order asked", async () => {
    expect((await cachedCards([2, 1], fetch, now)).map((c) => c.id)).toEqual([2, 1]);
    expect(fetch).toHaveBeenLastCalledWith([2, 1]);
    expect((await cachedCards([3, 1, 2, 3], fetch, now)).map((c) => c.id)).toEqual([3, 1, 2]);
    expect(fetch).toHaveBeenLastCalledWith([3]);
    await cachedCards([1, 2, 3], fetch, now);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reads a card again after ten minutes", async () => {
    await cachedCards([1], fetch, now);
    prices.set(1, 90);
    clock += CARD_TTL_MS - 1;
    expect((await cachedCards([1], fetch, now))[0].price).toBe(100);
    clock += 1;
    expect((await cachedCards([1], fetch, now))[0].price).toBe(90);
  });

  it("forgets the products the Hub changed, and only those", async () => {
    await cachedCards([1, 2], fetch, now);
    prices.set(1, 80);
    prices.set(2, 80);
    forgetCards([1], now);
    clock += 1;
    const cards = await cachedCards([1, 2], fetch, now);
    expect(fetch).toHaveBeenLastCalledWith([1]);
    expect(cards.map((c) => c.price)).toEqual([80, 100]);
    forgetCards(undefined, now);
    clock += 1;
    expect((await cachedCards([1, 2], fetch, now)).map((c) => c.price)).toEqual([80, 80]);
  });

  it("answers a read that was on its way when the product changed, but does not keep it", async () => {
    let release!: () => void;
    const slow = vi.fn(async (ids: number[]) => {
      await new Promise<void>((r) => (release = r));
      return ids.map((id) => card(id, 100));
    });
    const reading = cachedCards([1], slow, now);
    await Promise.resolve();
    forgetCards([1], now); // an action changed product 1 while its old card was on its way
    release();
    expect((await reading).map((c) => c.id)).toEqual([1]);
    prices.set(1, 70);
    clock += 1;
    expect((await cachedCards([1], fetch, now))[0].price).toBe(70);
  });

  it("does not remember a product the site no longer has", async () => {
    prices.delete(3);
    expect(await cachedCards([3], fetch, now)).toEqual([]);
    expect(await cachedCards([3], fetch, now)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
