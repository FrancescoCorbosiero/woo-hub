import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexRow } from "@/server/collections/index-rows";

// The demo shop stands in for the site; the store index is its products, read here.
vi.mock("@/lib/env", () => ({ env: { VETRINA_SOURCE: "fixture" } }));
vi.mock("@/server/overrides/repo", () => ({ getOverrides: async () => null }));
vi.mock("./catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./catalog")>();
  const { DEMO_BRAND_PARENT, DEMO_TERM_IDS, DEMO_TERM_NAMES } = await import("./fixture-data");
  const brands = new Set(Object.keys(DEMO_BRAND_PARENT));
  const term = (slug: string) => ({ id: DEMO_TERM_IDS[slug], name: DEMO_TERM_NAMES[slug], slug });
  return {
    ...actual,
    readCatalogTrees: async () => ({
      category: actual.termTree(Object.keys(DEMO_TERM_IDS).filter((s) => !brands.has(s)).map(term)),
      brand: actual.termTree(
        [...brands].map((s) => ({ ...term(s), parent: DEMO_BRAND_PARENT[s] ? DEMO_TERM_IDS[DEMO_BRAND_PARENT[s]!] : 0 })),
      ),
    }),
    homepagePresence: async () => ({ terms: new Map([["brand:205", [{ key: "brand:adidas#0", title: "ADIDAS" }]]]), products: new Map() }),
  };
});
vi.mock("./operations/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./operations/context")>();
  const { demoShop } = await import("./fixture-source");
  const { DEMO_TERM_IDS } = await import("./fixture-data");
  return {
    ...actual,
    rowsInOrder: async (ids: readonly number[]) => {
      const byId = new Map(demoShop().products.map((p) => [p.id, p]));
      const rows = ids.flatMap((id) => {
        const p = byId.get(id);
        if (!p) return [];
        const row: Partial<IndexRow> = {
          id: p.id,
          onSale: p.onSale,
          categories: p.categories.map((slug) => ({ id: DEMO_TERM_IDS[slug], slug, name: slug })),
          brands: [{ id: DEMO_TERM_IDS[p.brand], slug: p.brand, name: p.brand }],
          tags: [],
        };
        return [row as IndexRow];
      });
      return { rows, missing: [] };
    },
  };
});

import { addSection, arrangeSections, changeSectionSource, previewSectionSource, removeSection, switchSection } from "./layout";
import { rememberSiteFeatures } from "./powers";
import { publishRail, readHome, readRail } from "./service";
import { demoShop } from "./fixture-source";

const SALDI = "category:saldi-sneakers-outlet#0";

beforeEach(() => {
  delete (globalThis as { __vetrinaDemo?: unknown }).__vetrinaDemo;
  delete (globalThis as { __vetrinaSiteFeatures?: unknown }).__vetrinaSiteFeatures;
});

const railKeys = async () => (await readHome()).home.blocks.flatMap((b) => (b.kind === "rail" ? [b.rail.key] : []));

/** SALDI with two pins: one adidas product of the category, one that is not adidas. */
async function saldiWithPins() {
  const { rail } = await readRail(SALDI);
  const byId = new Map(demoShop().products.map((p) => [p.id, p]));
  const adidas = rail.visible.find((id) => byId.get(id)!.brand.startsWith("adidas"))!;
  const other = rail.visible.find((id) => !byId.get(id)!.brand.startsWith("adidas"))!;
  await publishRail({
    key: SALDI,
    expectedModifiedGmt: rail.modifiedGmt,
    expectedAttrsHash: rail.attrsHash,
    pin: [other, adidas],
    exclude: [],
    fallback: rail.fallback,
  });
  return { adidas, other, rail: (await readRail(SALDI)).rail };
}

