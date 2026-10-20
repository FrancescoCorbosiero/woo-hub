"use client";

import { Button } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { ProductCard } from "@/lib/vetrina/types";
import { EyeOff } from "../icons";
import { Thumb } from "./RailRow";

/** The products hidden from this section — still in its category — each with "Mostra di nuovo". */
export function HiddenProducts({
  ids,
  cards,
  onShow,
}: {
  ids: readonly number[];
  cards: ReadonlyMap<number, ProductCard>;
  /** None: the config does not let the owner show them again from here. */
  onShow: ((id: number) => void) | null;
}) {
  const { t } = useI18n();
  const v = t.vetrina.editor;
  if (ids.length === 0) return null;
  return (
    <>
      <div className="px-5 pb-1.5 pt-6 text-[13px] font-semibold uppercase tracking-wide opacity-50">{v.hiddenTitle}</div>
      <ul className="mx-4 overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-[#1c1c1e]">
        {ids.map((id) => {
          const card = cards.get(id);
          return (
            <li key={id} className="flex items-center gap-3 border-b border-black/5 px-3 py-2.5 last:border-0 dark:border-white/10">
              <Thumb card={card} dim />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[15px] leading-snug opacity-60">{card?.name ?? `#${id}`}</div>
                <div className="mt-0.5 flex items-center gap-1 text-[13px] opacity-50">
                  <EyeOff className="h-3.5 w-3.5" />
                  {v.reasons.excluded}
                </div>
              </div>
              {onShow && (
                <Button small rounded tonal inline onClick={() => onShow(id)}>
                  {v.showAgain}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
