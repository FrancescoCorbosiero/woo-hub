"use client";

import { Actions, ActionsButton, ActionsGroup, ActionsLabel } from "konsta/react";
import { useI18n } from "@/i18n/provider";

/**
 * A row's "⋯": on top, to a position, back to automatic, hidden from the
 * section, its prices, the product on the site. Each closes the sheet; the
 * changes join the draft.
 */
export function RowActions({
  open,
  name,
  permalink,
  canPin,
  pinned,
  canHide,
  onClose,
  onTop,
  onPosition,
  onUnpin,
  onHide,
  onPrices,
}: {
  open: boolean;
  name: string;
  permalink: string | undefined;
  /** The config lets the owner pin, and the section can be edited. */
  canPin: boolean;
  /** Pinned (or a ghost): it can go back to automatic. */
  pinned: boolean;
  canHide: boolean;
  onClose: () => void;
  onTop: () => void;
  onPosition: () => void;
  onUnpin: () => void;
  onHide: () => void;
  onPrices: () => void;
}) {
  const { t } = useI18n();
  const v = t.vetrina.editor;
  const run = (action: () => void) => () => {
    action();
    onClose();
  };
  return (
    <Actions opened={open} onBackdropClick={onClose}>
      <ActionsGroup>
        <ActionsLabel>{name}</ActionsLabel>
        {open && canPin && (
          <>
            <ActionsButton onClick={run(onTop)}>{v.actions.top}</ActionsButton>
            <ActionsButton onClick={run(onPosition)}>{v.actions.position}</ActionsButton>
            {pinned && <ActionsButton onClick={run(onUnpin)}>{v.actions.unpin}</ActionsButton>}
          </>
        )}
        {open && canHide && <ActionsButton onClick={run(onHide)}>{v.actions.hide}</ActionsButton>}
        {open && <ActionsButton onClick={run(onPrices)}>{v.actions.prices}</ActionsButton>}
        {permalink && (
          <ActionsButton onClick={run(() => window.open(permalink, "_blank", "noreferrer"))}>{v.actions.openSite}</ActionsButton>
        )}
      </ActionsGroup>
      <ActionsGroup>
        <ActionsButton bold onClick={onClose}>
          {v.actions.cancel}
        </ActionsButton>
      </ActionsGroup>
    </Actions>
  );
}
