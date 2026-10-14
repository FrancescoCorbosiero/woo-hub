"use client";

import * as React from "react";

/**
 * Who has the bottom of the screen: the tab bar, or a selection's action
 * bar. While a selection bar shows, the tab bar steps aside (VetrinaTabbar
 * reads useSelectionBarShown), as a phone's tabs do in edit mode. A count,
 * not a flag: a screen leaving while the next one's bar arrives must not
 * bring the tab bar back under it.
 */

let holders = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => holders > 0;
const serverSnapshot = () => false;

/** True while a selection bar holds the bottom of the screen. */
export function useSelectionBarShown(): boolean {
  return React.useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** A selection bar takes the bottom of the screen while `shown`. */
export function useHoldBottomBar(shown: boolean): void {
  React.useEffect(() => {
    if (!shown) return;
    holders += 1;
    emit();
    return () => {
      holders -= 1;
      emit();
    };
  }, [shown]);
}

/**
 * The selection bar's height above the tab bar's (its two rows against the
 * tab bar's one): what a list adds below its last row while selecting, on
 * top of the room TabbarSpacer leaves (--vetrina-tabbar).
 */
export const SELECTION_BAR_EXTRA = "60px";

/** Where things floating above the bottom bar sit: over the selection bar while it shows, else over the tab bar. */
export const SELECTION_BAR_SPACE = `calc(var(--vetrina-tabbar, 0px) + ${SELECTION_BAR_EXTRA})`;
