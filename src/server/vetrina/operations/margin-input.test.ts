import { describe, expect, it, vi } from "vitest";

/**
 * What the screens may ask of a margin, checked before anything runs: a
 * category or a brand by id, and a whole percent from 0 to 200 — or null,
 * back to the standard margin. A screen cannot slip a target or a rule in.
 */

// The input's date checks read the shop's day from the service, which reaches the database.
vi.mock("./service", () => ({ shopToday: () => "2026-10-14" }));

const { parseOperationInput } = await import("./input");

describe("a margin's input", () => {
  it("takes a term and a whole percent, or null for the standard", () => {
    expect(
      parseOperationInput({
        kind: "margin",
        taxonomy: "category",
        termId: 11,
        percent: 25,
      }),
    ).toEqual({
      ok: true,
      data: { kind: "margin", taxonomy: "category", termId: 11, percent: 25 },
    });
    expect(
      parseOperationInput({
        kind: "margin",
        taxonomy: "brand",
        termId: 7,
        percent: null,
      }),
    ).toEqual({
      ok: true,
      data: { kind: "margin", taxonomy: "brand", termId: 7, percent: null },
    });
    expect(
      parseOperationInput({
        kind: "margin",
        taxonomy: "brand",
        termId: 7,
        percent: 0,
      }).ok,
    ).toBe(true);
    expect(
      parseOperationInput({
        kind: "margin",
        taxonomy: "brand",
        termId: 7,
        percent: 200,
      }).ok,
    ).toBe(true);
  });

  it("refuses a percent out of range or not whole, in the owner's words", () => {
    for (const percent of [-1, 201, 12.5]) {
      expect(
        parseOperationInput({
          kind: "margin",
          taxonomy: "category",
          termId: 11,
          percent,
        }),
      ).toEqual({
        ok: false,
        error: "Il ricarico va da 0 a 200%.",
      });
    }
  });

  it("refuses a term that is not one", () => {
    for (const bad of [
      { taxonomy: "tag", termId: 11 },
      { taxonomy: "category", termId: 0 },
      { taxonomy: "category", termId: 1.5 },
    ]) {
      expect(parseOperationInput({ kind: "margin", percent: 25, ...bad })).toEqual({ ok: false, error: "Categoria o brand non valido." });
    }
  });

  it("keeps only what a margin is: a screen's extra fields are dropped", () => {
    const parsed = parseOperationInput({
      kind: "margin",
      taxonomy: "category",
      termId: 11,
      percent: 25,
      target: { kind: "ids", ids: [1] },
      rule: { id: "x", scope: {}, enabled: true },
    });
    expect(parsed).toEqual({
      ok: true,
      data: { kind: "margin", taxonomy: "category", termId: 11, percent: 25 },
    });
  });
});
