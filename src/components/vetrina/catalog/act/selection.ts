"use client";

import * as React from "react";
import {
  clearPicked,
  NO_SELECTION,
  selectAll,
  startSelection,
  togglePicked,
  type PickedProduct,
  type SelectionState,
} from "./model";

/**
 * A list's selection, as a screen holds it and hands it to ProductList:
 * "Seleziona" (or a long press on a row) starts it, rows toggle, "Seleziona
 * tutti" takes everything the list's query matches, and the action bar acts
 * on it. Kept by the screen, so it can start it from its own navbar too.
 */
export interface ProductSelection extends SelectionState {
  /** Start selecting, with this product picked (a long press) or none ("Seleziona"). */
  start: (first?: PickedProduct) => void;
  /** Leave selection ("Annulla", or an action started). */
  exit: () => void;
  /**
   * A row tapped while selecting; under "all", it becomes the rows on screen
   * less this one — only when they are every match (`total`); else nothing.
   */
  toggle: (product: PickedProduct, onScreen: readonly PickedProduct[], total: number) => void;
  /** Everything the list's query matches, loaded or not. */
  selectAll: () => void;
  /** Nothing chosen, still selecting. */
  clear: () => void;
}

export function useProductSelection(): ProductSelection {
  const [state, setState] = React.useState<SelectionState>(NO_SELECTION);
  const start = React.useCallback((first?: PickedProduct) => setState(startSelection(first)), []);
  const exit = React.useCallback(() => setState(NO_SELECTION), []);
  const toggle = React.useCallback(
    (product: PickedProduct, onScreen: readonly PickedProduct[], total: number) =>
      setState((s) => togglePicked(s, product, onScreen, total)),
    [],
  );
  const all = React.useCallback(() => setState(selectAll()), []);
  const clear = React.useCallback(() => setState(clearPicked()), []);
  return React.useMemo(
    () => ({ ...state, start, exit, toggle, selectAll: all, clear }),
    [state, start, exit, toggle, all, clear],
  );
}
