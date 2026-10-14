"use client";

import * as React from "react";
import { Button, Range } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { MarginPreview, OperationView, TermMarginState } from "@/lib/vetrina/catalog-ops";
import { MARGIN_PERCENT_MAX, MARGIN_PERCENT_MIN } from "@/lib/vetrina/catalog-ops";
import {
  ActSheetFrame,
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
  type PreviewState,
} from "../act/parts";
import { useRangeThumbFix } from "../act/range-thumb";
import { formatCount } from "../format";
import { Minus, Plus } from "./glyphs";
import {
  backLabel,
  backText,
  clampPercent,
  followedPercent,
  marginInput,
  nowText,
  PRESETS,
  startMode,
  startPercent,
  type MarginMode,
  type MarginTermRef,
} from "./model";

/**
 * "Ricarico": a category's or a brand's margin on the market price — a
 * slider with a point less / more beside it, quick choices, and the live
 * preview (how many products, up / down / the same, the average change,
 * the products it moves most) — then "Applica a N prodotti". When the term
 * has a margin of its own, "Togli il suo ricarico" removes it, the button
 * named for where its products go back to. The action runs
 * in the background through the operations tracker: the pill, then a toast
 * with "Annulla".
 */

export interface MarginSheetProps {
  open: boolean;
  term: MarginTermRef;
  /** The term's margin as its row read it: where the slider starts, what "now" says. */
  state: TermMarginState | null;
  onClose: () => void;
  /** The action started; the sheet has closed itself. */
  onStarted?: (view: OperationView) => void;
}

export function MarginSheet({ open, term, state, onClose, onStarted }: MarginSheetProps) {
  // While the sheet slides away it keeps what it was opened on.
  const shown = useLastShown(open ? state : null);
  return (
    <ActSheetFrame open={open && state != null} onClose={onClose}>
      {shown && <MarginContent term={term} state={shown} onClose={onClose} onStarted={onStarted} />}
    </ActSheetFrame>
  );
}

