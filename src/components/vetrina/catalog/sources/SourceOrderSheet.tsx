"use client";

import * as React from "react";
import { useI18n } from "@/i18n/provider";
import type { OperationInput, OperationView } from "@/lib/vetrina/catalog-ops";
import type { OrderTerm } from "../act/OrderSheet";
import {
  ActSheetFrame,
  buttonCount,
  CARD,
  PreviewView,
  PrimaryButton,
  SheetBody,
  SheetFooter,
  SheetHead,
  useLastShown,
  usePreview,
  useStartAction,
} from "../act/parts";
import { OrderSourcesSheet, type SourceRef } from "./OrderSourcesSheet";

/**
 * "Usa l'ordine di «X»", confirmed with the preview: on a category or a
 * brand (its screen's sort sheet), or on the whole catalog (the source's
 * own sheet) — the products moved (#37 → #1), those the source does not
 * rank (they follow, in their order), and what to know.
 */

export interface SourceOrderRequest {
  source: SourceRef;
  /** The category or brand; null for the whole catalog. */
  term: OrderTerm | null;
}

export function SourceOrderSheet({
  request,
  onClose,
  onStarted,
}: {
  request: SourceOrderRequest | null;
  onClose: () => void;
  onStarted?: (view: OperationView) => void;
}) {
  const shown = useLastShown(request);
  return (
    <ActSheetFrame open={request != null} onClose={onClose} detent="content">
      {shown && <ApplyContent request={shown} onClose={onClose} onStarted={onStarted} />}
    </ActSheetFrame>
  );
}

function ApplyContent({
  request,
  onClose,
  onStarted,
}: {
  request: SourceOrderRequest;
  onClose: () => void;
  onStarted?: (view: OperationView) => void;
}) {
  const { t } = useI18n();
  const a = t.vetrinaCatalog.sources.apply;
  const { source, term } = request;
  const input: OperationInput = {
    kind: "sourceOrder",
    sourceId: source.id,
    term: term ? { taxonomy: term.taxonomy, id: term.id } : null,
  };
  const preview = usePreview(input);
  const { run, busy, error } = useStartAction(onClose, onStarted);
  const count = buttonCount(preview);

  return (
    <>
      <SheetHead title={a.title(source.name)} subtitle={term?.name ?? a.whole} onClose={onClose} />
      <SheetBody>
        <p className={`${CARD} px-4 py-3 text-[15px] leading-snug`}>{a.intro}</p>
        <PreviewView state={preview} />
      </SheetBody>
      <SheetFooter error={error}>
        <PrimaryButton busy={busy} disabled={!preview.current || !count} onClick={() => void run(input)}>
          {count ? a.start(count) : a.plain}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}

/**
 * The two sheets a screen needs for order sources — managing them, and
 * using one — behind one state: `manage()` opens the list, `apply()` a
 * source on a term (or the whole catalog). Render `sheets` once.
 */
export function useOrderSourceSheets(onStarted?: (view: OperationView) => void) {
  const [managing, setManaging] = React.useState(false);
  const [applying, setApplying] = React.useState<SourceOrderRequest | null>(null);
  const manage = React.useCallback(() => setManaging(true), []);
  const apply = React.useCallback((source: SourceRef, term: OrderTerm | null) => setApplying({ source, term }), []);
  const sheets = (
    <>
      <OrderSourcesSheet open={managing} onClose={() => setManaging(false)} onApply={(source) => setApplying({ source, term: null })} />
      <SourceOrderSheet request={applying} onClose={() => setApplying(null)} onStarted={onStarted} />
    </>
  );
  return { manage, apply, sheets };
}
