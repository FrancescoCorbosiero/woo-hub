import { describe, expect, it } from "vitest";
import { whenText } from "./when";

const words = {
  today: (time: string) => `oggi alle ${time}`,
  yesterday: (time: string) => `ieri alle ${time}`,
  tomorrow: (time: string) => `domani alle ${time}`,
  onDay: (day: string, time: string) => `${day} alle ${time}`,
};
const ROME = "Europe/Rome";
// 10 November 2026, 00:30 in Rome (UTC+1): just past midnight.
const NOW = Date.UTC(2026, 10, 9, 23, 30);

describe("when something happened, as the owner says it", () => {
  it("says today, yesterday and tomorrow by the shop's calendar, not the server's", () => {
    expect(whenText(Date.UTC(2026, 10, 9, 23, 5), NOW, ROME, "it", words)).toBe("oggi alle 00:05");
    // 22:50 UTC on the 9th is 23:50 in Rome on the 9th: yesterday, for a shop already on the 10th.
    expect(whenText(Date.UTC(2026, 10, 9, 22, 50), NOW, ROME, "it", words)).toBe("ieri alle 23:50");
    expect(whenText(Date.UTC(2026, 10, 11, 3, 30), NOW, ROME, "it", words)).toBe("domani alle 04:30");
  });

  it("names the day further away", () => {
    expect(whenText(Date.UTC(2026, 10, 7, 3, 30), NOW, ROME, "it", words)).toBe("7 nov alle 04:30");
    expect(whenText(Date.UTC(2026, 10, 7, 3, 30), NOW, ROME, "en", words)).toBe("7 Nov alle 04:30");
  });
});