function MarginContent({
  term,
  state,
  onClose,
  onStarted,
}: {
  term: MarginTermRef;
  state: TermMarginState;
  onClose: () => void;
  onStarted?: (view: OperationView) => void;
}) {
  const { t } = useI18n();
  const m = t.vetrinaCatalog.margins;
  const s = m.sheet;
  const [mode, setMode] = React.useState<MarginMode>(() => startMode(state));
  // The slider's thumb where its value is from the first frame (Konsta's Range needs a nudge).
  useRangeThumbFix(mode);
  const [percent, setPercent] = React.useState(() => startPercent(state));
  const rangeId = React.useId();

  const input = marginInput(term, mode, percent, followedPercent(state));
  // The slider settles before the server prices the term's products.
  const preview = usePreview(input, mode === "set" ? 450 : 0);
  const { run, busy, error } = useStartAction(onClose, onStarted);
  const answered = preview.current ? preview.preview?.margin : undefined;
  const step = (delta: number) => setPercent((p) => clampPercent(p + delta));

  const disabled = !input || !preview.current || (mode === "set" ? !answered?.applies : answered == null);
  const label = mode === "standard" ? backLabel(state, m) : answered?.applies ? s.apply(answered.applies) : s.applyPlain;

  return (
    <>
      <SheetHead title={s.title} subtitle={term.name} onClose={onClose}>
        {state.own && (
          <ModeSwitch
            value={mode}
            onChange={setMode}
            label={s.title}
            options={[
              { value: "set", label: s.modes.set },
              { value: "standard", label: s.modes.standard },
            ]}
          />
        )}
      </SheetHead>

      {/* A slider inside: only the grabber drags the sheet. */}
      <SheetBody disableDrag>
        {mode === "set" ? (
          <section>
            <label htmlFor={rangeId} className={HEADING}>
              {s.percentLabel}
            </label>
            <div className={`${CARD} px-4 pb-2 pt-3`}>
              <div className="flex items-center gap-2">
                <output htmlFor={rangeId} className="min-w-0 flex-1 text-[34px] font-bold leading-none tabular-nums">
                  {s.percent(percent)}
                </output>
                <StepButton label={s.less} disabled={percent <= MARGIN_PERCENT_MIN} onClick={() => step(-1)}>
                  <Minus className="h-5 w-5" />
                </StepButton>
                <StepButton label={s.more} disabled={percent >= MARGIN_PERCENT_MAX} onClick={() => step(1)}>
                  <Plus className="h-5 w-5" />
                </StepButton>
              </div>
              <Range
                inputId={rangeId}
                min={MARGIN_PERCENT_MIN}
                max={MARGIN_PERCENT_MAX}
                step={1}
                value={percent}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPercent(clampPercent(Number(e.target.value)))}
                className="my-3"
              />
              {/* Five equal columns: every choice in sight on the narrowest phone. */}
              <div role="group" aria-label={s.presets} className="grid grid-cols-5 gap-1.5">
                {PRESETS.map((p) => (
                  <ChoiceChip key={p} active={percent === p} onClick={() => setPercent(p)} fill>
                    {s.percent(p)}
                  </ChoiceChip>
                ))}
              </div>
            </div>
            <p className="mt-1.5 px-1 text-[13px] leading-snug opacity-60">{nowText(state, term.taxonomy, m)}</p>
          </section>
        ) : (
          <p className={`${CARD} px-4 py-3 text-[15px] leading-snug`}>{backText(state, m)}</p>
        )}

        {input ? (
          <>
            <Summary state={preview} />
            {/* Summary says how many move: the preview's own headline would say it twice. */}
            <PreviewView state={preview} headline={preview.preview?.margin == null} />
          </>
        ) : (
          <p className={`${CARD} px-4 py-3 text-[15px] leading-snug`}>{s.same}</p>
        )}

        {/* After what moves, not before it: on a small phone the preview starts in sight. */}
        <p className="px-1 text-[13px] leading-snug opacity-60">{s.note}</p>
      </SheetBody>

      <SheetFooter error={error}>
        <PrimaryButton busy={busy} disabled={disabled} onClick={() => input && void run(input)}>
          {label}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}

/** A point less or more: 44px, beside the number, for the step a thumb on the slider cannot hit. */
function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button rounded tonal inline aria-label={label} disabled={disabled} onClick={onClick} className="!h-11 !w-11 shrink-0 !px-0">
      {children}
    </Button>
  );
}

/**
 * How the prices move, above the products: up, down, the same, and the
 * average change — the last answer, dimmed while the next one is read.
 */
function Summary({ state }: { state: PreviewState }) {
  const { t, locale } = useI18n();
  const s = t.vetrinaCatalog.margins.sheet;
  const margin: MarginPreview | undefined = state.preview?.margin;
  if (!margin || state.error) return null;
  const cells: [string, number][] = [
    [s.up, margin.up],
    [s.down, margin.down],
    [s.unchanged, margin.same],
  ];
  return (
    <section aria-busy={state.loading} className={`transition-opacity duration-200 ${state.loading ? "opacity-50" : ""}`}>
      <span className={HEADING}>{s.summary}</span>
      <dl className={`${CARD} grid grid-cols-3 divide-x divide-black/5 dark:divide-white/10`}>
        {cells.map(([label, value]) => (
          <div key={label} className="flex flex-col-reverse items-center px-2 py-3">
            <dt className="mt-1 text-[13px] opacity-60">{label}</dt>
            <dd className="text-[22px] font-bold leading-none tabular-nums">{formatCount(value, locale)}</dd>
          </div>
        ))}
      </dl>
      {margin.averageChange != null && (
        <p className="mt-1.5 px-1 text-[13px] leading-snug tabular-nums opacity-60">{s.average(margin.averageChange)}</p>
      )}
    </section>
  );
}
