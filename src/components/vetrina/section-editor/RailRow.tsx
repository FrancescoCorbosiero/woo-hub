"use client";

import { Reorder, useDragControls } from "motion/react";
import { useI18n } from "@/i18n/provider";
import type { EditorRow } from "@/lib/vetrina/order";
import type { HiddenReason, ProductCard } from "@/lib/vetrina/types";
import { formatFromPrice } from "../format";
import { Grip, Lock, More, Pin } from "../icons";

/** A product's thumbnail in the shop's own size, faded for one the site does not show. */
export function Thumb({ card, dim }: { card?: ProductCard; dim?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the shop's own thumbnail sizes
    <img
      src={card?.image || undefined}
      alt=""
      loading="lazy"
      draggable={false}
      className={`h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-black/[0.04] object-contain text-[0px] dark:bg-white/10 ${dim ? "opacity-50" : ""}`}
    />
  );
}

/** One product of the section: its place, its states, its "⋯", and the grip that drags it. */
export function RailRow({
  id,
  card,
  kind,
  position,
  reason,
  added,
  locked,
  fold,
  draggable,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  id: number;
  card?: ProductCard;
  kind: EditorRow["kind"];
  position: number | null;
  reason?: HiddenReason;
  /** Added from the catalog, not published yet; a name: it joins that category when published. */
  added: boolean | string;
  locked: boolean;
  fold: string | null;
  draggable: boolean;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onOpen: (id: number) => void;
}) {
  const { t, locale } = useI18n();
  const v = t.vetrina.editor;
  const controls = useDragControls();
  const ghost = kind === "ghost";

  return (
    <Reorder.Item
      as="li"
      value={id}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => onDragStart(id)}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.02, boxShadow: "0 12px 32px -12px rgba(0,0,0,0.35)" }}
      className="relative select-none border-b border-black/5 bg-white last:border-0 dark:border-white/10 dark:bg-[#1c1c1e]"
    >
      <div className="flex items-center gap-3 py-2 pl-3 pr-1">
        <span className="w-6 shrink-0 text-right text-[13px] font-medium tabular-nums opacity-50">
          {position ?? "–"}
        </span>
        <button
          type="button"
          onClick={() => onOpen(id)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-60"
        >
          <Thumb card={card} dim={ghost} />
          <span className="min-w-0 flex-1">
            <span className={`line-clamp-2 text-[15px] font-medium leading-snug ${ghost ? "opacity-50" : ""}`}>
              {card?.name ?? "…"}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
              {card && <span className="tabular-nums opacity-60">{formatFromPrice(card, v.from, locale)}</span>}
              {added && (
                <span className="rounded-md bg-[#d4a017]/15 px-1.5 text-[11px] font-semibold leading-5 text-[#8a6b00] dark:text-[#e8c35a]">
                  {t.vetrinaCatalog.picker.newBadge}
                </span>
              )}
              {kind !== "auto" && (
                <span className="inline-flex items-center gap-0.5 font-semibold text-amber-700 dark:text-amber-400">
                  <Pin className="h-3 w-3" />
                  {v.pinned}
                </span>
              )}
              {locked && <Lock className="h-3.5 w-3.5 opacity-60" />}
            </span>
            {typeof added === "string" && !ghost && (
              <span className="mt-0.5 block text-[13px] leading-snug text-[#8a6b00] dark:text-[#e8c35a]">
                {t.vetrinaCatalog.picker.willJoin(added)}
              </span>
            )}
            {ghost && (
              <span className="mt-0.5 block text-[13px] text-orange-600 dark:text-orange-400">
                {v.reasons[reason ?? "unknown"] ?? v.reasons.unknown}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          aria-label={v.rowMenu}
          onClick={() => onOpen(id)}
          className="grid h-11 w-9 shrink-0 place-items-center opacity-40 active:opacity-20"
        >
          <More className="h-5 w-5" />
        </button>
        {draggable && (
          <div
            role="button"
            aria-label={v.dragHandle}
            onPointerDown={(e) => {
              e.preventDefault();
              controls.start(e);
            }}
            style={{ touchAction: "none" }}
            className="grid h-12 w-10 shrink-0 cursor-grab place-items-center opacity-35 active:cursor-grabbing"
          >
            <Grip className="h-5 w-5" />
          </div>
        )}
      </div>
      {fold && (
        <div className="flex items-center gap-2 px-4 pb-2 pt-1 text-[12px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
          <span className="h-px flex-1 bg-current opacity-40" />
          {fold}
          <span className="h-px flex-1 bg-current opacity-40" />
        </div>
      )}
    </Reorder.Item>
  );
}
