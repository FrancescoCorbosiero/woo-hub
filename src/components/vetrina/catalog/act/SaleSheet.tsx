"use client";

import * as React from "react";
import { Range } from "konsta/react";
import { useRangeThumbFix } from "./range-thumb";
import { useI18n } from "@/i18n/provider";
import type { OperationInput, OperationTarget, SaleRounding, TermKey } from "@/lib/vetrina/catalog-ops";
import { endChoiceFor, endsOnFor, formatDay, isoDay, saleChange, type EndChoice } from "./model";
import {
  ActSheetFrame,
  buttonCount,
  CARD,
  ChoiceChip,
  HEADING,
  ModeSwitch,
  PreviewView,
  PrimaryButton,
  SheetBody,
  SheetFooter,
  SheetHead,
  useLastShown,
  usePreview,
  useStartAction,
  type ActSheetProps,
} from "./parts";

/**
 * "Saldo": a percentage off the regular price, rounded down (to ,99 from
 * 10 € up, or to the cent), with an end date only when the owner picks one —
 * or "Togli il saldo". It writes sale prices only; the regular price stays
 * the Hub's. The preview names the products, price before → after.
 */

export type SaleMode = "sale" | "unsale";

export interface SaleSheetProps extends ActSheetProps {
  /** A whole category's or brand's sale (its screen's panel): filed under it, so the screen shows it, and "Togli il saldo" there ends it. */
  termKey?: TermKey;
  /** The mode it opens in; the owner can switch. Default "sale". */
  mode?: SaleMode;
  /** The percent it opens on (a term's running sale, to change it). Default 20. */
  percent?: number;
  /** The last day it opens on (a term's running sale, to change it): a change keeps it unless the owner picks another. Default none. */
  endsOn?: string | null;
  /** The rounding it opens on (a term's running sale). Default "charm". */
  rounding?: SaleRounding;
  /** It changes the term's running sale (percent, endsOn and rounding are that sale's): a change of its last day alone is worded so. */
  change?: boolean;
}

const PRESETS = [10, 20, 30, 40, 50] as const;
// The date, at the end of its row as iOS Settings puts a value; the phone's dark date picker in dark mode.
/** Room for a whole date at 16px ("31/10/2026" and the picker's mark) on a 320px phone, beside its short label. */
const DATE_FIELD =
  "h-11 min-w-[9.5rem] flex-1 appearance-none bg-transparent pe-3 text-end text-[16px] outline-none focus-visible:!outline-none dark:[color-scheme:dark] [&::-webkit-date-and-time-value]:text-end";
const MIN = 5;
const MAX = 90;
const STEP = 5;
const ENDS: readonly EndChoice[] = ["none", "sunday", "week", "pick"];

/** The slider's own steps: a running sale of 33% opens on 35%. */
const onStep = (percent: number) => Math.min(MAX, Math.max(MIN, Math.round(percent / STEP) * STEP));

export function SaleSheet(props: SaleSheetProps) {
  const target = useLastShown(props.target);
  return (
    <ActSheetFrame open={props.target != null} onClose={props.onClose}>
      {target && <SaleContent {...props} target={target} />}
    </ActSheetFrame>
  );
}

