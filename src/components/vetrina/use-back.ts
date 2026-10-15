"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * The Vetrina's back buttons go back, as a phone app's do: to the screen the
 * owner came from (a search, the Brand list, the section editor), as it was
 * left. Only when the app has no such screen behind this one — a link opened
 * from outside, a reload — does a button open its fallback (the parent).
 *
 * The browser does not say what is behind the current entry, so the app
 * keeps its own trail of the screens it has shown. Only paths are kept: a
 * list's search and chips are written in place (replaceState) and are not
 * screens of their own.
 */

/**
 * How the app came to show a path: a new screen (`push`), a back or forward
 * gesture or button (`traversal`), or a back button going up to its parent in
 * place of the screen it was on (`replace`).
 */
export type TrailStep = "push" | "traversal" | "replace";

/**
 * The trail once the app shows `pathname`: a new screen goes on top; a step
 * back takes the top off; going up to the parent takes the top's place, so
 * the screen left is never the parent's way back; a forward gesture, or a
 * jump the trail cannot place, starts it again from here — never a "back"
 * into a screen the browser does not have behind it.
 */
export function nextTrail(trail: readonly string[], pathname: string, step: TrailStep): string[] {
  if (trail.at(-1) === pathname) return [...trail];
  if (step === "push") return [...trail, pathname];
  if (step === "replace") return [...trail.slice(0, -1), pathname];
  if (trail.at(-2) === pathname) return trail.slice(0, -1);
  return [pathname];
}

/**
 * A back button's tap on `trail`: a real step back to the screen before when
 * there is one and `accepts` it; otherwise up to the button's parent.
 */
export function backStep(trail: readonly string[], accepts: (previous: string) => boolean): "back" | "up" {
  const previous = trail.length >= 2 ? trail[trail.length - 2] : null;
  return previous && accepts(previous) ? "back" : "up";
}

let trail: string[] = [];
/** A back or forward gesture just changed the path: the next path is a traversal, not a new screen. */
let traversed = false;
/** A back button is going up to this path, in place of the screen it was on. */
let replacing: string | null = null;

function onPopState(): void {
  if (window.location.pathname !== trail.at(-1)) traversed = true;
}

function record(pathname: string): void {
  const step: TrailStep = traversed ? "traversal" : replacing === pathname ? "replace" : "push";
  trail = nextTrail(trail, pathname, step);
  traversed = false;
  replacing = null;
}

/** In the app shell: keeps the trail as the screens change. */
export function useScreenTrail(): void {
  const pathname = usePathname();
  React.useEffect(() => {
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  React.useEffect(() => record(pathname), [pathname]);
}

/**
 * A back button's tap: back to the previous screen when there is one and
 * `accepts` it, otherwise up to `fallback`. Going up replaces the screen it
 * was on, in the browser's history and in the trail: pushed, the parent's own
 * back would find the child behind it and return there, and back would bounce
 * between the two forever. A modified click (a new tab) is left to the browser.
 */
export function useBack(fallback: string, accepts: (previous: string) => boolean = () => true): (e?: React.MouseEvent) => void {
  const router = useRouter();
  return React.useCallback(
    (e?: React.MouseEvent) => {
      if (e && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
      e?.preventDefault();
      if (backStep(trail, accepts) === "back") {
        router.back();
        return;
      }
      replacing = new URL(fallback, window.location.href).pathname;
      router.replace(fallback);
    },
    [router, fallback, accepts],
  );
}
