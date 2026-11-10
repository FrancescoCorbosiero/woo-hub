"use client";

import * as React from "react";
import { Button } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { AUTOMATION_LIMITS } from "@/lib/automation";
import { ActSheetFrame, PrimaryButton, SheetBody, SheetFooter, SheetHead } from "../catalog/act/parts";
import { Plus } from "../catalog/act/icons";

/**
 * "Aggiornamento completo": the times of day the full update runs, each in
 * the phone's own time picker; more than one, and one at least. Saved
 * together, in order.
 */
export function TimesSheet({
  open,
  times,
  onClose,
  onSave,
}: {
  open: boolean;
  times: string[];
  onClose: () => void;
  /** True once saved: the sheet closes. */
  onSave: (times: string[]) => Promise<boolean>;
}) {
  return (
    <ActSheetFrame open={open} onClose={onClose} detent="content">
      {open && <TimesContent times={times} onClose={onClose} onSave={onSave} />}
    </ActSheetFrame>
  );
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function TimesContent({
  times,
  onClose,
  onSave,
}: {
  times: string[];
  onClose: () => void;
  onSave: (times: string[]) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const w = t.vetrinaCatalog.shop.settings;
  const [draft, setDraft] = React.useState<string[]>(times);
  const [busy, setBusy] = React.useState(false);
  const valid = draft.length > 0 && draft.every((time) => TIME.test(time));
  const same = [...new Set(draft)].sort().join(",") === [...times].sort().join(",");

  async function save() {
    setBusy(true);
    const done = await onSave([...new Set(draft)].sort());
    setBusy(false);
    if (done) onClose();
  }

  return (
    <>
      <SheetHead title={w.timesTitle} subtitle={w.timesIntro} onClose={onClose} />
      <SheetBody>
        <div className="space-y-2">
          {draft.map((time, i) => (
            <div key={i} className="flex items-center gap-2">
              <label className="flex flex-1 items-center justify-between gap-3 rounded-xl bg-white px-4 py-2.5 dark:bg-[#2c2c2e]">
                <span className="text-[15px] opacity-60">{w.time(i)}</span>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setDraft((d) => d.map((v, j) => (j === i ? e.target.value : v)))}
                  className="bg-transparent text-[17px] tabular-nums outline-none"
                  required
                />
              </label>
              {draft.length > 1 && (
                <button
                  type="button"
                  aria-label={w.removeTime}
                  onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-red-600 active:bg-black/5 dark:text-red-400 dark:active:bg-white/10"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M8 12h8" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
        {draft.length < AUTOMATION_LIMITS.dailyTimes.max && (
          <Button rounded tonal onClick={() => setDraft((d) => [...d, "12:00"])} className="!h-11 w-full gap-1.5">
            <Plus className="h-4 w-4" />
            {w.addTime}
          </Button>
        )}
        {!valid && <p className="px-1 text-[14px] leading-snug text-red-600 dark:text-red-400">{w.invalidTimes}</p>}
      </SheetBody>
      <SheetFooter>
        <PrimaryButton onClick={() => void save()} busy={busy} disabled={!valid || same}>
          {w.save}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}