function SaleContent({
  target,
  label,
  onClose,
  onStarted,
  termKey,
  mode: startMode = "sale",
  percent: startPercent = 20,
  endsOn: startEndsOn = null,
  rounding: startRounding = "charm",
  change = false,
}: SaleSheetProps & { target: OperationTarget }) {
  const { t, locale } = useI18n();
  const s = t.vetrinaCatalog.act.sale;
  const [mode, setMode] = React.useState<SaleMode>(startMode);
  const [percent, setPercent] = React.useState(() => onStep(startPercent));
  const [rounding, setRounding] = React.useState<SaleRounding>(startRounding);
  // The phone's today, once: a sheet left open past midnight keeps its choices.
  const [today] = React.useState(() => isoDay(new Date()));
  // A running sale's last day stays its last day: the change starts from it, as the chip that gives it or as a day picked.
  const [end, setEnd] = React.useState<EndChoice>(() => endChoiceFor(startEndsOn, today).choice);
  const [picked, setPicked] = React.useState(() => endChoiceFor(startEndsOn, today).picked);
  const rangeId = React.useId();
  const dateId = React.useId();
  // The slider's thumb where its value is from the first frame (Konsta's Range needs a nudge).
  useRangeThumbFix(mode);

  const endsOn = endsOnFor(end, today, picked || null);
  const filed = termKey ? { termKey } : {};
  const input: OperationInput | null =
    mode === "unsale"
      ? { kind: "unsale", target, ...filed }
      : end === "pick" && endsOn == null
        ? null
        : { kind: "sale", target, percent, rounding, endsOn, ...filed };
  // The slider settles before the server reads prices live.
  const preview = usePreview(input, mode === "sale" ? 450 : 0);
  const { run, busy, error } = useStartAction(onClose, onStarted);
  const count = buttonCount(preview);
  // Only the last day moves: the button says so, as the action's label and its undo will.
  const endChange =
    input?.kind === "sale"
      ? saleChange(change ? { percent: startPercent, rounding: startRounding, endsOn: startEndsOn } : null, input)
      : null;

  const endText =
    end === "none"
      ? s.endsNever
      : endsOn == null
        ? picked && picked < today
          ? s.pickPast
          : s.pickFirst
        : endsOn === today
          ? s.endsToday
          : s.endsOn(formatDay(endsOn, locale));

  return (
    <>
      <SheetHead title={s.title} subtitle={label} onClose={onClose}>
        <ModeSwitch
          value={mode}
          onChange={setMode}
          label={s.title}
          options={[
            { value: "sale", label: s.modes.sale },
            { value: "unsale", label: s.modes.unsale },
          ]}
        />
      </SheetHead>

      {/* A slider inside: only the grabber drags the sheet. */}
      <SheetBody disableDrag>
        {mode === "sale" ? (
          <>
            <section>
              <label htmlFor={rangeId} className={HEADING}>
                {s.percentLabel}
              </label>
              <div className={`${CARD} px-4 pb-2 pt-4`}>
                <output htmlFor={rangeId} className="block text-[34px] font-bold leading-none tabular-nums">
                  {s.percent(percent)}
                </output>
                <Range
                  inputId={rangeId}
                  min={MIN}
                  max={MAX}
                  step={STEP}
                  value={percent}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPercent(onStep(Number(e.target.value)))}
                  className="my-3"
                />
                {/* Five equal columns: every preset in sight on the narrowest phone, none behind an edge. */}
                <div role="group" aria-label={s.presets} className="grid grid-cols-5 gap-1.5">
                  {PRESETS.map((p) => (
                    <ChoiceChip key={p} active={percent === p} onClick={() => setPercent(p)} fill>
                      {s.percent(p)}
                    </ChoiceChip>
                  ))}
                </div>
              </div>
            </section>

            <section>
              <span className={HEADING}>{s.rounding}</span>
              <ModeSwitch
                value={rounding}
                onChange={setRounding}
                label={s.rounding}
                className=""
                options={[
                  { value: "charm", label: s.roundings.charm },
                  { value: "exact", label: s.roundings.exact },
                ]}
              />
              <p className="mt-1.5 px-1 text-[13px] leading-snug opacity-60">{s.roundingHint[rounding]}</p>
            </section>

            <section>
              <span className={HEADING}>{s.end}</span>
              {/* One row on any phone, down to 320px: four columns, short words, a touch smaller than a chip's own. */}
              <div role="group" aria-label={s.end} className="grid grid-cols-4 gap-1.5">
                {ENDS.map((choice) => (
                  <ChoiceChip key={choice} active={end === choice} onClick={() => setEnd(choice)} fill>
                    {s.ends[choice]}
                  </ChoiceChip>
                ))}
              </div>
              {end === "pick" && (
                <label htmlFor={dateId} className="mt-2 flex min-h-11 items-center gap-3 rounded-xl bg-white ps-3 dark:bg-[#2c2c2e]">
                  {/* Said beside the field: an empty date field on an iPhone shows nothing at all. */}
                  <span className="min-w-0 truncate text-[15px] opacity-60">{s.pickLabel}</span>
                  <input
                    id={dateId}
                    type="date"
                    min={today}
                    value={picked}
                    onChange={(e) => setPicked(e.target.value)}
                    className={DATE_FIELD}
                  />
                </label>
              )}
              <p className="mt-1.5 px-1 text-[13px] leading-snug opacity-60">{endText}</p>
            </section>

            <p className="px-1 text-[13px] leading-snug opacity-60">{s.regularNote}</p>
          </>
        ) : (
          <p className={`${CARD} px-4 py-3 text-[15px] leading-snug`}>{s.unsaleHint}</p>
        )}

        {input && <PreviewView state={preview} />}
      </SheetBody>

      <SheetFooter error={error}>
        <PrimaryButton busy={busy} disabled={!input || !preview.current || count === 0} onClick={() => input && void run(input)}>
          {mode === "unsale"
            ? count
              ? s.stop(count)
              : s.stopPlain
            : endChange && endChange !== "discount"
              ? s.endChange[endChange]
              : count
                ? s.start(count)
                : s.startPlain}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}
