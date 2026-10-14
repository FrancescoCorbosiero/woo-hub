"use client";

import * as React from "react";
import { useI18n } from "@/i18n/provider";
import type { ProductSelection } from "./selection";

/**
 * "Seleziona", turning a list's rows into a selection — and "Annulla" in the
 * same place while selecting, as iOS's Mail does. ProductList shows one in
 * its header; a screen can put its own in the navbar instead.
 */
export function SelectButton({
  selection,
  disabled = false,
  className = "",
}: {
  selection: ProductSelection;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const words = t.vetrinaCatalog.act;
  const selecting = selection.active;
  return (
    <button
      type="button"
      disabled={disabled && !selecting}
      aria-pressed={selecting}
      aria-label={selecting ? undefined : words.select.buttonLabel}
      onClick={() => (selecting ? selection.exit() : selection.start())}
      className={`inline-flex h-11 shrink-0 items-center rounded-full px-2 text-[14px] font-medium text-primary transition-opacity active:opacity-50 disabled:opacity-30 ${className}`}
    >
      {selecting ? words.bar.cancel : words.select.button}
    </button>
  );
}
