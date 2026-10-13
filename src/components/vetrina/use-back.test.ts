import { describe, expect, it } from "vitest";
import { nextTrail } from "./use-back";

describe("the app's trail of screens", () => {
  it("puts a new screen on top, and takes it off on a step back", () => {
    let trail = nextTrail([], "/vetrina/catalogo", false);
    trail = nextTrail(trail, "/vetrina/catalogo/brand/100", false);
    trail = nextTrail(trail, "/vetrina/catalogo/brand/101", false);
    expect(trail).toEqual(["/vetrina/catalogo", "/vetrina/catalogo/brand/100", "/vetrina/catalogo/brand/101"]);
    expect(nextTrail(trail, "/vetrina/catalogo/brand/100", true)).toEqual(["/vetrina/catalogo", "/vetrina/catalogo/brand/100"]);
  });

  it("ignores the same screen again (a search written in place)", () => {
    expect(nextTrail(["/a", "/b"], "/b", false)).toEqual(["/a", "/b"]);
  });

  it("starts again after a forward gesture or a jump it cannot place, so back never leaves the app", () => {
    expect(nextTrail(["/a", "/b"], "/c", true)).toEqual(["/c"]);
    expect(nextTrail([], "/a", true)).toEqual(["/a"]);
  });
});
