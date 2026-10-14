import { describe, expect, it } from "vitest";
import { getDictionary } from "@/i18n/dictionary";
import type { OperationView, TermMarginState } from "@/lib/vetrina/catalog-ops";
import {
  activeMargin,
  backText,
  clampPercent,
  marginInput,
  marginText,
  nowText,
  ownPercent,
  rowShown,
  rowText,
  rowTitle,
  runningText,
  startPercent,
} from "./model";

const m = getDictionary("it").vetrinaCatalog.margins;
const plain = (text: string) => text.replace(/ /g, " ");

const state = (over: Partial<TermMarginState> = {}): TermMarginState => ({
  own: null,
  inherited: null,
  standard: { kind: "bands" },
  priced: 34,
  applies: 30,
  supplier: 0,
  storeOnly: 0,
  ...over,
});

function op(status: OperationView["status"], over: Partial<OperationView> = {}): OperationView {
  return {
    id: "op",
    kind: "margin",
    label: "Ricarico 25% · Nike",
    status,
    progress: { done: 12, total: 41 },
    changed: 0,
    failed: 0,
    error: null,
    termKey: "category:11",
    createdAt: "2026-10-14T10:00:00.000Z",
    finishedAt: null,
    undoable: false,
    undoneAt: null,
    ...over,
  };
}

describe("the Ricarico row", () => {
  it("says the term's own margin, else a term above it's, else the standard", () => {
    expect(rowTitle(state(), "category", m)).toBe("Ricarico: standard (a fasce)");
    expect(rowTitle(state({ standard: null }), "category", m)).toBe("Ricarico: standard");
    expect(
      rowTitle(
        state({
          inherited: { term: "Nike", value: { kind: "percent", percent: 25 } },
        }),
        "category",
        m,
      ),
    ).toBe("Ricarico: 25% da «Nike»");
    const own = state({
      own: { kind: "percent", percent: 30 },
      inherited: { term: "Nike", value: { kind: "percent", percent: 25 } },
    });
    expect(rowTitle(own, "category", m)).toBe("Ricarico di questa categoria: 30%");
    expect(rowTitle(own, "brand", m)).toBe("Ricarico di questo brand: 30%");
    expect(plain(marginText({ kind: "fixed", amount: 10 }, m))).toBe("+10 €");
  });

  it("says how many products it applies to, and how many the supplier prices", () => {
    expect(rowText(state(), m)).toBe("Vale per 30 prodotti");
    expect(rowText(state({ applies: 1, supplier: 12 }), m)).toBe("Vale per 1 prodotto · 12 col prezzo del fornitore");
    expect(rowText(state({ applies: 0 }), m)).toBe("Nessun prodotto lo segue");
  });

  it("shows only where a margin can act: products the Hub prices from the market", () => {
    expect(rowShown(state())).toBe(true);
    expect(rowShown(state({ priced: 0, supplier: 20, storeOnly: 3 }))).toBe(false);
  });

  it("follows the term's margin action while it runs — no other term's, no other kind", () => {
    const running = op("running");
    expect(activeMargin([running], "category", 11)).toBe(running);
    expect(activeMargin([running], "category", 12)).toBeNull();
    expect(activeMargin([running], "brand", 11)).toBeNull();
    expect(activeMargin([{ ...running, kind: "sale" }], "category", 11)).toBeNull();
    expect(runningText(running, m)).toBe("Aggiorno i prezzi… 12/41");
    expect(runningText(op("running", { queued: true }), m)).toBe(m.row.waiting);
    expect(runningText(op("undoing"), m)).toBe("Rimetto il ricarico di prima…");
  });
});

describe("the margin sheet", () => {
  it("starts on the term's own percent, else the one it follows, else 25 %", () => {
    expect(startPercent(state({ own: { kind: "percent", percent: 30 } }))).toBe(30);
    expect(
      startPercent(
        state({
          inherited: { term: "Nike", value: { kind: "percent", percent: 22 } },
        }),
      ),
    ).toBe(22);
    expect(startPercent(state({ standard: { kind: "percent", percent: 35 } }))).toBe(35);
    expect(startPercent(state())).toBe(25);
    // A margin of bands set on the Hub has no percent to start from.
    expect(startPercent(state({ own: { kind: "bands" } }))).toBe(25);
    expect(ownPercent(state({ own: { kind: "bands" } }))).toBeNull();
  });

  it("keeps the percent whole and between 0 and 200", () => {
    expect(clampPercent(24.6)).toBe(25);
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(250)).toBe(200);
    expect(clampPercent(Number.NaN)).toBe(25);
  });

  it("asks for the margin chosen; nothing on the margin the term has; null to go back to the standard", () => {
    const term = { taxonomy: "category" as const, id: 11 };
    expect(marginInput(term, "set", 28, null)).toEqual({
      kind: "margin",
      taxonomy: "category",
      termId: 11,
      percent: 28,
    });
    expect(marginInput(term, "set", 30, 30)).toBeNull();
    expect(marginInput(term, "set", 31, 30)).toEqual({
      kind: "margin",
      taxonomy: "category",
      termId: 11,
      percent: 31,
    });
    expect(marginInput(term, "standard", 31, 30)).toEqual({
      kind: "margin",
      taxonomy: "category",
      termId: 11,
      percent: null,
    });
  });

  it("says what the term follows now, and where going back takes it", () => {
    const nike = {
      term: "Nike",
      value: { kind: "percent" as const, percent: 25 },
    };
    expect(nowText(state({ own: { kind: "percent", percent: 30 } }), m)).toBe("Adesso: 30%, il suo.");
    expect(nowText(state({ inherited: nike }), m)).toBe("Adesso: 25%, quello di «Nike».");
    expect(nowText(state(), m)).toBe("Adesso: lo standard (a fasce).");
    expect(backText(state({ own: { kind: "percent", percent: 30 } }), m)).toBe("I suoi prodotti tornano al ricarico standard (a fasce).");
    expect(backText(state({ own: { kind: "percent", percent: 30 }, inherited: nike }), m)).toBe(
      "I suoi prodotti tornano al ricarico di «Nike» (25%).",
    );
  });
});
