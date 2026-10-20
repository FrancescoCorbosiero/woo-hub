"use client";

import * as React from "react";
import { useI18n } from "@/i18n/provider";
import { fieldProblem } from "@/lib/vetrina/fields";
import type { RailList } from "@/lib/vetrina/types";
import {
  ActSheetFrame,
  CARD,
  ChoiceChip,
  ChosenCard,
  HEADING,
  PrimaryButton,
  SheetBody,
  SheetFooter,
  SheetHead,
  useLastShown,
} from "../catalog/act/parts";
import { Badge, SourcePicker, type PickedSource } from "./SourcePicker";
import { useSectionWrites } from "./use-section-writes";

/**
 * "Nuova sezione": a product section added to the homepage from the phone.
 * What it shows first — a category, a brand, or a shop-wide list (the
 * newest, the best sellers, what is on sale) — then its title (the name, in
 * the site's capitals), an eyebrow, how many products, and where: at the top
 * of the sections or after one of them. It joins the page beside its
 * neighbour, with its neighbour's layout, at once; "Annulla" takes it away.
 */

export interface NewSectionRequest {
  /** The page's sections, in order: where it can go. */
  sections: { key: string; title: string; limit: number }[];
  /** Placed after this one by default (a card's "Nuova sezione qui sotto"); none: at the top. */
  after: string | null;
  /** The page as the screen read it. */
  modifiedGmt: string;
}

const SIZES = [8, 12, 18, 24];

export function NewSectionSheet({
  request,
  lists,
  onClose,
  onAdded,
}: {
  request: NewSectionRequest | null;
  lists: readonly RailList[];
  onClose: () => void;
  /** Added: its key on the page and how many sections the page had before, for the screen to show it. */
  onAdded?: (key: string, sectionsBefore: number) => void;
}) {
  const shown = useLastShown(request);
  return (
    <ActSheetFrame open={request != null} onClose={onClose}>
      {shown && <NewSectionContent request={shown} lists={lists} onClose={onClose} onAdded={onAdded} />}
    </ActSheetFrame>
  );
}

function NewSectionContent({
  request,
  lists,
  onClose,
  onAdded,
}: {
  request: NewSectionRequest;
  lists: readonly RailList[];
  onClose: () => void;
  onAdded?: (key: string, sectionsBefore: number) => void;
}) {
  const { t } = useI18n();
  const s = t.vetrinaCatalog.sections;
  const writes = useSectionWrites();
  const [picked, setPicked] = React.useState<PickedSource | null>(null);
  const [title, setTitle] = React.useState("");
  const [eyebrow, setEyebrow] = React.useState("");
  // "" = at the top, before every section; else after the section of that key.
  const [after, setAfter] = React.useState<string>(request.after ?? "");
  const neighbour = request.sections.find((section) => section.key === after) ?? request.sections[0];
  const [limit, setLimit] = React.useState<number>(neighbour?.limit ?? 12);
  const [busy, setBusy] = React.useState(false);
  const sizes = SIZES.includes(limit) ? SIZES : [...SIZES, limit].sort((a, b) => a - b);
  const problem = fieldProblem("golden-hive/shortcode-wrapper", "title", title) ?? fieldProblem("golden-hive/shortcode-wrapper", "eyebrow", eyebrow);

  async function add() {
    if (!picked || busy || !request.sections[0]) return;
    setBusy(true);
    const top = after === "";
    const key = await writes.addSection({
      anchorKey: top ? request.sections[0].key : after,
      place: top ? "before" : "after",
      expectedModifiedGmt: request.modifiedGmt,
      source: picked.source,
      fields: { title: title.trim(), eyebrow: eyebrow.trim() },
      limit,
      title: title.trim() || picked.name,
    });
    setBusy(false);
    if (key == null) return;
    onClose();
    onAdded?.(key, request.sections.length);
  }

  if (!picked) {
    return (
      <>
        <SheetHead title={s.add.title} subtitle={s.pick.title} onClose={onClose} />
        <SheetBody footer={false}>
          <SourcePicker
            current={null}
            lists={lists}
            onPick={(next) => {
              setPicked(next);
              setTitle(next.name.toUpperCase());
            }}
          />
        </SheetBody>
      </>
    );
  }

  return (
    <>
      <SheetHead title={s.add.title} onClose={onClose} />
      <SheetBody>
        <ChosenCard
          media={<Badge kind={"list" in picked.source ? "list" : picked.source.taxonomy} automatic={picked.automatic} />}
          title={picked.name}
          note={picked.count != null ? s.pick.products(picked.count) : s.pick.lists["list" in picked.source ? picked.source.list : ""]?.hint}
          onChange={() => setPicked(null)}
        />

        <label className="block">
          <span className={HEADING}>{s.change.titleField}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            enterKeyHint="next"
            autoComplete="off"
            className={`${CARD} block h-12 w-full px-4 text-[16px] outline-none`}
          />
        </label>
        <label className="block">
          <span className={HEADING}>{s.add.eyebrowField}</span>
          <input
            value={eyebrow}
            onChange={(e) => setEyebrow(e.target.value)}
            placeholder={s.add.eyebrowPlaceholder}
            enterKeyHint="done"
            autoComplete="off"
            className={`${CARD} block h-12 w-full px-4 text-[16px] outline-none placeholder:opacity-40`}
          />
        </label>

        <label className="block">
          <span className={HEADING}>{s.add.where}</span>
          {/* The phone's own picker: a list of every place, in reach of a thumb. */}
          <select
            value={after}
            onChange={(e) => setAfter(e.target.value)}
            className={`${CARD} block h-12 w-full appearance-none px-4 text-[16px] outline-none`}
          >
            <option value="">{s.add.whereTop}</option>
            {request.sections.map((section) => (
              <option key={section.key} value={section.key}>
                {s.add.whereAfter(section.title)}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className={HEADING}>{s.add.size}</span>
          <div className="flex flex-wrap gap-2">
            {sizes.map((size) => (
              <ChoiceChip key={size} active={limit === size} onClick={() => setLimit(size)}>
                {size}
              </ChoiceChip>
            ))}
          </div>
        </div>

        <p className="px-1 text-[14px] leading-snug opacity-60">{s.add.hint}</p>
      </SheetBody>
      <SheetFooter>
        <PrimaryButton busy={busy} disabled={problem != null || title.trim() === ""} onClick={() => void add()}>
          {s.add.start}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}
