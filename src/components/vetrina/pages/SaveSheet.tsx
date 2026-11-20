"use client";

import { useI18n } from "@/i18n/provider";
import type { PageCheck } from "@/lib/pages/types";
import { ActSheetFrame, HEADING, PrimaryButton, SheetBody, SheetFooter, SheetHead, useLastShown } from "../catalog/act/parts";
import { CheckView, DiffView, Note } from "./parts";

/**
 * "Aggiorna"'s confirmation: what the save changes, block by block, the
 * warnings the check left (errors never reach here), the front page's
 * warning that a whole-page paste replaces the Vetrina's latest edits, and
 * the one button that writes.
 */
export function SaveSheet({
  check,
  title,
  front,
  busy,
  onSave,
  onClose,
}: {
  /** The clean check of the markup about to be saved; null = closed. */
  check: PageCheck | null;
  title: string;
  /** The page the Vetrina edits too. */
  front: boolean;
  busy: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const w = t.vetrinaCatalog.pages;
  const shown = useLastShown(check);
  return (
    <ActSheetFrame open={check != null} onClose={busy ? () => {} : onClose}>
      {shown && (
        <>
          <SheetHead title={w.confirm.title} subtitle={w.confirm.subtitle(title)} onClose={onClose} />
          <SheetBody>
            {front && <Note tone="warning">{w.confirm.front}</Note>}
            <div>
              <span className={HEADING}>{w.diff.title}</span>
              <DiffView diff={shown.diff} />
            </div>
            {shown.warnings > 0 && <CheckView check={shown} />}
            <p className="px-1 text-[13px] leading-snug opacity-60">{w.confirm.revisions}</p>
          </SheetBody>
          <SheetFooter>
            <PrimaryButton onClick={onSave} busy={busy}>
              {w.confirm.yes}
            </PrimaryButton>
          </SheetFooter>
        </>
      )}
    </ActSheetFrame>
  );
}
