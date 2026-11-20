import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The "Pagine" tab's save, on the demo pages (fixture-pages.ts, WordPress's
 * rules for a save): written only after a clean check, by a user who may,
 * over the very page that was opened — else nothing is sent.
 */
vi.mock("@/lib/env", () => ({ env: { VETRINA_SOURCE: "fixture" } }));
import { checkMarkup } from "@/lib/pages/check";
import { fixturePages, resetDemoPages } from "./fixture-pages";
import { checkPage, openPage, pagesOverview, savePage } from "./service";
import { markupDigest, type PageSource } from "./source";

/** The demo pages, with every write counted and any method replaceable. */
function source(over: Partial<PageSource> = {}) {
  const base = fixturePages();
  const save = vi.fn(base.save);
  return { ...base, save, ...over } as PageSource & { save: typeof save };
}

const NEW = `<!-- wp:golden-hive/about-hero {"title":"NUOVA STORIA"} /-->\n\n<!-- wp:golden-hive/store-visit /-->\n`;

beforeEach(() => resetDemoPages());

describe("the demo pages", () => {
  it("are valid pages, and the front page is the Vetrina's", async () => {
    const src = source();
    const { pages, vetrinaPageId } = await pagesOverview(src);
    expect(vetrinaPageId).toBe(1);
    const registry = await src.blockTypes("golden-hive");
    for (const p of pages) expect(checkMarkup((await src.read(p.id)).markup, { registry }), p.title).toEqual([]);
    expect((await openPage(src, 1)).vetrinaPage).toBe(true);
    expect((await openPage(src, 2)).vetrinaPage).toBe(false);
  });
});

describe("savePage", () => {
  it("saves a page unchanged since it was opened: a new version, one more revision", async () => {
    const src = source();
    const opened = await src.read(2);
    const out = await savePage(src, { id: 2, markup: NEW, expected: opened.version });
    if (out.outcome !== "saved") throw new Error(out.outcome);
    expect(out.saved.version.modifiedGmt > opened.version.modifiedGmt).toBe(true);
    expect(out.saved.revisions).toBe(4);
    expect(out.saved.altered).toBe(false);
    expect((await src.read(2)).markup).toBe(NEW);
    expect(src.save).toHaveBeenCalledTimes(1);
  });

  it("refuses a page modified since it was read, and writes nothing", async () => {
    const src = source();
    const opened = await src.read(2);
    // Someone else saves the page meanwhile (the Vetrina, WordPress, another tab).
    await src.save(2, `<!-- wp:golden-hive/store-visit /-->`);
    src.save.mockClear();
    const out = await savePage(src, { id: 2, markup: NEW, expected: opened.version });
    expect(out).toEqual({ outcome: "stale", current: (await src.read(2)).version });
    expect(src.save).not.toHaveBeenCalled();
    expect((await src.read(2)).markup).toBe(`<!-- wp:golden-hive/store-visit /-->`);
  });

  it("refuses when the markup changed within the same second (same modified time)", async () => {
    const opened = await fixturePages().read(2);
    // Another save in the same second: the same modified_gmt, other markup (and so another digest).
    const other = "<!-- wp:golden-hive/store-hours /-->";
    const src = source({
      read: async (id) => {
        const page = await fixturePages().read(id);
        return { ...page, markup: other, version: { ...page.version, digest: markupDigest(other) } };
      },
    });
    const out = await savePage(src, { id: 2, markup: NEW, expected: opened.version });
    expect(out.outcome).toBe("stale");
    expect(src.save).not.toHaveBeenCalled();
  });

  it("blocks a page with errors, without writing; warnings alone do not block", async () => {
    const src = source();
    const expected = (await src.read(2)).version;
    const out = await savePage(src, { id: 2, markup: `<!-- wp:golden-hive/cta-banner {"title":"Il "drop""} /-->`, expected });
    if (out.outcome !== "blocked") throw new Error(out.outcome);
    expect(out.check.errors).toBe(1);
    expect(out.check.diff.changes.length).toBeGreaterThan(0);
    expect(src.save).not.toHaveBeenCalled();
    expect((await savePage(src, { id: 2, markup: `<p>Solo HTML</p>`, expected })).outcome).toBe("saved");
  });

  it("blocks golden-hive blocks the registry could not vouch for", async () => {
    const src = source({ blockTypes: () => Promise.reject(new Error("403")) });
    const out = await savePage(src, { id: 2, markup: NEW, expected: (await src.read(2)).version });
    expect(out.outcome).toBe("blocked");
    expect(src.save).not.toHaveBeenCalled();
  });

  it("says which capabilities the WordPress user lacks, instead of failing on save", async () => {
    const src = source({ access: async () => ({ user: "Shop", missing: ["edit_others_pages"], filtered: true }) });
    const out = await savePage(src, { id: 2, markup: NEW, expected: (await src.read(2)).version });
    expect(out).toEqual({ outcome: "noAccess", access: { user: "Shop", missing: ["edit_others_pages"], filtered: true } });
    expect(src.save).not.toHaveBeenCalled();
  });

  it("does not save a page that already holds exactly this markup", async () => {
    const src = source();
    const page = await src.read(3);
    expect(await savePage(src, { id: 3, markup: page.markup, expected: page.version })).toEqual({ outcome: "unchanged" });
    expect(src.save).not.toHaveBeenCalled();
  });

  it("says when WordPress stored other markup than the one sent (filtered on save)", async () => {
    const base = fixturePages();
    const src = source({ save: async (id, markup) => base.save(id, markup.replace(/<script>.*?<\/script>/, "")) });
    const markup = `<!-- wp:html -->\n<div>x</div><script>alert(1)</script>\n<!-- /wp:html -->`;
    const out = await savePage(src, { id: 4, markup, expected: (await src.read(4)).version });
    if (out.outcome !== "saved") throw new Error(out.outcome);
    expect(out.saved.altered).toBe(true);
  });
});

describe("checkPage", () => {
  it("compares with the page as it is now, and says when it moved since it was opened", async () => {
    const src = source();
    const opened = await src.read(2);
    const first = await checkPage(src, { id: 2, markup: NEW, expected: opened.version });
    expect(first.stale).toBe(false);
    expect(first.check.diff.changes.map((c) => c.kind)).toEqual(["changed", "removed"]);
    await src.save(2, NEW);
    expect((await checkPage(src, { id: 2, markup: NEW, expected: opened.version })).stale).toBe(true);
  });
});
