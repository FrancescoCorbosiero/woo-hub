import { describe, expect, it } from "vitest";
import { MAX_CONDITIONS, ruleFromList, type ListFilters } from "./prefill";

const nike: ListFilters = {
  term: { taxonomy: "brand", id: 7, path: "Nike" },
  status: "all",
  within: null,
  q: "",
};

describe("ruleFromList", () => {
  it("is the term alone when nothing is chosen", () => {
    expect(ruleFromList(nike)).toEqual({
      conditions: [{ field: "brand", op: "is", value: "7", label: "Nike" }],
      notes: [],
    });
  });

  it("names a category by its path, and the chosen brand inside it", () => {
    const { conditions } = ruleFromList({
      term: { taxonomy: "category", id: 12, path: "Saldi › Sneakers" },
      status: "all",
      within: { id: 7, name: "Nike" },
      q: "",
    });
    expect(conditions).toEqual([
      { field: "category", op: "is", value: "12", label: "Saldi › Sneakers" },
      { field: "brand", op: "is", value: "7", label: "Nike" },
    ]);
  });

  it("reads a brand's category chip as a category condition", () => {
    const { conditions } = ruleFromList({ ...nike, within: { id: 30, name: "Sneakers" } });
    expect(conditions[1]).toEqual({ field: "category", op: "is", value: "30", label: "Sneakers" });
  });

  it("says each status chip as its condition", () => {
    expect(ruleFromList({ ...nike, status: "instock" }).conditions[1]).toEqual({ field: "inStock", op: "is", value: "" });
    expect(ruleFromList({ ...nike, status: "outofstock" }).conditions[1]).toEqual({
      field: "inStock",
      op: "isNot",
      value: "",
    });
    expect(ruleFromList({ ...nike, status: "onsale" }).conditions[1]).toEqual({ field: "onSale", op: "is", value: "" });
  });

  it("leaves Nascosti out, and says so", () => {
    const prefill = ruleFromList({ ...nike, status: "hidden" });
    expect(prefill.conditions).toHaveLength(1);
    expect(prefill.notes).toEqual(["hidden"]);
  });

  it("turns the search into one 'name contains' per word, each word once", () => {
    const prefill = ruleFromList({ ...nike, q: "  Dunk low DUNK " });
    expect(prefill.conditions.slice(1)).toEqual([
      { field: "title", op: "contains", value: "Dunk" },
      { field: "title", op: "contains", value: "low" },
    ]);
    expect(prefill.notes).toEqual(["search"]);
  });

  it("never goes past the editor's limit", () => {
    const q = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    const prefill = ruleFromList({ ...nike, status: "onsale", within: { id: 30, name: "Sneakers" }, q });
    expect(prefill.conditions).toHaveLength(MAX_CONDITIONS);
  });
});
