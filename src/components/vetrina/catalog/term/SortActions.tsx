"use client";

import * as React from "react";
import { Actions, ActionsButton, ActionsGroup, ActionsLabel } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { CATALOG_SORTS, type CatalogSort } from "@/lib/vetrina/catalog";
import { Check, SortArrows } from "./glyphs";

/**
 * "Ordina: Negozio" above a list, and the action sheet it opens. "Negozio" is
 * the store's own order (menu_order, then name). The storefront adds to it:
 * sold-out products last, and on a category a homepage section shows, that
 * section's pins first — neither is applied here.
 */
export function SortActions({ sort, onChange }: { sort: CatalogSort; onChange: (sort: CatalogSort) => void }) {
  const { t } = useI18n();
  const s = t.vetrinaCatalog.term.sort;
  const [open, setOpen] = React.useState(false);

  function choose(next: CatalogSort) {
    setOpen(false);
    if (next !== sort) onChange(next);
  }

  return (
    <>
      {/* The short words ("Prezzo ↑"), the whole ones for a screen reader; on the narrowest phone the label
          gives way before the list's count does. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={s.button(s.options[sort])}
        className="-me-2 inline-flex h-11 min-w-0 items-center gap-1.5 rounded-full px-2 text-[14px] font-medium text-primary transition-opacity active:opacity-50"
      >
        <SortArrows className="h-4 w-4 shrink-0" />
        <span className="truncate">{s.button(s.short[sort])}</span>
      </button>
      <Actions opened={open} onBackdropClick={() => setOpen(false)}>
        <ActionsGroup>
          <ActionsLabel>{s.title}</ActionsLabel>
          {CATALOG_SORTS.map((option) => (
            <ActionsButton key={option} bold={option === sort} aria-pressed={option === sort} onClick={() => choose(option)}>
              {s.options[option]}
              {option === sort && <Check className="absolute end-5 h-5 w-5" />}
            </ActionsButton>
          ))}
        </ActionsGroup>
        <ActionsGroup>
          <ActionsButton bold onClick={() => setOpen(false)}>
            {s.cancel}
          </ActionsButton>
        </ActionsGroup>
      </Actions>
    </>
  );
}
