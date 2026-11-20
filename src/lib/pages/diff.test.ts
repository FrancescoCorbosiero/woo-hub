import { describe, expect, it } from "vitest";
import { diffMarkup } from "./diff";

const hero = (title: string) => `<!-- wp:golden-hive/hero-split {"title":"${title}"} /-->`;
const rail = (title: string) => `<!-- wp:golden-hive/shortcode-wrapper {"title":"${title}","shortcode":"[gh_product_rail category='saldi']"} /-->`;
const para = (text: string) => `<!-- wp:paragraph -->\n<p>${text}</p>\n<!-- /wp:paragraph -->`;
const group = (...inner: string[]) => `<!-- wp:group -->\n<div class="wp-block-group">${inner.join("\n\n")}</div>\n<!-- /wp:group -->`;
const page = (...blocks: string[]) => blocks.join("\n\n");

describe("diffMarkup", () => {
  it("the same markup: nothing changes", () => {
    const p = page(hero("A"), para("x"));
    expect(diffMarkup(p, p)).toEqual({ changes: [], unchanged: 2, identical: true });
  });

  it("names an added, a removed and a changed block, by name and place", () => {
    const before = page(hero("A"), para("uno"), rail("SALDI"));
    const after = page(hero("B"), rail("SALDI"), para("nuovo"));
    expect(diffMarkup(before, after)).toEqual({
      identical: false,
      unchanged: 1,
      changes: [
        { kind: "changed", before: { name: "golden-hive/hero-split", path: [1] }, after: { name: "golden-hive/hero-split", path: [1] }, attrs: ["title"], content: false },
        { kind: "removed", before: { name: "core/paragraph", path: [2] } },
        { kind: "added", after: { name: "core/paragraph", path: [3] } },
      ],
    });
  });

  it("a block inside a group changes alone: the group itself is unchanged", () => {
    const before = page(group(rail("A"), rail("B")));
    const after = page(group(rail("A"), rail("C")));
    const diff = diffMarkup(before, after);
    expect(diff.unchanged).toBe(2);
    expect(diff.changes).toEqual([
      {
        kind: "changed",
        before: { name: "golden-hive/shortcode-wrapper", path: [1, 2] },
        after: { name: "golden-hive/shortcode-wrapper", path: [1, 2] },
        attrs: ["title"],
        content: false,
      },
    ]);
  });

  it("content changes are said apart from attributes; attribute order does not count", () => {
    const diff = diffMarkup(page(para("a"), `<!-- wp:golden-hive/cta-banner {"a":1,"b":2} /-->`), page(para("b"), `<!-- wp:golden-hive/cta-banner {"b":2,"a":1} /-->`));
    expect(diff.unchanged).toBe(1);
    expect(diff.changes).toEqual([{ kind: "changed", before: { name: "core/paragraph", path: [1] }, after: { name: "core/paragraph", path: [1] }, attrs: [], content: true }]);
  });

  it("a moved block reads as removed from its old place and added at the new one", () => {
    const diff = diffMarkup(page(hero("A"), para("x"), rail("R")), page(rail("R"), hero("A"), para("x")));
    expect(diff.unchanged).toBe(2);
    expect(diff.changes.map((c) => c.kind).sort()).toEqual(["added", "removed"]);
  });

  it("loose HTML is compared as a block of its own", () => {
    const diff = diffMarkup(page(para("x")), page("<p>loose</p>", para("x")));
    expect(diff.changes).toEqual([{ kind: "added", after: { name: "core/freeform", path: [1] } }]);
    // Numbered as the check numbers blocks: loose HTML does not count, so the paragraph is still block 1.
    expect(diffMarkup(page(para("x")), page("<p>loose</p>", para("y"))).changes.map((c) => c.kind === "changed" && c.after.path)).toEqual([false, [1]]);
  });
});
