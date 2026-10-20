"use client";

import * as React from "react";
import { Reorder, useDragControls } from "motion/react";
import { useI18n } from "@/i18n/provider";
import { moveKey } from "@/lib/vetrina/sections";
import { ChevronLeft, Grip } from "../icons";
import { ActSheetFrame, CARD, PrimaryButton, SheetBody, SheetFooter, SheetHead, useLastShown } from "../catalog/act/parts";
import { useSectionWrites } from "./use-section-writes";

/**
 * "Sposta le sezioni": the homepage's product sections in a list, dragged
 * by their handle or moved one place with the arrows (every drag has a
 * button twin), then saved as one write. Each section's place on the page
 * stays where it is and takes the section that goes there now: banners,
 * sliders and logos never move. "Annulla" in the toast puts them back.
 */

export interface ArrangeSection {
  key: string;
  title: string;
  eyebrow: string;
  switchedOff: boolean;
  /** The first products' thumbnails, to tell sections apart at a glance. */
  thumbs: string[];
}

export interface ArrangeRequest {
  sections: ArrangeSection[];
  modifiedGmt: string;
}

export function ArrangeSheet({ request, onClose }: { request: ArrangeRequest | null; onClose: () => void }) {
  const shown = useLastShown(request);
  return (
    <ActSheetFrame open={request != null} onClose={onClose}>
      {shown && <ArrangeContent request={shown} onClose={onClose} />}
    </ActSheetFrame>
  );
}

function ArrangeContent({ request, onClose }: { request: ArrangeRequest; onClose: () => void }) {
  const { t } = useI18n();
  const a = t.vetrinaCatalog.sections.arrange;
  const writes = useSectionWrites();
  const before = React.useMemo(() => request.sections.map((section) => section.key), [request.sections]);
  const byKey = React.useMemo(() => new Map(request.sections.map((section) => [section.key, section])), [request.sections]);
  const [order, setOrder] = React.useState<string[]>(before);
  const [busy, setBusy] = React.useState(false);
  const changed = order.some((key, i) => key !== before[i]);

  function move(key: string, delta: number) {
    const next = moveKey(order, key, delta);
    if (next) setOrder(next);
  }

  async function save() {
    if (!changed || busy) return;
    setBusy(true);
    const ok = await writes.arrange({ keys: order, before, expectedModifiedGmt: request.modifiedGmt });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <>
      <SheetHead title={a.title} subtitle={a.intro} onClose={onClose} />
      {/* The rows are dragged by their handle: the sheet does not follow the finger. */}
      <SheetBody disableDrag>
        <Reorder.Group
          as="ul"
          axis="y"
          values={order}
          onReorder={setOrder}
          className={`${CARD} overflow-hidden`}
        >
          {order.map((key, i) => {
            const section = byKey.get(key);
            if (!section) return null;
            return (
              <SectionRow
                key={key}
                section={section}
                first={i === 0}
                last={i === order.length - 1}
                onUp={() => move(key, -1)}
                onDown={() => move(key, 1)}
              />
            );
          })}
        </Reorder.Group>
      </SheetBody>
      <SheetFooter>
        <PrimaryButton busy={busy} disabled={!changed} onClick={() => void save()}>
          {changed ? a.save : a.nothing}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}

function SectionRow({
  section,
  first,
  last,
  onUp,
  onDown,
}: {
  section: ArrangeSection;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  const { t } = useI18n();
  const a = t.vetrinaCatalog.sections.arrange;
  const controls = useDragControls();
  const arrow = "grid h-11 w-9 shrink-0 place-items-center transition-opacity active:opacity-30 disabled:opacity-15";
  return (
    <Reorder.Item
      as="li"
      value={section.key}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, boxShadow: "0 12px 32px -12px rgba(0,0,0,0.35)" }}
      className="relative flex select-none items-center gap-2 border-b border-black/5 bg-white py-2 pe-1 ps-3 last:border-0 dark:border-white/10 dark:bg-[#2c2c2e]"
    >
      <div className={`flex min-w-0 flex-1 items-center gap-3 ${section.switchedOff ? "opacity-50" : ""}`}>
        <div className="flex shrink-0 -space-x-5">
          {section.thumbs.slice(0, 2).map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- the shop's own thumbnail sizes
            <img
              key={`${src}-${i}`}
              src={src}
              alt=""
              loading="lazy"
              draggable={false}
              className="h-10 w-10 rounded-lg border-2 border-white bg-black/[0.04] object-contain dark:border-[#2c2c2e] dark:bg-white/10"
            />
          ))}
        </div>
        <span className="min-w-0 flex-1">
          {section.eyebrow && <span className="block truncate text-[11px] font-semibold uppercase tracking-wide opacity-50">{section.eyebrow}</span>}
          <span className="line-clamp-2 block break-words text-[15px] font-semibold leading-snug">
            {section.title}
            {section.switchedOff && <span className="ms-1.5 text-[12px] font-medium opacity-70">· {a.off}</span>}
          </span>
        </span>
      </div>
      <button type="button" onClick={onUp} disabled={first} aria-label={a.up(section.title)} className={arrow}>
        <ChevronLeft className="h-5 w-5 rotate-90" />
      </button>
      <button type="button" onClick={onDown} disabled={last} aria-label={a.down(section.title)} className={arrow}>
        <ChevronLeft className="h-5 w-5 -rotate-90" />
      </button>
      <div
        role="button"
        aria-label={t.vetrina.editor.dragHandle}
        onPointerDown={(e) => {
          e.preventDefault();
          controls.start(e);
        }}
        style={{ touchAction: "none" }}
        className="grid h-12 w-10 shrink-0 cursor-grab place-items-center opacity-35 active:cursor-grabbing"
      >
        <Grip className="h-5 w-5" />
      </div>
    </Reorder.Item>
  );
}
