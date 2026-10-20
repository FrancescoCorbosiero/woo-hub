"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Actions, ActionsButton, ActionsGroup, ActionsLabel, Dialog, DialogButton } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { moveKey, railSourceOf } from "@/lib/vetrina/sections";
import type { RailSummary } from "@/lib/vetrina/types";
import type { SectionPowers } from "@/server/vetrina/powers";
import { useLastShown } from "../catalog/act/parts";
import { sectionHref } from "../catalog/sheet/links";
import { useSectionWrites } from "./use-section-writes";

/**
 * A homepage section's "⋯" on the home screen: everything about the
 * section in one place — its products (open it, add some from the catalog),
 * what it shows, its place among the others (up, down, a new one below it),
 * its switch, taking it away, seeing it on the site. Moves, the switch and
 * taking it away are written at once, each with "Annulla"; taking it away
 * asks first.
 */
export function SectionMenu({
  rail,
  keys,
  modifiedGmt,
  powers,
  canPin,
  siteLink,
  onClose,
  onChangeSource,
  onAddBelow,
}: {
  /** The section; null = closed. */
  rail: RailSummary | null;
  /** Every section's key, in page order. */
  keys: readonly string[];
  modifiedGmt: string;
  powers: SectionPowers;
  /** The config lets the owner pin products: "Aggiungi prodotti". */
  canPin: boolean;
  siteLink: string;
  onClose: () => void;
  onChangeSource: (rail: RailSummary) => void;
  onAddBelow: (key: string) => void;
}) {
  const { t } = useI18n();
  const s = t.vetrinaCatalog.sections;
  const router = useRouter();
  const writes = useSectionWrites();
  const [confirming, setConfirming] = React.useState<RailSummary | null>(null);
  // Kept while the sheet slides away, after the screen has let go of it.
  const shown = useLastShown(rail);
  const title = shown ? shown.title.trim() || shown.key : "";
  const index = shown ? keys.indexOf(shown.key) : -1;
  const addable = shown != null && canPin && shown.editable && railSourceOf(shown) != null;

  function moveBy(delta: number) {
    if (!shown) return;
    const next = moveKey(keys, shown.key, delta);
    onClose();
    if (next) void writes.arrange({ keys: next, before: [...keys], expectedModifiedGmt: modifiedGmt });
  }

  return (
    <>
      <Actions opened={rail != null} onBackdropClick={onClose}>
        <ActionsGroup>
          <ActionsLabel>{title}</ActionsLabel>
          {/* A fixed list has nothing to edit there: its card opens nothing either. */}
          {shown?.editable && (
            <ActionsButton
              onClick={() => {
                onClose();
                router.push(sectionHref(shown.key));
              }}
            >
              {s.menu.edit}
            </ActionsButton>
          )}
          {addable && (
            <ActionsButton
              onClick={() => {
                onClose();
                if (shown) router.push(`${sectionHref(shown.key)}?aggiungi=1`);
              }}
            >
              {s.menu.addProducts}
            </ActionsButton>
          )}
          {powers.source && shown && (
            <ActionsButton
              onClick={() => {
                onClose();
                onChangeSource(shown);
              }}
            >
              {s.menu.change}
            </ActionsButton>
          )}
          {powers.move && index > 0 && <ActionsButton onClick={() => moveBy(-1)}>{s.arrange.moveUp}</ActionsButton>}
          {powers.move && index >= 0 && index < keys.length - 1 && (
            <ActionsButton onClick={() => moveBy(1)}>{s.arrange.moveDown}</ActionsButton>
          )}
          {powers.add && shown && (
            <ActionsButton
              onClick={() => {
                onClose();
                onAddBelow(shown.key);
              }}
            >
              {s.menu.addBelow}
            </ActionsButton>
          )}
          {powers.switchOff && shown && (
            <ActionsButton
              onClick={() => {
                onClose();
                void writes.switchSection({
                  key: shown.key,
                  title,
                  on: shown.switchedOff,
                  expectedModifiedGmt: modifiedGmt,
                  expectedAttrsHash: shown.attrsHash,
                });
              }}
            >
              {shown.switchedOff ? s.switch.turnOn : s.switch.turnOff}
            </ActionsButton>
          )}
          {siteLink && (
            <ActionsButton
              onClick={() => {
                onClose();
                window.open(siteLink, "_blank", "noreferrer");
              }}
            >
              {s.menu.viewSite}
            </ActionsButton>
          )}
        </ActionsGroup>
        {powers.remove && shown && railSourceOf(shown) != null && keys.length > 1 && (
          <ActionsGroup>
            <ActionsButton
              colors={{ textIos: "text-red-600 dark:text-red-500", textMaterial: "text-red-600 dark:text-red-400" }}
              onClick={() => {
                onClose();
                setConfirming(shown);
              }}
            >
              {s.remove.open}
            </ActionsButton>
          </ActionsGroup>
        )}
        <ActionsGroup>
          <ActionsButton bold onClick={onClose}>
            {s.menu.cancel}
          </ActionsButton>
        </ActionsGroup>
      </Actions>

      <Dialog
        opened={confirming != null}
        onBackdropClick={() => setConfirming(null)}
        title={s.remove.open}
        content={confirming ? s.remove.confirm(confirming.title.trim() || confirming.key) : ""}
        buttons={
          <>
            <DialogButton onClick={() => setConfirming(null)}>{s.remove.no}</DialogButton>
            <DialogButton
              strong
              className="!text-red-600 dark:!text-red-500"
              onClick={() => {
                const target = confirming;
                setConfirming(null);
                if (target) {
                  void writes.removeSection({
                    key: target.key,
                    title: target.title.trim() || target.key,
                    expectedModifiedGmt: modifiedGmt,
                  });
                }
              }}
            >
              {s.remove.yes}
            </DialogButton>
          </>
        }
      />
    </>
  );
}
