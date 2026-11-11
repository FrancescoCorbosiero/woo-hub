import { describe, expect, it } from "vitest";
import {
  checkAutomation,
  DEFAULT_AUTOMATION,
  fromLegacyEnv,
  legacyEnvSet,
  resolveAutomation,
  sameAutomation,
} from "./automation";

describe("the Automatic sync settings, before anything is saved", () => {
  it("are the defaults on a deploy that sets none of the former variables", () => {
    expect(resolveAutomation(undefined, fromLegacyEnv({}))).toEqual({
      settings: DEFAULT_AUTOMATION,
      saved: false,
      dropped: [],
    });
    // Out of the box: the store follows the feed every 15 minutes, nothing else is written unattended.
    expect(DEFAULT_AUTOMATION).toMatchObject({
      storeSync: true,
      feedsEveryMinutes: 15,
      dailyStoreSync: false,
      dailyTimes: ["04:30"],
      timeZone: "Europe/Rome",
      autoRepair: false,
    });
  });

  it("start from what the former variables said, with their old meanings", () => {
    const { settings } = resolveAutomation(
      undefined,
      fromLegacyEnv({
        AUTO_SYNC: "on",
        SCHEDULER_FEEDS_MINUTES: 20,
        SCHEDULER_TIMES: "13:30, 04:30",
        SCHEDULER_TIMEZONE: "Europe/London",
        AUTO_SYNC_MAX_CHANGES: 300,
        SCHEDULER_ORDERS_MINUTES: 0,
        SCHEDULER_COLLECTIONS_MINUTES: 10,
        COLLECTIONS_MAX_CHANGES: 50,
        AUTO_REPAIR: "on",
        SCHEDULER_HEARTBEAT_URL: "https://hc-ping.com/daily",
      }),
    );
    expect(settings).toEqual({
      storeSync: true,
      feedsEveryMinutes: 20,
      autoPublish: true,
      dailyStoreSync: true,
      dailyTimes: ["04:30", "13:30"],
      timeZone: "Europe/London",
      maxChanges: 300,
      // AUTO_SYNC_STORE_MAX_CHANGES defaulted to AUTO_SYNC_MAX_CHANGES.
      storeMaxChanges: 300,
      ordersEveryMinutes: 0,
      collectionsEveryMinutes: 10,
      collectionsMaxChanges: 50,
      autoRepair: true,
      heartbeatUrl: "https://hc-ping.com/daily",
      feedsHeartbeatUrl: null,
    });
  });

  it("take AUTO_SYNC=off, or a feed cycle of 0 with AUTO_SYNC unset, as the store sync off", () => {
    expect(fromLegacyEnv({ AUTO_SYNC: "off" })).toEqual({ storeSync: false });
    expect(fromLegacyEnv({ SCHEDULER_FEEDS_MINUTES: 0 })).toEqual({ storeSync: false });
    // AUTO_SYNC=on said to write: it wins over a cycle of 0, whose interval stays the default.
    expect(fromLegacyEnv({ AUTO_SYNC: "on", SCHEDULER_FEEDS_MINUTES: 0 })).toEqual({ storeSync: true, dailyStoreSync: true });
    expect(fromLegacyEnv({ AUTO_SYNC_STORE_MAX_CHANGES: 5000, AUTO_SYNC_MAX_CHANGES: 400 })).toEqual({
      maxChanges: 400,
      storeMaxChanges: 5000,
    });
  });

  it("name the former variables still set, for the owner to remove", () => {
    expect(legacyEnvSet({ AUTO_SYNC: "on", SCHEDULER_TIMES: "04:30" })).toEqual(["AUTO_SYNC", "SCHEDULER_TIMES"]);
    expect(legacyEnvSet({})).toEqual([]);
  });
});

describe("the Automatic sync settings, once saved", () => {
  const saved = { ...DEFAULT_AUTOMATION, feedsEveryMinutes: 20, storeSync: true };

  it("are what was saved: the environment is no longer read", () => {
    const { settings, saved: isSaved } = resolveAutomation(saved, fromLegacyEnv({ AUTO_SYNC: "off", SCHEDULER_FEEDS_MINUTES: 45 }));
    expect(isSaved).toBe(true);
    expect(settings).toMatchObject({ storeSync: true, feedsEveryMinutes: 20 });
  });

  it("take a bad stored value back to its default, and nothing else with it", () => {
    const { settings, dropped } = resolveAutomation(
      { ...saved, feedsEveryMinutes: 2, timeZone: "Mars/Olympus", heartbeatUrl: "ftp://nope" },
      {},
    );
    expect(dropped.sort()).toEqual(["feedsEveryMinutes", "heartbeatUrl", "timeZone"]);
    expect(settings).toEqual({
      ...saved,
      feedsEveryMinutes: DEFAULT_AUTOMATION.feedsEveryMinutes,
      timeZone: DEFAULT_AUTOMATION.timeZone,
      heartbeatUrl: null,
    });
  });

  it("fill a setting added since they were saved with its default", () => {
    const { autoRepair: _gone, ...older } = saved;
    const { settings, dropped } = resolveAutomation(older, fromLegacyEnv({ AUTO_REPAIR: "on" }));
    expect(dropped).toEqual([]);
    expect(settings.autoRepair).toBe(false);
  });
});

describe("saving the settings", () => {
  it("keeps the times in order and once each, and a blank monitor URL as none", () => {
    const result = checkAutomation({
      ...DEFAULT_AUTOMATION,
      dailyTimes: ["20:30", " 04:30", "20:30"],
      heartbeatUrl: "  ",
      feedsHeartbeatUrl: " https://hc-ping.com/feeds ",
    });
    expect(result).toEqual({
      ok: true,
      settings: {
        ...DEFAULT_AUTOMATION,
        dailyTimes: ["04:30", "20:30"],
        heartbeatUrl: null,
        feedsHeartbeatUrl: "https://hc-ping.com/feeds",
      },
    });
  });

  it("says which fields are wrong", () => {
    const result = checkAutomation({
      ...DEFAULT_AUTOMATION,
      feedsEveryMinutes: 4,
      dailyTimes: ["25:00"],
      maxChanges: 0,
      ordersEveryMinutes: 1.5,
      timeZone: "Rome",
      feedsHeartbeatUrl: "javascript:alert(1)",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.invalid.sort()).toEqual(
      ["dailyTimes", "feedsEveryMinutes", "feedsHeartbeatUrl", "maxChanges", "ordersEveryMinutes", "timeZone"].sort(),
    );
  });

  it("refuses an empty list of times, and a body that is not settings at all", () => {
    const empty = checkAutomation({ ...DEFAULT_AUTOMATION, dailyTimes: [] });
    expect(empty).toEqual({ ok: false, invalid: ["dailyTimes"] });
    const nothing = checkAutomation(null);
    expect(nothing.ok).toBe(false);
  });

  it("tells two sets apart by what they say", () => {
    expect(sameAutomation(DEFAULT_AUTOMATION, { ...DEFAULT_AUTOMATION, dailyTimes: ["04:30"] })).toBe(true);
    expect(sameAutomation(DEFAULT_AUTOMATION, { ...DEFAULT_AUTOMATION, feedsEveryMinutes: 20 })).toBe(false);
  });
});
