import { describe, expect, it } from "vitest";
import type { SectionDraft } from "@/lib/vetrina/types";
import { movedUnderDraft, movesSection } from "./section-reload";

const state = (over: Partial<SectionDraft> = {}): SectionDraft => ({
  pin: [3, 1],
  exclude: [9],
  fallback: "menu_order",
  fields: { title: "TENDENZA" },
  limit: 8,
  ...over,
});

describe("the section editor reading its section again", () => {
  it("reads again after an action that can change what a section shows — not after a sale or a margin", () => {
    for (const kind of ["pin", "hide", "show", "categorize", "uncategorize", "tag", "untag", "order", "sourceOrder"] as const) {
      expect(movesSection(kind)).toBe(true);
    }
    for (const kind of ["sale", "unsale", "margin"] as const) expect(movesSection(kind)).toBe(false);
  });

  it("says the section changed under the draft only when it did", () => {
    const before = { state: state(), shown: [3, 1, 4, 5] };
    // Read again after a sale on one of its products: the same section.
    expect(movedUnderDraft(before, { state: state(), shown: [3, 1, 4, 5] })).toBe(false);
    // A product hidden from the shop leaves it; a pin from elsewhere; its title edited.
    expect(movedUnderDraft(before, { state: state(), shown: [3, 1, 5] })).toBe(true);
    expect(movedUnderDraft(before, { state: state({ pin: [7, 3, 1] }), shown: [7, 3, 1, 4, 5] })).toBe(true);
    expect(movedUnderDraft(before, { state: state({ fields: { title: "NOVITÀ" } }), shown: [3, 1, 4, 5] })).toBe(true);
  });
});
