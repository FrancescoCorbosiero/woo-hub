import { describe, expect, it } from "vitest";
import { getDictionary } from "@/i18n/dictionary";
import type { OperationView, TermMarginState } from "@/lib/vetrina/catalog-ops";
import {
  activeMargin,
  backLabel,
  backText,
  clampPercent,
  followedPercent,
  marginInput,
  marginText,
  idleRowShown,
  nowText,
  ownPercent,
  rowShown,
  rowText,
  rowTitle,
  runningText,
  startMode,
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
  hubRules: 0,
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
  it("says the term's own margin, else a term above it's, else the standard — one short title, whose under it", () => {
    expect(rowTitle(state(), m)).toBe("Ricarico: standard");
    expect(rowText(state(), "category", m)).toBe("Standard a fasce · Vale per 30 prodotti");
    expect(rowText(state({ standard: null }), "category", m)).toBe("Vale per 30 prodotti");
    const inherited = state({ inherited: { term: "Nike", value: { kind: "percent", percent: 25 } } });
    expect(rowTitle(inherited, m)).toBe("Ricarico: 25%");
    expect(rowText(inherited, "category", m)).toBe("Da «Nike» · Vale per 30 prodotti");
    const own = state({
      own: { kind: "percent", percent: 30 },
      inherited: { term: "Nike", value: { kind: "percent", percent: 25 } },
    });
    expect(rowTitle(own, m)).toBe("Ricarico: 30%");
    expect(rowText(own, "category", m)).toBe("Di questa categoria · Vale per 30 prodotti");
    expect(rowText(own, "brand", m)).toBe("Di questo brand · Vale per 30 prodotti");
    expect(plain(marginText({ kind: "fixed", amount: 10 }, m))).toBe("+10 €");
  });

  it("never says «standard» when other Hub rules price its products (a catalog brand's +3 €, a family's)", () => {
    expect(rowTitle(state({ hubRules: 30 }), m)).toBe("Ricarico: regole dell'Hub");
    expect(rowText(state({ hubRules: 30 }), "brand", m)).toBe("Vale per 30 prodotti");
    // A term above it still decides first: a store term outranks every catalog rule.
    const above = state({ hubRules: 4, inherited: { term: "Nike", value: { kind: "percent", percent: 25 } } });
    expect(rowTitle(above, m)).toBe("Ricarico: 25%");
    expect(rowText(above, "brand", m)).toBe("Da «Nike» · Vale per 30 prodotti");
  });

  it("says how many products it applies to, and how many the supplier prices", () => {
    expect(rowText(state({ standard: null }), "category", m)).toBe("Vale per 30 prodotti");
    expect(rowText(state({ standard: null, applies: 1, supplier: 12 }), "category", m)).toBe(
      "Vale per 1 prodotto · 12 col prezzo del fornitore",
    );
    expect(rowText(state({ standard: null, applies: 0 }), "category", m)).toBe("Nessun prodotto lo segue");
  });

  it("shows where a margin can act, and wherever the term has one of its own — so it can be removed", () => {
    expect(rowShown(state())).toBe(true);
    expect(rowShown(state({ priced: 0, supplier: 20, storeOnly: 3 }))).toBe(false);
    const stranded = state({ own: { kind: "percent", percent: 10 }, priced: 0, applies: 0, supplier: 20 });
    expect(rowShown(stranded)).toBe(true);
    expect(rowText(stranded, "category", m)).toBe("Nessun prodotto col prezzo dell'Hub, per ora");
    // ...and its sheet opens on taking it away, all it can do.
    expect(startMode(stranded)).toBe("standard");
    expect(startMode(state({ own: { kind: "percent", percent: 10 } }))).toBe("set");
  });

  it("keeps a quiet row where no margin can act, so the panel does not shrink once the margin is read", () => {
    const none = state({ priced: 0, applies: 0, supplier: 20, storeOnly: 3 });
    expect(idleRowShown(none, 23)).toBe(true);
    // An empty term drew no ghost: nothing to hold.
    expect(idleRowShown(none, 0)).toBe(false);
    // Where the row shows, it is the row.
    expect(idleRowShown(state(), 23)).toBe(false);
    expect(idleRowShown(state({ own: { kind: "percent", percent: 10 }, priced: 0 }), 23)).toBe(false);
    expect(m.row.noneHere).toBe("Nessun prezzo dell'Hub qui");
    expect(getDictionary("en").vetrinaCatalog.margins.row.noneHere).toBe("No Hub prices here");
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

  it("asks nothing on the margin the term follows now, its own or not: a rule saying the same changes no price", () => {
    const term = { taxonomy: "category" as const, id: 11 };
    const inherited = state({ inherited: { term: "Nike", value: { kind: "percent", percent: 25 } } });
    expect(followedPercent(inherited)).toBe(25);
    expect(marginInput(term, "set", 25, followedPercent(inherited))).toBeNull();
    expect(followedPercent(state({ standard: { kind: "percent", percent: 35 } }))).toBe(35);
    // Bands, or other Hub rules: no single percent it follows.
    expect(followedPercent(state())).toBeNull();
    expect(followedPercent(state({ standard: { kind: "percent", percent: 35 }, hubRules: 3 }))).toBeNull();
    expect(followedPercent(state({ own: { kind: "percent", percent: 30 }, inherited: inherited.inherited }))).toBe(30);
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
    expect(nowText(state({ own: { kind: "percent", percent: 30 } }), "category", m)).toBe("Adesso: 30% (di questa categoria).");
    expect(nowText(state({ own: { kind: "percent", percent: 30 } }), "brand", m)).toBe("Adesso: 30% (di questo brand).");
    expect(nowText(state({ inherited: nike }), "category", m)).toBe("Adesso: 25%, quello di «Nike».");
    expect(nowText(state(), "category", m)).toBe("Adesso: lo standard (a fasce).");
    expect(nowText(state({ hubRules: 5 }), "brand", m)).toBe("Adesso: le regole dell'Hub (di un brand, di una famiglia…).");
    expect(backText(state({ own: { kind: "percent", percent: 30 } }), m)).toBe("I suoi prodotti tornano al ricarico standard (a fasce).");
    expect(backText(state({ own: { kind: "percent", percent: 30 }, inherited: nike }), m)).toBe(
      "I suoi prodotti tornano al ricarico di «Nike» (25%).",
    );
    expect(backText(state({ own: { kind: "percent", percent: 30 }, hubRules: 2 }), m)).toBe(
      "I suoi prodotti tornano alle regole dell'Hub che li prezzano.",
    );
  });

  it("names the button for where the products go back to — never «standard» when it is not", () => {
    const own = { kind: "percent" as const, percent: 30 };
    expect(backLabel(state({ own }), m)).toBe("Torna al ricarico standard");
    expect(backLabel(state({ own, inherited: { term: "Nike", value: { kind: "percent", percent: 25 } } }), m)).toBe(
      "Torna al ricarico di «Nike»",
    );
    expect(backLabel(state({ own, hubRules: 2 }), m)).toBe("Torna alle regole dell'Hub");
  });
});
