"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/provider";
import type { HomepageSectionOption, OperationInput, OperationTarget } from "@/lib/vetrina/catalog-ops";
import { sectionHref } from "../sheet/links";
import { House } from "../term/glyphs";
import { useHomepageSections } from "./data";
import {
  ActSheetFrame,
  buttonCount,
  ChosenCard,
  FailedCard,
  LoadingRows,
  PickList,
  PickRow,
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
 * "Metti in homepage": the products pinned at the top of a section, in the
 * order given. What fills the section decides what that does — a manual
 * category's section takes the products into the category first; elsewhere
 * only the products the section can show are pinned — and the preview says
 * who gets pinned, who cannot and why. A section none of them can be in (a
 * brand section, for another brand's product) is shown but cannot be
 * picked; nor can the one open in the section editor behind the sheet, whose
 * unpublished order would fight this one: pinned there from the editor.
 */

export type PinSheetProps = ActSheetProps;

export function PinSheet(props: PinSheetProps) {
  const target = useLastShown(props.target);
  return (
    <ActSheetFrame open={props.target != null} onClose={props.onClose}>
      {target && <PinContent {...props} target={target} />}
    </ActSheetFrame>
  );
}

function PinContent({ target, label, onClose, onStarted }: PinSheetProps & { target: OperationTarget }) {
  const { t } = useI18n();
  const p = t.vetrinaCatalog.act.pin;
  const [chosen, setChosen] = React.useState<HomepageSectionOption | null>(null);
  const sections = useHomepageSections(target);
  // Opened from the section editor's product sheet: that section is pinned from the editor itself.
  const pathname = usePathname();
  const why = (section: HomepageSectionOption) =>
    !section.pinnable
      ? p.notPinnable
      : sectionHref(section.key) === pathname
        ? p.editing
        : section.takes === 0
          ? p.takesNone(target.kind === "ids" ? target.ids.length : 2)
          : null;
  const input: OperationInput | null = chosen ? { kind: "pin", target, sectionKey: chosen.key } : null;
  const preview = usePreview(input);
  const { run, busy, error, setError } = useStartAction(onClose, onStarted);
  const count = buttonCount(preview);

  return (
    <>
      <SheetHead title={p.title} subtitle={label} onClose={onClose} />
      {chosen ? (
        <>
          <SheetBody>
            <ChosenCard
              media={<HouseBadge />}
              title={chosen.title}
              note={<FillNote section={chosen} />}
              onChange={() => setChosen(null)}
            />
            <PreviewView state={preview} />
          </SheetBody>
          <SheetFooter error={error}>
            <PrimaryButton
              busy={busy}
              disabled={!input || !preview.current || count === 0}
              onClick={() => input && void run(input)}
            >
              {count ? p.start(chosen.title, count) : p.plain}
            </PrimaryButton>
          </SheetFooter>
        </>
      ) : (
        <SheetBody footer={false}>
          <p className="px-1 text-[14px] leading-snug opacity-60">{p.intro}</p>
          {sections.error != null && !sections.data ? (
            <FailedCard message={p.failed} onRetry={() => void sections.mutate()} />
          ) : !sections.data ? (
            <LoadingRows label={p.loading} />
          ) : sections.data.length === 0 ? (
            <p className="px-1 py-6 text-center text-[15px] opacity-60">{p.empty}</p>
          ) : (
            <PickList label={p.title}>
              {sections.data.map((section) => {
                const no = why(section);
                return (
                  <PickRow
                    key={section.key}
                    disabled={no != null}
                    media={<HouseBadge />}
                    title={section.title}
                    subtitle={<span className="line-clamp-2">{no ?? <FillNote section={section} />}</span>}
                    after={no == null ? <span className="tabular-nums">{p.pinned(section.pinned)}</span> : undefined}
                    onPick={() => {
                      setError(null);
                      setChosen(section);
                    }}
                  />
                );
              })}
            </PickList>
          )}
        </SheetBody>
      )}
    </>
  );
}

/** What pinning there does, from what fills the section. */
function FillNote({ section }: { section: HomepageSectionOption }) {
  const { t } = useI18n();
  const fill = t.vetrinaCatalog.act.pin.fill;
  const name = section.term?.name ?? section.title;
  switch (section.fill) {
    case "category":
      return <>{fill.category(name)}</>;
    case "automatic":
      return <>{fill.automatic(name)}</>;
    case "brand":
      return <>{fill.brand(name)}</>;
    default:
      return <>{fill.other}</>;
  }
}

function HouseBadge() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#d4a017]/15 text-[#8a6b00] dark:text-[#e8c35a]">
      <House className="h-[18px] w-[18px]" />
    </span>
  );
}