describe("what a section shows", () => {
  it("previews which pins stay, where else it shows, and that the button follows", async () => {
    const { adidas } = await saldiWithPins();
    const preview = await previewSectionSource(SALDI, { taxonomy: "brand", slug: "adidas" });
    expect(preview.keptPins).toEqual([adidas]);
    expect(preview.droppedPins).toBe(1);
    expect(preview.alsoIn).toEqual(["ADIDAS"]);
    expect(preview.fallback).toBe("menu_order");
    // NUOVI ARRIVI's button opens its category: pointed elsewhere, it follows.
    const nuovi = await previewSectionSource("category:new-nuove-release#0", { list: "best_selling" });
    expect(nuovi.buttonFollows).toBe(true);
    expect(nuovi.fallback).toBe("popularity");
  });

  it("points a section at a brand, with a new title, keeping the pins the brand holds", async () => {
    const { adidas, rail } = await saldiWithPins();
    const result = await changeSectionSource({
      key: SALDI,
      expectedModifiedGmt: rail.modifiedGmt,
      expectedAttrsHash: rail.attrsHash,
      source: { taxonomy: "brand", slug: "adidas" },
      fields: { title: "ADIDAS IN SALDO" },
    });
    // Above the page's own ADIDAS section, it is the first adidas section now.
    expect(result.key).toBe("brand:adidas#0");
    const { rail: after } = await readRail(result.key);
    expect(after.path).toBe(rail.path);
    expect(after.terms[0].slug).toBe("adidas");
    expect(after.title).toBe("ADIDAS IN SALDO");
    expect(after.pin).toEqual([adidas]);
    expect(await railKeys()).toContain("brand:adidas#1");

    // "Annulla": the category back, its pins exactly as they were.
    await changeSectionSource({
      key: result.key,
      expectedModifiedGmt: result.modifiedGmt,
      expectedAttrsHash: result.attrsHash,
      source: { taxonomy: "category", slug: "saldi-sneakers-outlet" },
      fields: { title: rail.title },
      restore: { pin: rail.pin, exclude: rail.exclude, fallback: rail.fallback },
    });
    const { rail: back } = await readRail(SALDI);
    expect(back.pin).toEqual(rail.pin);
    expect(back.title).toBe(rail.title);
  });

  it("refuses a section that changed meanwhile, and a source the shop does not have", async () => {
    const { rail } = await readRail(SALDI);
    await expect(
      changeSectionSource({ key: SALDI, expectedModifiedGmt: "old", expectedAttrsHash: rail.attrsHash, source: { list: "recent" } }),
    ).rejects.toMatchObject({ code: "stale" });
    await expect(previewSectionSource(SALDI, { taxonomy: "brand", slug: "puma" })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("a new section, one taken away", () => {
  it("adds a section next to another, as big as it", async () => {
    const { home } = await readHome();
    const added = await addSection({
      anchorKey: SALDI,
      place: "after",
      expectedModifiedGmt: home.modifiedGmt,
      source: { list: "best_selling" },
      fields: { title: "PIÙ VENDUTI", eyebrow: "I preferiti dei clienti" },
    });
    expect(added.key).toBe("type:best_selling#0");
    const keys = await railKeys();
    expect(keys[keys.indexOf(SALDI) + 1]).toBe("type:best_selling#0");
    const { rail } = await readRail("type:best_selling#0");
    expect(rail.title).toBe("PIÙ VENDUTI");
    expect(rail.limit).toBe(18);
    expect(rail.fallback).toBe("popularity");
    expect(rail.items.length).toBeGreaterThan(0);
  });

  it("refuses to add over a page that changed meanwhile", async () => {
    await expect(
      addSection({ anchorKey: SALDI, place: "after", expectedModifiedGmt: "old", source: { list: "recent" }, fields: {} }),
    ).rejects.toMatchObject({ code: "stale" });
  });

  it("takes a section away, and its way back puts it where it was, as it was", async () => {
    const { rail: saldi } = await saldiWithPins();
    const before = await railKeys();
    const { home } = await readHome();
    const { restore } = await removeSection({ key: SALDI, expectedModifiedGmt: home.modifiedGmt });
    expect(await railKeys()).not.toContain(SALDI);
    expect(restore).toMatchObject({ anchorKey: before[0], place: "after", limit: 18 });

    const back = await addSection(restore);
    expect(back.key).toBe(SALDI);
    expect(await railKeys()).toEqual(before);
    const { rail } = await readRail(SALDI);
    expect(rail.pin).toEqual(saldi.pin);
    expect(rail.fields).toEqual(saldi.fields);
    expect(rail.attrsHash).toBe(saldi.attrsHash);
  });
});

describe("their order, a section switched off", () => {
  it("puts NUOVI ARRIVI first; the category slider keeps its place", async () => {
    const before = await railKeys();
    const { home } = await readHome();
    const slider = home.blocks.find((b) => b.name === "golden-hive/category-slider")!.path;
    const wanted = ["category:new-nuove-release#0", ...before.filter((k) => k !== "category:new-nuove-release#0")];
    const result = await arrangeSections({ keys: wanted, expectedModifiedGmt: home.modifiedGmt });
    expect(result.keys["category:new-nuove-release#0"]).toBe("category:new-nuove-release#0");
    const after = await readHome();
    expect(after.home.blocks.flatMap((b) => (b.kind === "rail" ? [b.rail.key] : []))).toEqual(wanted);
    expect(after.home.blocks.find((b) => b.name === "golden-hive/category-slider")!.path).toBe(slider);
    expect(after.home.blocks.find((b) => b.kind === "rail")!.path).toBe("8.0");

    await expect(arrangeSections({ keys: wanted.slice(1), expectedModifiedGmt: after.home.modifiedGmt })).rejects.toMatchObject({
      code: "stale",
    });
  });

  it("switches a section off and on again", async () => {
    const { rail } = await readRail(SALDI);
    const off = await switchSection({ key: SALDI, on: false, expectedModifiedGmt: rail.modifiedGmt, expectedAttrsHash: rail.attrsHash });
    expect(off.fields.hidden).toBe("yes");
    const { rail: dark } = await readRail(SALDI);
    expect(dark.switchedOff).toBe(true);
    await switchSection({ key: SALDI, on: true, expectedModifiedGmt: dark.modifiedGmt, expectedAttrsHash: dark.attrsHash });
    expect((await readRail(SALDI)).rail.switchedOff).toBe(false);
  });

  it("the section editor's publish carries the switch with the rest of the draft", async () => {
    const { rail } = await readRail(SALDI);
    await publishRail({
      key: SALDI,
      expectedModifiedGmt: rail.modifiedGmt,
      expectedAttrsHash: rail.attrsHash,
      pin: rail.pin,
      exclude: rail.exclude,
      fallback: rail.fallback,
      fields: { ...rail.fields, hidden: "yes", title: "SALDI SPENTI" },
    });
    const { rail: after } = await readRail(SALDI);
    expect(after.switchedOff).toBe(true);
    expect(after.title).toBe("SALDI SPENTI");
  });
});

describe("an older plugin", () => {
  it("is asked to be updated, in its own words", async () => {
    const { home } = await readHome();
    rememberSiteFeatures(["homepage", "rail", "block-write"]);
    await expect(
      addSection({ anchorKey: SALDI, place: "after", expectedModifiedGmt: home.modifiedGmt, source: { list: "recent" }, fields: {} }),
    ).rejects.toMatchObject({ code: "plugin_outdated" });
    const { powers } = await readRail(SALDI);
    expect(powers).toMatchObject({ add: false, move: false, source: false, pluginOutdated: true });
  });
});
