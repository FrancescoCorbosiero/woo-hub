import { describe, expect, it, vi } from "vitest";
import type { Homepage } from "@/lib/vetrina/types";
import { HOME_FRESH_MS, HOME_RETRY_MS, HOME_STALE_MAX_MS, homepageCache } from "./home-cache";

vi.mock("./source", () => ({ getVetrinaSource: vi.fn() }));

const page = (modifiedGmt: string) => ({ pageId: 1, modifiedGmt, blocks: [] }) as unknown as Homepage;

/** A stand-in site whose answers are released by hand, and a clock moved by hand. */
function site() {
  let clock = 1_000_000;
  const pending: { resolve: (h: Homepage) => void; reject: (e: unknown) => void }[] = [];
  const load = vi.fn(() => new Promise<Homepage>((resolve, reject) => pending.push({ resolve, reject })));
  const cache = homepageCache(load, () => clock);
  const answer = async (h: Homepage) => {
    pending.shift()!.resolve(h);
    await Promise.resolve();
  };
  const fail = async (e: unknown) => {
    pending.shift()!.reject(e);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { cache, load, answer, fail, pending, wait: (ms: number) => (clock += ms) };
}

describe("the homepage the screens share", () => {
  it("is read from the site once, then answered as it is for a minute", async () => {
    const s = site();
    const first = s.cache.get();
    await s.answer(page("a"));
    expect(await first).toEqual(page("a"));
    s.wait(HOME_FRESH_MS - 1);
    expect(await s.cache.get()).toEqual(page("a"));
    expect(s.load).toHaveBeenCalledTimes(1);
  });

  it("past a minute, answers what it knows at once and reads the site behind it", async () => {
    const s = site();
    const first = s.cache.get();
    await s.answer(page("a"));
    await first;
    s.wait(HOME_FRESH_MS + 1);
    expect(await s.cache.get()).toEqual(page("a"));
    expect(s.load).toHaveBeenCalledTimes(2);
    // Asked again while that read is on its way: still at once, and no third read.
    expect(await s.cache.get()).toEqual(page("a"));
    expect(s.load).toHaveBeenCalledTimes(2);
    await s.answer(page("b"));
    expect(await s.cache.get()).toEqual(page("b"));
  });

  it("past ten minutes, waits for the site rather than show an old homepage", async () => {
    const s = site();
    const first = s.cache.get();
    await s.answer(page("a"));
    await first;
    s.wait(HOME_STALE_MAX_MS + 1);
    let answered: Homepage | null = null;
    const next = s.cache.get().then((h) => (answered = h));
    await Promise.resolve();
    expect(answered).toBeNull();
    await s.answer(page("b"));
    await next;
    expect(answered).toEqual(page("b"));
  });

  it("after a change of ours, waits for the site; a read started before the change does not count", async () => {
    const s = site();
    const first = s.cache.get();
    await s.answer(page("a"));
    await first;
    s.wait(HOME_FRESH_MS + 1);
    await s.cache.get(); // a read starts behind the answer…
    s.cache.forget(); // …then we publish a section
    const after = s.cache.get();
    expect(s.load).toHaveBeenCalledTimes(3);
    await s.answer(page("before the change"));
    await s.answer(page("after the change"));
    expect(await after).toEqual(page("after the change"));
    expect(await s.cache.get()).toEqual(page("after the change"));
    expect(s.cache.last()).toEqual(page("after the change"));
  });

  it("does not ask a site that just failed again for half a minute — unless asked for fresh", async () => {
    const s = site();
    const error = new Error("502 Bad Gateway");
    const first = expect(s.cache.get()).rejects.toBe(error);
    await s.fail(error);
    await first;
    await expect(s.cache.get()).rejects.toBe(error);
    expect(s.load).toHaveBeenCalledTimes(1);
    const fresh = expect(s.cache.get({ fresh: true })).rejects.toBe(error);
    expect(s.load).toHaveBeenCalledTimes(2);
    await s.fail(error);
    await fresh;
    s.wait(HOME_RETRY_MS + 1);
    const later = s.cache.get();
    expect(s.load).toHaveBeenCalledTimes(3);
    await s.answer(page("back"));
    expect(await later).toEqual(page("back"));
  });

  it("keeps what it knew when a read behind the answer fails", async () => {
    const s = site();
    const first = s.cache.get();
    await s.answer(page("a"));
    await first;
    s.wait(HOME_FRESH_MS + 1);
    expect(await s.cache.get()).toEqual(page("a"));
    await s.fail(new Error("timeout"));
    expect(await s.cache.get()).toEqual(page("a"));
    // The failure is not tried again at once: the known homepage, and no new read.
    expect(s.load).toHaveBeenCalledTimes(2);
  });
});
