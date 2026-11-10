import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationConfig } from "@core/config";
import { DEFAULT_AUTOMATION } from "@/lib/automation";

/**
 * Real-SQL test of the Automatic sync settings: saved with the rest of the
 * config, read back by every process, heard by the scheduler's listener —
 * and kept by the config's other writers (a margin saved, the pricing bar's
 * Reset). Before the first save the former environment variables are the
 * starting values; after it they are not read. Opt-in, like the other DB
 * suites:
 *
 *   DATABASE_URL=postgres://…@localhost:…/hub_test npm run test:db
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
  ...(await import("@/server/actions/config")),
  ...(await import("./settings")),
});

const every20: AutomationConfig = { ...DEFAULT_AUTOMATION, feedsEveryMinutes: 20, dailyTimes: ["04:30", "13:30"] };

describe.skipIf(!enabled)("the Automatic sync settings (real SQL)", () => {
  let savedConfig: unknown[] = [];

  beforeAll(async () => {
    // A deploy that still sets two of the former variables.
    vi.stubEnv("AUTO_SYNC", "off");
    vi.stubEnv("SCHEDULER_TIMES", "05:00");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, config } = await load();
    savedConfig = await db.select().from(config);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    delete (globalThis as { __storeHubAutomation?: unknown }).__storeHubAutomation;
    const { db, config } = await load();
    await db.delete(config);
    if (savedConfig.length > 0) await db.insert(config).values(savedConfig as never);
  });

  beforeEach(async () => {
    delete (globalThis as { __storeHubAutomation?: unknown }).__storeHubAutomation;
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

  it("start from the former variables, and stop reading them once saved", async () => {
    const { loadAutomation, saveAutomation, automationNow } = await load();
    const before = await loadAutomation();
    expect(before).toMatchObject({ saved: false, legacyEnv: ["AUTO_SYNC", "SCHEDULER_TIMES"] });
    expect(before.settings).toMatchObject({ storeSync: false, dailyTimes: ["05:00"] });

    const after = await saveAutomation(every20);
    expect(after).toEqual({ settings: every20, saved: true, legacyEnv: ["AUTO_SYNC", "SCHEDULER_TIMES"] });
    // The copy every synchronous reader takes: the saved one.
    expect(automationNow()).toEqual(every20);
    expect((await loadAutomation()).settings).toEqual(every20);
  });

  it("tell the listeners when they change, and only then", async () => {
    const { loadAutomation, saveAutomation, onAutomationChange } = await load();
    await loadAutomation();
    const heard: [AutomationConfig, AutomationConfig][] = [];
    onAutomationChange((next, previous) => heard.push([next, previous]));

    await saveAutomation(every20);
    expect(heard).toHaveLength(1);
    expect(heard[0][0].feedsEveryMinutes).toBe(20);
    expect(heard[0][1].storeSync).toBe(false);

    // Read again, unchanged: nothing to say.
    await loadAutomation();
    expect(heard).toHaveLength(1);
  });

  it("are kept by the config's other writers: a margin saved, the pricing bar's Reset", async () => {
    const { saveAutomation, updateActiveConfig, getActiveConfig, resetPricingToDefaults, updatePricing } = await load();
    await saveAutomation(every20);
    // A Taxonomies tab rule: another tab's too, kept by Reset as well.
    const rule = { id: "t1", enabled: true, scope: { brand: "Nike" }, category: "Sneakers > Nike" };
    await updateActiveConfig((current) => ({ ...current, taxonomy: { ...current.taxonomy, rules: [rule] } }));

    await updateActiveConfig((current) => ({
      ...current,
      pricingRules: current.pricingRules.map((r) => (r.id === "general" ? { ...r, markupPercent: 33 } : r)),
    }));
    expect((await getActiveConfig()).automation).toEqual(every20);

    const res = await updatePricing({
      markupPercent: 30,
      vatRatePercent: 0,
      roundingMode: "charm",
      increment: 0.99,
      minAsks: 1,
      minDeltaPercent: 3,
    });
    expect(res.ok).toBe(true);
    await resetPricingToDefaults();
    const after = await getActiveConfig();
    expect(after.automation).toEqual(every20);
    expect(after.taxonomy.rules).toEqual([rule]);
    // …and the margin went back to its default.
    expect(after.pricingRules[0].markupBands?.length).toBeGreaterThan(0);
  });

  it("take a hand-broken stored value back to its default, and keep the rest", async () => {
    const { db, config, loadAutomation } = await load();
    const [row] = await db.select().from(config);
    await db
      .update(config)
      .set({ data: { ...row.data, automation: { ...every20, feedsEveryMinutes: "often" } } as never });
    const state = await loadAutomation();
    expect(state.saved).toBe(true);
    expect(state.settings).toEqual({ ...every20, feedsEveryMinutes: DEFAULT_AUTOMATION.feedsEveryMinutes });
  });
});
