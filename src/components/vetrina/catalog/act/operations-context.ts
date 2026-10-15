"use client";

import * as React from "react";
import type { OperationInput, OperationView } from "@/lib/vetrina/catalog-ops";
import type { VetrinaResult } from "@/server/vetrina/service";
import type { Outcome } from "./model";

/**
 * The catalog's actions as every screen reaches them: start one, undo one,
 * open the log, and hear when one ends. OperationsProvider (mounted once in
 * the Vetrina's app shell) follows them in the background.
 */
export interface Operations {
  /**
   * Start an action (after its preview). The answer comes at once: the
   * action runs in the background, followed by the tracker — the progress
   * pill, then a toast with "Annulla". A refusal is the server's own words,
   * for the sheet to show; nothing is toasted.
   */
  start: (input: OperationInput) => Promise<VetrinaResult<OperationView>>;
  /** "Annulla" (and a term's "Mostra"): followed like an action; a refusal is toasted. */
  undo: (id: string) => Promise<VetrinaResult<OperationView>>;
  /** The activity sheet: the log, with "Annulla" where it still can. */
  openActivity: () => void;
  /** Actions followed now (running, waiting, or being undone), newest first. */
  active: readonly OperationView[];
  /** Hear every followed action that ends; answers the unsubscribe. */
  subscribe: (listener: SettledListener) => () => void;
}

/** An action that was followed has ended: how, and as it is now. */
export type SettledListener = (view: OperationView, outcome: Outcome) => void;

export const OperationsContext = React.createContext<Operations | null>(null);

export function useOperations(): Operations {
  const ops = React.useContext(OperationsContext);
  if (!ops) throw new Error("useOperations needs <OperationsProvider> (the Vetrina's app shell mounts it).");
  return ops;
}

/**
 * Run `listener` whenever a followed action ends (done, failed, undone, or
 * an undo that failed): a list reads its rows again, a term panel its state.
 * Outside the provider it does nothing, so a list can be shown anywhere.
 */
export function useOperationSettled(listener: SettledListener): void {
  const ops = React.useContext(OperationsContext);
  const latest = React.useRef(listener);
  React.useEffect(() => {
    latest.current = listener;
  });
  const subscribe = ops?.subscribe;
  React.useEffect(() => {
    if (!subscribe) return;
    return subscribe((view, outcome) => latest.current(view, outcome));
  }, [subscribe]);
}
