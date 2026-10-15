import { describe, expect, it } from "vitest";
import { backStep, nextTrail } from "./use-back";

describe("the app's trail of screens", () => {
  it("puts a new screen on top, and takes it off on a step back", () => {
    let trail = nextTrail([], "/vetrina/catalogo", "push");
    trail = nextTrail(trail, "/vetrina/catalogo/brand/100", "push");
    trail = nextTrail(trail, "/vetrina/catalogo/brand/101", "push");
    expect(trail).toEqual(["/vetrina/catalogo", "/vetrina/catalogo/brand/100", "/vetrina/catalogo/brand/101"]);
    expect(nextTrail(trail, "/vetrina/catalogo/brand/100", "traversal")).toEqual(["/vetrina/catalogo", "/vetrina/catalogo/brand/100"]);
  });

  it("ignores the same screen again (a search written in place)", () => {
    expect(nextTrail(["/a", "/b"], "/b", "push")).toEqual(["/a", "/b"]);
  });

  it("starts again after a forward gesture or a jump it cannot place, so back never leaves the app", () => {
    expect(nextTrail(["/a", "/b"], "/c", "traversal")).toEqual(["/c"]);
    expect(nextTrail([], "/a", "traversal")).toEqual(["/a"]);
  });

  it("puts the parent in place of the screen it goes up from", () => {
    expect(nextTrail(["/a", "/b", "/c"], "/p", "replace")).toEqual(["/a", "/b", "/p"]);
    expect(nextTrail([], "/p", "replace")).toEqual(["/p"]);
  });
});

/* ---------------------------------------------------------------- *
 * The catalog's back arrow, tap after tap (browse.tsx's BackButton)
 * ---------------------------------------------------------------- */

const HOME = "/vetrina";
const BRANDS = "/vetrina/catalogo";
const NIKE = "/vetrina/catalogo/brand/201";
const DUNK = "/vetrina/catalogo/brand/204";

/** Each screen's back button and its parent: the Brand list has none. */
const PARENT: Record<string, string> = {
  [NIKE]: `${BRANDS}?tab=brand`,
  [DUNK]: NIKE,
};

/** As browse.tsx's sameTab: back goes to the screen before unless that is the other tab. */
const sameTab = (previous: string) => previous !== HOME && previous !== "/";

/** Tap the back arrow until there is none (or `max` taps): the screens it lands on. */
function tapBack(start: string[], max = 6): string[] {
  let trail = start;
  const landed: string[] = [];
  for (let i = 0; i < max; i++) {
    const here = trail.at(-1)!;
    const parent = PARENT[here];
    if (!parent) break;
    trail =
      backStep(trail, sameTab) === "back"
        ? nextTrail(trail, trail.at(-2)!, "traversal")
        : nextTrail(trail, new URL(parent, "http://x").pathname, "replace");
    landed.push(trail.at(-1)!);
  }
  return landed;
}

const shown = (...paths: string[]) => paths.reduce<string[]>((trail, path) => nextTrail(trail, path, "push"), []);

describe("the catalog's back arrow", () => {
  it("climbs to the catalog's root after a tab switch, never back down to the screen it left", () => {
    // Brand list → Nike → Nike Dunk → Homepage tab → Catalogo tab (it opens on Nike Dunk again).
    const trail = shown(BRANDS, NIKE, DUNK, HOME, DUNK);
    expect(tapBack(trail)).toEqual([NIKE, BRANDS]);
  });

  it("steps back within the tab as the owner came", () => {
    expect(tapBack(shown(BRANDS, NIKE, DUNK))).toEqual([NIKE, BRANDS]);
    // Opened Nike Dunk from a search: back is the search, not the parent.
    expect(backStep(shown(BRANDS, DUNK), sameTab)).toBe("back");
  });

  it("goes up to the parent from a link opened from outside, or a reload", () => {
    expect(tapBack(shown(DUNK))).toEqual([NIKE, BRANDS]);
  });
});
