"use client";

import * as React from "react";

/**
 * True on the render where `value` is not the one the previous render saw
 * (Object.is), false otherwise — the first render included. State that follows
 * a prop is then adjusted during that very render, React's way ("Adjusting some
 * state when a prop changes"), instead of in an effect after it: no extra
 * render, no frame showing the old state.
 *
 *   const reopened = useChanged(open ? railKey : null);
 *   if (reopened && open) setStates(null);
 */
export function useChanged<T>(value: T): boolean {
  const [seen, setSeen] = React.useState(value);
  if (Object.is(seen, value)) return false;
  setSeen(value);
  return true;
}
