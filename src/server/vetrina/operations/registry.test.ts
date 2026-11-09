import { describe, expect, it, vi } from "vitest";
import { MENU_ACTION_KINDS } from "@/lib/vetrina/menu-ops";
import { PAGE_ACTION_KINDS } from "@/lib/vetrina/page-ops";
import { TERM_ACTION_KINDS } from "@/lib/vetrina/term-ops";

/**
 * The actions as the API (and an assistant) see them: every kind the
 * server runs is described, each example is an input the server takes, and
 * each input's JSON Schema names its own kind.
 */

// The input's date checks read the shop's day from the service, which reaches the database.
vi.mock("./service", () => ({ shopToday: () => "2026-10-14" }));

const { ACTIONS, ACTION_KINDS, describeActions, parseAction } = await import("./registry");
const { OperationInputSchema } = await import("./input");

const catalogKinds = OperationInputSchema.options.map((option) => option.shape.kind.value as string);

describe("the actions' registry", () => {
  it("describes every action the server runs, the catalog's, the homepage's, the menus' and the taxonomy's", () => {
    expect([...ACTION_KINDS].sort()).toEqual([...catalogKinds, ...PAGE_ACTION_KINDS, ...MENU_ACTION_KINDS, ...TERM_ACTION_KINDS].sort());
    // A merge and a deletion run with the catalog's actions (they touch products), and are the taxonomy's all the same.
    const taxonomy: readonly string[] = [...TERM_ACTION_KINDS, "termMerge", "termDelete"];
    for (const kind of ACTION_KINDS) {
      const scope = PAGE_ACTION_KINDS.includes(kind as never)
        ? "homepage"
        : MENU_ACTION_KINDS.includes(kind as never)
          ? "menu"
          : taxonomy.includes(kind)
            ? "taxonomy"
            : "catalog";
      expect(ACTIONS[kind].scope, kind).toBe(scope);
    }
  });

  it("gives examples the server takes as they are", () => {
    for (const kind of ACTION_KINDS) {
      const parsed = parseAction(ACTIONS[kind].example);
      expect(parsed, kind).toMatchObject({ ok: true, data: { kind } });
    }
  });

  it("describes each input as JSON Schema, its kind a constant", () => {
    const described = describeActions();
    expect(described).toHaveLength(ACTION_KINDS.length);
    for (const action of described) {
      expect(action.input.type, action.kind).toBe("object");
      const properties = action.input.properties as Record<string, { const?: string }>;
      expect(properties.kind.const, action.kind).toBe(action.kind);
      expect(action.description.length, action.kind).toBeGreaterThan(40);
    }
  });

  it("carries the field descriptions a model reads", () => {
    const sale = describeActions().find((a) => a.kind === "sale")!;
    expect(JSON.stringify(sale.input)).toContain("Every product the catalog query matches when the action runs.");
    const add = describeActions().find((a) => a.kind === "sectionAdd")!;
    expect(JSON.stringify(add.input)).toContain("What a section shows");
  });

  it("refuses what is no action, or an action with a bad input", () => {
    expect(parseAction({ kind: "deleteEverything" })).toEqual({ ok: false, error: "Azione non valida." });
    expect(parseAction(null)).toMatchObject({ ok: false });
    expect(parseAction({ kind: "sectionSwitch", key: "category:x#0" })).toMatchObject({ ok: false });
    expect(parseAction({ kind: "sale", target: { kind: "ids", ids: [1] }, percent: 95, rounding: "charm", endsOn: null })).toEqual({
      ok: false,
      error: "Lo sconto va da 1 a 90%.",
    });
  });
});
