import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ScopedPricingRule } from "@core/config";

/**
 * Real-SQL test of the rule list's writers: every change is a locked
 * read-modify-write (config/repo.ts updateActiveConfig), and the Margins
 * tab's save is refused when the list moved since the tab loaded it — a
 * margin set from the Vetrina meanwhile is never dropped, nor a removed one
 * brought back. Opt-in, like the other DB suites:
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://…@localhost:…/… npm test
 *
 * The suite puts back the config it found.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.RUN_DB_TESTS === "1" && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

const load = async () => ({
  ...(await import("@/server/db/client")),
  ...(await import("@/server/db/schema")),
  ...(await import("@/server/config/repo")),
  ...(await import("@/server/config/defaults")),
  ...(await import("@/server/config/rule-list")),
  ...(await import("@/server/actions/config")),
});

const termRule = (id: number): ScopedPricingRule => ({
  id: `store-category-${id}`,
  scope: { storeCategory: id, storeTermName: `Term ${id}` },
  enabled: true,
  markupPercent: 25,
});

describe.skipIf(!enabled)("the rule list's writers (real SQL)", () => {
  let savedConfig: unknown[] = [];

  beforeAll(async () => {
    const { db, config } = await load();
    savedConfig = await db.select().from(config);
  });

  afterAll(async () => {
    const { db, config } = await load();
    await db.delete(config);
    if (savedConfig.length > 0) await db.insert(config).values(savedConfig as never);
  });

  beforeEach(async () => {
    const { db, config, saveActiveConfig, buildDefaultConfig } = await load();
    await db.delete(config);
    await saveActiveConfig(
      buildDefaultConfig({
        kicksDbApiKey: "",
        woo: { baseUrl: "", consumerKey: "", consumerSecret: "" },
        marketToCurrency: { IT: "EUR" },
      }),
    );
  });

  it("writers running at once all land: none builds on an old copy", async () => {
    const { updateActiveConfig, getActiveConfig } = await load();
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        updateActiveConfig(async (current) => {
          // Long enough for the others to read the same old copy without the lock.
          await new Promise((r) => setTimeout(r, 15));
          return { ...current, pricingRules: [...current.pricingRules, termRule(9300 + i)] };
        }),
      ),
    );
    const ids = (await getActiveConfig()).pricingRules.map((r) => r.id);
    for (let i = 0; i < 8; i++) expect(ids).toContain(`store-category-${9300 + i}`);
  });

  it("a Margins tab loaded before a Vetrina margin cannot save over it", async () => {
    const { getActiveConfig, updateActiveConfig, pricingRulesVersion, savePricingRules } = await load();
    // The tab opens: its copy, and the fingerprint it saves against.
    const opened = (await getActiveConfig()).pricingRules;
    const version = pricingRulesVersion(opened);

    // The owner sets "Ricarico 25%" on a category from the phone.
    await updateActiveConfig((current) => ({ ...current, pricingRules: [...current.pricingRules, termRule(9401)] }));

    // The operator then saves the tab's older copy, with an edit of his own.
    const edited = opened.map((r, i) => (i === 0 ? { ...r, markupPercent: 33 } : r));
    const res = await savePricingRules(edited, version);
    expect(res).toMatchObject({ ok: false, stale: true });

    // Nothing written: the Vetrina's rule stands, the general rule unchanged.
    const now = (await getActiveConfig()).pricingRules;
    expect(now.some((r) => r.id === "store-category-9401")).toBe(true);
    expect(now[0].markupPercent).toBe(opened[0].markupPercent);
  });

  it("a removed margin is not brought back by an older copy", async () => {
    const { getActiveConfig, updateActiveConfig, pricingRulesVersion, savePricingRules } = await load();
    await updateActiveConfig((current) => ({ ...current, pricingRules: [...current.pricingRules, termRule(9402)] }));
    const opened = (await getActiveConfig()).pricingRules;
    const version = pricingRulesVersion(opened);
    // "Torna al ricarico standard" from the phone.
    await updateActiveConfig((current) => ({
      ...current,
      pricingRules: current.pricingRules.filter((r) => r.id !== "store-category-9402"),
    }));
    expect(await savePricingRules(opened, version)).toMatchObject({ ok: false, stale: true });
    expect((await getActiveConfig()).pricingRules.some((r) => r.id === "store-category-9402")).toBe(false);
  });

  it("a save on the current list goes through, and hands back the list and fingerprint the next read sees", async () => {
    const { getActiveConfig, pricingRulesVersion, savePricingRules } = await load();
    const opened = (await getActiveConfig()).pricingRules;
    // The GoldenSneakers rule removed by the operator: the read puts it back.
    const edited = opened.filter((r) => r.scope.source !== "goldensneakers");
    const first = await savePricingRules(edited, pricingRulesVersion(opened));
    expect(first.ok).toBe(true);
    const read = (await getActiveConfig()).pricingRules;
    expect(first.rules).toEqual(read);
    expect(first.version).toBe(pricingRulesVersion(read));
    // ...so the tab's next save, against what it was handed, is not refused.
    const second = await savePricingRules(first.rules, first.version!);
    expect(second.ok).toBe(true);
  });
});
