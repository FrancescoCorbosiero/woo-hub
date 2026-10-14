"use client";

import * as React from "react";
import { useI18n } from "@/i18n/provider";
import type { OperationInput, OperationTarget, TermKey } from "@/lib/vetrina/catalog-ops";
import {
  ActSheetFrame,
  buttonCount,
  CARD,
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
 * "Nascondi" or "Mostra", confirmed with the preview: the products named,
 * the other categories and brands they disappear from, the homepage
 * sections that lose them. A hidden product's link keeps working.
 */

export type VisibilityMode = "hide" | "show";

export interface VisibilitySheetProps extends ActSheetProps {
  mode: VisibilityMode;
  /** The owner may switch between Nascondi and Mostra (a selection); a term panel's hide is only that. Default true. */
  switchable?: boolean;
  /**
   * A whole category's or brand's hide (its screen's panel): filed under it,
   * so the screen shows it hidden and "Mostra" there undoes exactly it. Only
   * for "hide": a term is shown again by undoing its hide.
   */
  termKey?: TermKey;
  /** Only for "show": leave hidden what another whole category's or brand's hide holds (a term panel's "Mostra i N nascosti"). */
  keepHeld?: boolean;
}

export function VisibilitySheet(props: VisibilitySheetProps) {
  const target = useLastShown(props.target);
  return (
    <ActSheetFrame open={props.target != null} onClose={props.onClose} detent="content">
      {target && <VisibilityContent {...props} target={target} />}
    </ActSheetFrame>
  );
}

function VisibilityContent({
  target,
  label,
  onClose,
  onStarted,
  mode: startMode,
  switchable = true,
  termKey,
  keepHeld = false,
}: VisibilitySheetProps & { target: OperationTarget }) {
  const { t } = useI18n();
  const v = t.vetrinaCatalog.act.visibility;
  const [mode, setMode] = React.useState<VisibilityMode>(startMode);
  const input: OperationInput =
    mode === "hide"
      ? { kind: "hide", target, ...(termKey ? { termKey } : {}) }
      : { kind: "show", target, ...(keepHeld ? { keepHeld } : {}) };
  const preview = usePreview(input);
  const { run, busy, error } = useStartAction(onClose, onStarted);
  const count = buttonCount(preview);

  return (
    <>
      <SheetHead title={v.title[mode]} subtitle={label} onClose={onClose}>
        {switchable && (
          <ModeSwitch
            value={mode}
            onChange={setMode}
            label={v.title[mode]}
            options={[
              { value: "hide", label: v.plain.hide },
              { value: "show", label: v.plain.show },
            ]}
          />
        )}
      </SheetHead>
      <SheetBody>
        {/* One product says "it"; a list, or a query of any size, says "they". */}
        <p className={`${CARD} px-4 py-3 text-[15px] leading-snug`}>
          {v.hint[mode](target.kind === "ids" ? target.ids.length : 2)}
        </p>
        <PreviewView state={preview} />
      </SheetBody>
      <SheetFooter error={error}>
        <PrimaryButton
          busy={busy}
          danger={mode === "hide"}
          disabled={!preview.current || count === 0}
          onClick={() => void run(input)}
        >
          {count ? v.start[mode](count) : v.plain[mode]}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}
