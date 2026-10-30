"use client";

import * as React from "react";
import { useI18n } from "@/i18n/provider";
import type { OperationInput, OperationTarget } from "@/lib/vetrina/catalog-ops";
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
  type ActSheetProps,
} from "./parts";

/**
 * "Elimina", confirmed with the preview: the products that go — to the
 * trash and out of the Hub — the ones the supplier's feed keeps (it would
 * put them back), the sales they had, the homepage sections that lose them.
 * For products the shop no longer sells; "Nascondi" takes them only out of
 * sight.
 */
export function DeleteSheet(props: ActSheetProps) {
  const target = useLastShown(props.target);
  return (
    <ActSheetFrame open={props.target != null} onClose={props.onClose} detent="content">
      {target && <DeleteContent {...props} target={target} />}
    </ActSheetFrame>
  );
}

function DeleteContent({ target, label, onClose, onStarted }: ActSheetProps & { target: OperationTarget }) {
  const { t } = useI18n();
  const d = t.vetrinaCatalog.act.delete;
  const input: OperationInput = { kind: "delete", target };
  const preview = usePreview(input);
  const { run, busy, error } = useStartAction(onClose, onStarted);
  const count = buttonCount(preview);

  return (
    <>
      <SheetHead title={d.title} subtitle={label} onClose={onClose} />
      <SheetBody>
        {/* One product says "it", several "they": a query, as many as its preview finds (until then, "they"). */}
        <p className={`${CARD} px-4 py-3 text-[15px] leading-snug`}>
          {d.hint(target.kind === "ids" ? target.ids.length : count || 2)}
        </p>
        <PreviewView state={preview} />
      </SheetBody>
      <SheetFooter error={error}>
        <PrimaryButton busy={busy} danger disabled={!preview.current || count === 0} onClick={() => void run(input)}>
          {count ? d.start(count) : d.plain}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}
