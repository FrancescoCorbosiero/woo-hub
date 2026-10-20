"use client";

import * as React from "react";
import { Dialog, DialogButton } from "konsta/react";
import { useI18n } from "@/i18n/provider";

/** "Sposta in posizione…": a number from 1 to how many the site shows. */
export function PositionDialog({
  open,
  initial,
  max,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** The row's place now. */
  initial: number;
  max: number;
  onCancel: () => void;
  onConfirm: (position: number) => void;
}) {
  const { t } = useI18n();
  const v = t.vetrina.editor;
  const [value, setValue] = React.useState(String(initial));
  // Each opening starts from the row's own place.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setValue(String(initial));
  }

  return (
    <Dialog
      opened={open}
      onBackdropClick={onCancel}
      title={v.positionTitle}
      content={
        <input
          type="number"
          inputMode="numeric"
          enterKeyHint="done"
          min={1}
          max={max}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={v.positionHint(max)}
          placeholder={v.positionHint(max)}
          className="mt-2 w-full rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2.5 text-center text-[20px] font-semibold tabular-nums outline-none dark:border-white/15 dark:bg-white/10"
        />
      }
      buttons={
        <>
          <DialogButton onClick={onCancel}>{v.actions.cancel}</DialogButton>
          <DialogButton
            strong
            onClick={() => {
              const n = Math.round(Number(value));
              if (n >= 1) onConfirm(Math.min(n, max));
              else onCancel();
            }}
          >
            {v.positionConfirm}
          </DialogButton>
        </>
      }
    />
  );
}

/** The page changed under the draft: publish again over the new version? */
export function StaleDialog({ open, onClose, onRetry }: { open: boolean; onClose: () => void; onRetry: () => void }) {
  const { t } = useI18n();
  const v = t.vetrina.editor;
  return (
    <Dialog
      opened={open}
      onBackdropClick={onClose}
      title={v.stale.title}
      content={v.stale.body}
      buttons={
        <>
          <DialogButton onClick={onClose}>{v.stale.close}</DialogButton>
          <DialogButton
            strong
            onClick={() => {
              onClose();
              onRetry();
            }}
          >
            {v.stale.retry}
          </DialogButton>
        </>
      }
    />
  );
}
