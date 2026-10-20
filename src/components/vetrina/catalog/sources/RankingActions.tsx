"use client";

import * as React from "react";
import { Actions, ActionsButton, ActionsGroup, ActionsLabel } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { SourceRef } from "./OrderSourcesSheet";
import { useOrderSourceNames } from "./use-order-sources";

/**
 * "Disponi come una classifica…": the rankings (order sources) by name, as an
 * action sheet for one category or brand. One tapped opens its preview on
 * that term; "Classifiche…" opens the sheet that lists them and adds one.
 */
export function RankingActions({
  open,
  termName,
  onClose,
  onUse,
  onManage,
}: {
  open: boolean;
  termName: string;
  onClose: () => void;
  onUse: (source: SourceRef) => void;
  onManage: () => void;
}) {
  const { t } = useI18n();
  const src = t.vetrinaCatalog.sources;
  const names = useOrderSourceNames();
  const sources = names.data ?? [];

  return (
    <Actions opened={open} onBackdropClick={onClose}>
      <ActionsGroup>
        <ActionsLabel>{src.rankAs(termName)}</ActionsLabel>
        {sources.length === 0 && names.data && <ActionsLabel>{src.none}</ActionsLabel>}
        {sources.map((source) => (
          <ActionsButton
            key={source.id}
            onClick={() => {
              onClose();
              onUse(source);
            }}
          >
            <span className="truncate px-2">{src.use(source.name)}</span>
          </ActionsButton>
        ))}
        <ActionsButton
          onClick={() => {
            onClose();
            onManage();
          }}
        >
          {src.manage}
        </ActionsButton>
      </ActionsGroup>
      <ActionsGroup>
        <ActionsButton bold onClick={onClose}>
          {t.vetrinaCatalog.term.sort.cancel}
        </ActionsButton>
      </ActionsGroup>
    </Actions>
  );
}
