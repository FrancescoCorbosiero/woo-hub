import { describe, expect, it } from "vitest";
import type { CategoryOption } from "@/lib/collections/types";
import { takenBy } from "./naming";

const option = (id: number, path: string): CategoryOption => ({
  id,
  name: path.split(" › ").pop() ?? path,
  path,
  collectionId: null,
});

const categories = [option(1, "Saldi"), option(2, "Sneakers"), option(3, "Saldi › Nike")];

describe("takenBy", () => {
  it("finds a category with the same name under the same parent, case aside", () => {
    expect(takenBy(categories, "  saldi ", 0)?.id).toBe(1);
    expect(takenBy(categories, "NIKE", 1)?.id).toBe(3);
  });

  it("lets the same name live under another parent", () => {
    expect(takenBy(categories, "Nike", 0)).toBeUndefined();
    expect(takenBy(categories, "Nike", 2)).toBeUndefined();
  });

  it("says nothing for an empty name or an unknown parent", () => {
    expect(takenBy(categories, " ", 0)).toBeUndefined();
    expect(takenBy(categories, "Saldi", 99)).toBeUndefined();
  });
});
