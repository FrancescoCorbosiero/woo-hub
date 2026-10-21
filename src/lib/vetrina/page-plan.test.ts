import { describe, expect, it } from "vitest";
import { findSection, fingerprints, fingerprintsIn, movedCount, movedKeys, orderBack, refOf } from "./page-plan";

const section = (key: string, attrsHash = `h-${key}`) => ({ key, attrsHash });

describe("refOf", () => {
  it("keeps the key, the fingerprint and a title to name it by", () => {
    expect(refOf({ key: "category:saldi#0", attrsHash: "abc", title: "  SALDI " })).toEqual({
      key: "category:saldi#0",
      attrsHash: "abc",
      title: "SALDI",
    });
    expect(refOf({ key: "list:recent#0", attrsHash: "abc", title: " " }).title).toBe("list:recent#0");
  });
});

describe("findSection", () => {
  const page = [section("a"), section("b"), section("c")];

  it("finds the section by its fingerprint, under another key too (a move renamed it)", () => {
    expect(findSection(page, { key: "b", attrsHash: "h-b" })).toBe(page[1]);
    expect(findSection(page, { key: "old-name", attrsHash: "h-c" })).toBe(page[2]);
  });

  it("finds none when the section changed since, or is gone", () => {
    expect(findSection(page, { key: "b", attrsHash: "h-b-before-an-edit" })).toBeNull();
    expect(findSection([], { key: "b", attrsHash: "h-b" })).toBeNull();
  });

  it("between two equal sections, takes the one under the same key, else the first", () => {
    const twins = [section("x#0", "same"), section("x#1", "same")];
    expect(findSection(twins, { key: "x#1", attrsHash: "same" })).toBe(twins[1]);
    expect(findSection(twins, { key: "gone#3", attrsHash: "same" })).toBe(twins[0]);
  });
});

describe("movedKeys", () => {
  const keys = ["a", "b", "c", "d"];

  it("puts the section at the place asked, the others closing up", () => {
    expect(movedKeys(keys, "d", 1)).toEqual(["d", "a", "b", "c"]);
    expect(movedKeys(keys, "a", 3)).toEqual(["b", "c", "a", "d"]);
    expect(movedKeys(keys, "b", 2)).toEqual(keys);
  });

  it("takes a place past the end as the last, and one before the start as the first", () => {
    expect(movedKeys(keys, "a", 99)).toEqual(["b", "c", "d", "a"]);
    expect(movedKeys(keys, "c", 0)).toEqual(["c", "a", "b", "d"]);
  });
});

describe("movedCount", () => {
  it("counts the sections that left their place, not those pushed along", () => {
    expect(movedCount(["a", "b", "c", "d"], ["d", "a", "b", "c"])).toBe(1);
    expect(movedCount(["a", "b", "c", "d"], ["b", "a", "d", "c"])).toBe(2);
    expect(movedCount(["a", "b"], ["a", "b"])).toBe(0);
  });

  it("works on product ids as on section keys", () => {
    expect(movedCount([1, 2, 3], [3, 1, 2])).toBe(1);
  });
});

describe("a move's way back", () => {
  const before = [section("a"), section("b"), section("c")];
  const after = [section("c"), section("a"), section("b")];
  const order = { before: fingerprints(before), after: fingerprints(after) };

  it("puts the sections back in their places, by the keys they have now", () => {
    expect(orderBack(after, order)).toEqual(["a", "b", "c"]);
    // Two sections showing the same thing swap their "#n" when they move: the fingerprints still say which is which.
    const renamed = [section("c#0", "h-c"), section("a#1", "h-a"), section("b", "h-b")];
    expect(orderBack(renamed, order)).toEqual(["a#1", "b", "c#0"]);
  });

  it("refuses when the page changed since: a section edited, added, gone or moved again", () => {
    expect(orderBack([section("c"), section("a"), section("b", "edited")], order)).toBeNull();
    expect(orderBack([...after, section("new")], order)).toBeNull();
    expect(orderBack(after.slice(1), order)).toBeNull();
    expect(orderBack([section("a"), section("c"), section("b")], order)).toBeNull();
  });

  it("takes equal sections as interchangeable", () => {
    const twins = { before: ["same", "same", "h-z"], after: ["h-z", "same", "same"] };
    expect(orderBack([section("z"), section("x#0", "same"), section("x#1", "same")], twins)).toEqual(["x#0", "x#1", "z"]);
  });
});

describe("fingerprintsIn", () => {
  const page = [section("a"), section("b")];

  it("gives each key's fingerprint, in the order of the keys", () => {
    expect(fingerprintsIn(page, ["b", "a"])).toEqual(["h-b", "h-a"]);
  });

  it("refuses a key that names no section of the page", () => {
    expect(fingerprintsIn(page, ["b", "gone"])).toBeNull();
  });
});
