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
 * The trail once the app shows `pathname`: a new screen goes on top; a back
 * gesture or button (`traversal`) takes the top off; a forward gesture, or a
 * jump the trail cannot place, starts it again from here — never a "back"
 * into a screen the browser does not have behind it.
 */
export function nextTrail(trail: readonly string[], pathname: string, traversal: boolean): string[] {
  if (trail.at(-1) === pathname) return [...trail];
  if (!traversal) return [...trail, pathname];
  if (trail.at(-2) === pathname) return trail.slice(0, -1);
  return [pathname];
}

let trail: string[] = [];
/** A back or forward gesture just changed the path: the next path is a traversal, not a new screen. */
let traversed = false;

function onPopState(): void {
  if (window.location.pathname !== trail.at(-1)) traversed = true;
}

function record(pathname: string): void {
  trail = nextTrail(trail, pathname, traversed);
  traversed = false;
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

/** The screen before this one, if this visit of the app has shown it. */
function previousScreen(): string | null {
  return trail.length >= 2 ? trail[trail.length - 2] : null;
}

/**
 * A back button's tap: back to the previous screen when there is one and
 * `accepts` it, otherwise to `fallback`. A modified click (a new tab) is left
 * to the browser.
 */
export function useBack(fallback: string, accepts: (previous: string) => boolean = () => true): (e?: React.MouseEvent) => void {
  const router = useRouter();
  return React.useCallback(
    (e?: React.MouseEvent) => {
      if (e && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
      e?.preventDefault();
      const previous = previousScreen();
      if (previous && accepts(previous)) router.back();
      else router.push(fallback);
    },
    [router, fallback, accepts],
  );
}
