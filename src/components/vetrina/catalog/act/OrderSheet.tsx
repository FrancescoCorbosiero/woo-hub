"use client";

import * as React from "react";
import { useI18n } from "@/i18n/provider";
import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import type { OperationInput, OperationTarget } from "@/lib/vetrina/catalog-ops";
import {
  ActSheetFrame,
  buttonCount,
  CARD,
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
 * "Ordina": the chosen products, in the list's order, at the top, at a
 * position or at the bottom of a category's or brand's own order — the one
 * its page on the shop follows. Confirmed with the preview: the products
 * moved (#12 → #1), and what to know (they move in their other categories
 * too, a homepage section's pins come first, the shop's pages sort another
 * way).
 */

/** The category or brand whose order it is. */
export interface OrderTerm {
  taxonomy: CatalogTaxonomy;
  id: number;
  name: string;
  /** Its products, sub-terms' included: the last position. */
  count: number;
}

type Place = "top" | "position" | "bottom";

export interface OrderSheetProps extends ActSheetProps {
  term: OrderTerm | null;
}

export function OrderSheet(props: OrderSheetProps) {
  const target = useLastShown(props.target);
  const term = useLastShown(props.term);
  return (
    <ActSheetFrame open={props.target != null} onClose={props.onClose} detent="content">
      {target && term && <OrderContent {...props} target={target} term={term} />}
    </ActSheetFrame>
  );
}

function OrderContent({
  target,
  term,
  label,
  onClose,
  onStarted,
}: OrderSheetProps & { target: OperationTarget; term: OrderTerm }) {
  const { t } = useI18n();
  const o = t.vetrinaCatalog.act.order;
  const [place, setPlace] = React.useState<Place>("top");
  const [text, setText] = React.useState("1");
  const typed = Number.parseInt(text, 10);
  const valid = Number.isFinite(typed) && typed >= 1;
  const position = place === "top" ? 1 : place === "bottom" ? null : valid ? Math.min(typed, Math.max(1, term.count)) : null;
  const input: OperationInput | null =
    place === "position" && !valid ? null : { kind: "order", target, term: { taxonomy: term.taxonomy, id: term.id }, position };
  // The position is typed: asked once the typing pauses.
  const preview = usePreview(input, place === "position" ? 400 : 0);
  const { run, busy, error } = useStartAction(onClose, onStarted);
  const count = buttonCount(preview);

  return (
    <>
      <SheetHead title={o.title(term.name)} subtitle={label} onClose={onClose}>
        <ModeSwitch
          value={place}
          onChange={setPlace}
          label={o.title(term.name)}
          options={[
            { value: "top", label: o.modes.top },
            { value: "position", label: o.modes.position },
            { value: "bottom", label: o.modes.bottom },
          ]}
        />
      </SheetHead>
      <SheetBody>
        <p className={`${CARD} px-4 py-3 text-[15px] leading-snug`}>{o.intro}</p>
        {place === "position" && (
          <label className="block">
            <span className={HEADING}>{o.positionLabel}</span>
            <span className={`${CARD} flex items-center gap-3 px-4`}>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={text}
                onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 7))}
                className="h-12 min-w-0 flex-1 border-0 bg-transparent p-0 text-[17px] tabular-nums shadow-none outline-none ring-0 focus:ring-0"
              />
              <span className="shrink-0 text-[14px] opacity-55">{o.positionHint(term.count)}</span>
            </span>
          </label>
        )}
        {input && <PreviewView state={preview} />}
      </SheetBody>
      <SheetFooter error={error}>
        <PrimaryButton busy={busy} disabled={!input || !preview.current || !count} onClick={() => input && void run(input)}>
          {count ? o.start(count) : o.plain}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}
