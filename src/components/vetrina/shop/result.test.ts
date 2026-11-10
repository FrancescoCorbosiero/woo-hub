import { describe, expect, it } from "vitest";
import { shopIt } from "@/i18n/dictionaries/catalog/shop.it";
import { resultLines } from "./result";

const words = shopIt.sync.result;

describe("what a sync by hand did, in the owner's words", () => {
  it("says the list read and the prices written, and points at the prices left for a person", () => {
    const lines = resultLines(
      {
        gs: { ok: true, count: 1240, feed: { added: 12, updated: 300, deactivated: 3 } },
        feedSync: { ok: true, count: 41, sync: { written: 40, added: 1, kept: 2, failed: 0, held: 0 } },
      },
      words,
    );
    expect(lines).toEqual([
      { tone: "ok", text: "Listino: 1240 prodotti, 12 nuovi, 3 non più disponibili" },
      { tone: "ok", text: "40 prezzi e disponibilità aggiornati" },
      { tone: "ok", text: "1 taglia aggiunta" },
      { tone: "warn", text: "2 prezzi cambiati su WordPress lasciati come sono: decidi tu", href: "/vetrina/negozio/prezzi" },
    ]);
  });

  it("says a list past its safety limit for what it is, and nothing written", () => {
    const lines = resultLines(
      { gs: { ok: true, count: 10 }, feedSync: { ok: false, note: "900 changes planned…", capped: { planned: 900, limit: 500 } } },
      words,
    );
    expect(lines[1]).toMatchObject({ tone: "error", detail: "900 changes planned…" });
    expect(lines[1].text).toMatch(/Troppe modifiche in una volta \(900; il limite è 500\): non ho scritto nulla/);
  });

  it("says the KicksDB prices apart, what waits for next time, and a step that failed", () => {
    const lines = resultLines(
      {
        gs: { ok: false, note: "GS answered 503" },
        feedSync: { ok: true, sync: { written: 0, added: 0, kept: 0, failed: 0, held: 0 } },
        kicksdb: { ok: true, count: 80 },
        storeSync: { ok: false, note: "3 failed", deferred: 120, sync: { written: 497, added: 0, kept: 0, failed: 3, held: 0 } },
      },
      words,
    );
    expect(lines.map((l) => [l.tone, l.text])).toEqual([
      ["error", "Listino del fornitore: non riuscito"],
      ["ok", "Prezzi e disponibilità erano già in pari"],
      ["ok", "497 prezzi KicksDB aggiornati"],
      ["error", "3 modifiche non riuscite"],
      ["warn", "Altri 120 alla prossima sincronizzazione"],
    ]);
  });
});
