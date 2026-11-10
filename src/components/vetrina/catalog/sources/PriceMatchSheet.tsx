"use client";

import * as React from "react";
import { useI18n } from "@/i18n/provider";
import type { OperationInput, OperationView } from "@/lib/vetrina/catalog-ops";
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

/**
 * "Allinea i prezzi" from a ranking's comparison, confirmed with the
 * preview: each product brought to the price the other shop shows (its
 * cheapest size there, the others moved by the same amount), what is left
 * as it is and why (on sale, no price of the Hub's, sizes the Hub does not
 * price), and what to know (locks the sync keeps, a size under the market's
 * lowest ask). It runs in the operations log, with "Annulla".
 */

export interface PriceMatchRequest {
  source: string;
  items: { productId: number; price: number }[];
}

export function PriceMatchSheet({
  request,
  onClose,
  onStarted,
}: {
  request: PriceMatchRequest | null;
  onClose: () => void;
  onStarted?: (view: OperationView) => void;
}) {
  const shown = useLastShown(request);
  return (
    <ActSheetFrame open={request != null} onClose={onClose} detent="content">
      {shown && <PriceMatchContent request={shown} onClose={onClose} onStarted={onStarted} />}
    </ActSheetFrame>
  );
}

function PriceMatchContent({
  request,
  onClose,
  onStarted,
}: {
  request: PriceMatchRequest;
  onClose: () => void;
  onStarted?: (view: OperationView) => void;
}) {
  const { t } = useI18n();
  const c = t.vetrinaCatalog.sources.compare;
  const input: OperationInput = { kind: "priceMatch", items: request.items, source: request.source };
  const preview = usePreview(input);
  const { run, busy, error } = useStartAction(onClose, onStarted);
  const count = buttonCount(preview);

  return (
    <>
      <SheetHead title={c.alignTitle} subtitle={request.source} onClose={onClose} />
      <SheetBody>
        <p className={`${CARD} px-4 py-3 text-[15px] leading-snug`}>{c.pricesIntro}</p>
        <PreviewView state={preview} />
      </SheetBody>
      <SheetFooter error={error}>
        <PrimaryButton busy={busy} disabled={!preview.current || !count} onClick={() => void run(input)}>
          {c.align(count ?? request.items.length)}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}
