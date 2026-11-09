"use client";

import * as React from "react";
import { Actions, ActionsButton, ActionsGroup, ActionsLabel, Dialog, DialogButton } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { MenuSummary, ThemePlace } from "@/lib/menus/types";
import { useMenuWrites } from "./use-menu-writes";

/**
 * Which menu a place of the theme shows: picked from the menus (or none),
 * then said and confirmed — the site changes at once — and written with
 * "Annulla".
 */

/** A place, and the menu it is to show (null: none). */
export interface PlaceChange {
  place: ThemePlace;
  menu: { id: number; name: string } | null;
}

/** The menus a place may show, the one it shows marked, and "Nessun menu" when it shows one. */
export function PlacePicker({
  place,
  menus,
  onPick,
  onClose,
}: {
  place: ThemePlace | null;
  menus: readonly Pick<MenuSummary, "id" | "name">[];
  onPick: (change: PlaceChange) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const m = t.vetrinaCatalog.menus;
  const [shown, setShown] = React.useState(place);
  if (place != null && place !== shown) setShown(place);
  const current = place ?? shown;

  return (
    <Actions opened={place != null} onBackdropClick={onClose}>
      <ActionsGroup>
        <ActionsLabel>{current ? m.place.title(current.name) : ""}</ActionsLabel>
        {current &&
          menus.map((menu) =>
            menu.id === current.menu?.id ? (
              <ActionsButton key={menu.id} onClick={onClose} bold>
                {menu.name} · {m.place.current}
              </ActionsButton>
            ) : (
              <ActionsButton key={menu.id} onClick={() => onPick({ place: current, menu: { id: menu.id, name: menu.name } })}>
                {menu.name}
              </ActionsButton>
            ),
          )}
        {current?.menu && <ActionsButton onClick={() => onPick({ place: current, menu: null })}>{m.home.none}</ActionsButton>}
      </ActionsGroup>
      <ActionsGroup>
        <ActionsButton bold onClick={onClose}>
          {m.more.cancel}
        </ActionsButton>
      </ActionsGroup>
    </Actions>
  );
}

/** The yes to a place's change, said in full: the site shows it at once. */
export function PlaceDialog({ change, onClose }: { change: PlaceChange | null; onClose: () => void }) {
  const { t } = useI18n();
  const m = t.vetrinaCatalog.menus;
  const writes = useMenuWrites();
  const [shown, setShown] = React.useState(change);
  if (change != null && change !== shown) setShown(change);
  const current = change ?? shown;
  const before = current?.place.menu?.name ?? null;

  function confirm() {
    if (!current) return;
    onClose();
    void writes.run(
      { kind: "menuLocation", location: current.place.slug, menuId: current.menu?.id ?? null },
      current.menu ? m.done.placed(current.menu.name, current.place.name) : m.done.emptied(current.place.name),
    );
  }

  return (
    <Dialog
      opened={change != null}
      onBackdropClick={onClose}
      title={m.place.confirmTitle}
      content={
        current
          ? current.menu
            ? m.place.confirmShow(current.menu.name, current.place.name, before)
            : m.place.confirmEmpty(current.place.name, before ?? "")
          : ""
      }
      buttons={
        <>
          <DialogButton onClick={onClose}>{m.place.no}</DialogButton>
          <DialogButton strong onClick={confirm}>
            {m.place.yes}
          </DialogButton>
        </>
      }
    />
  );
}
