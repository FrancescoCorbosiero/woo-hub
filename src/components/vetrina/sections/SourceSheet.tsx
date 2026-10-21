"use client";

import * as React from "react";
import { useI18n } from "@/i18n/provider";
import { fieldProblem } from "@/lib/vetrina/fields";
import type { RailList, RailSource } from "@/lib/vetrina/types";
import { previewVetrinaSource } from "@/server/actions/vetrina";
import type { SourceChange } from "@/server/vetrina/layout";
import { call } from "../catalog/act/call";
import { Warning } from "../catalog/act/icons";
import {
  ActSheetFrame,
  CARD,
  ChoiceChip,
  ChosenCard,
  FailedCard,
  HEADING,
  LoadingRows,
  PrimaryButton,
  SheetBody,
  SheetFooter,
  SheetHead,
  useLastShown,
} from "../catalog/act/parts";
import { Badge, SourcePicker, type PickedSource } from "./SourcePicker";
import { useSectionWrites } from "./use-section-writes";

/**
 * "Cambia cosa mostra": a section pointed at another category, brand or
 * shop-wide list. Picked first; then what changes, said before anything is
 * written — the pinned products the new source holds keep their places, the
 * others go back to being nothing special, where else the homepage shows
 * it, where its button will lead — and its title, kept or taken from the new
 * source's name. One write, straight to the site, with "Annulla".
 */

export interface SourceRequest {
  key: string;
  title: string;
  /** What it shows now. */
  current: RailSource | null;
  expectedModifiedGmt: string;
  expectedAttrsHash: string;
  button: { text: string };
  /** Changes not published yet in the section editor: they are lost. */
  unpublished?: number;
}

export function SourceSheet({
  request,
  lists,
  onClose,
  onChanged,
}: {
  request: SourceRequest | null;
  lists: readonly RailList[];
  onClose: () => void;
  /** Done: the section's key now (the editor goes there). */
  onChanged?: (key: string) => void;
}) {
  const shown = useLastShown(request);
  return (
    <ActSheetFrame open={request != null} onClose={onClose}>
      {shown && <SourceContent key={shown.key} request={shown} lists={lists} onClose={onClose} onChanged={onChanged} />}
    </ActSheetFrame>
  );
}

function SourceContent({
  request,
  lists,
  onClose,
  onChanged,
}: {
  request: SourceRequest;
  lists: readonly RailList[];
  onClose: () => void;
  onChanged?: (key: string) => void;
}) {
  const { t } = useI18n();
  const s = t.vetrinaCatalog.sections;
  const [picked, setPicked] = React.useState<PickedSource | null>(null);
  const [title, setTitle] = React.useState(request.title);
  const [busy, setBusy] = React.useState(false);
  const writes = useSectionWrites();
  const preview = useSourcePreview(picked ? request.key : null, picked?.source ?? null);

  // The site's titles are often in capitals ("SALDI"): a suggestion follows the title's own case.
  const suggestion = picked ? (request.title && request.title === request.title.toUpperCase() ? picked.name.toUpperCase() : picked.name) : "";
  const problem = fieldProblem("golden-hive/shortcode-wrapper", "title", title);

  async function confirm() {
    if (!picked || busy) return;
    setBusy(true);
    const ok = await writes.changeSource({
      key: request.key,
      expectedModifiedGmt: request.expectedModifiedGmt,
      expectedAttrsHash: request.expectedAttrsHash,
      source: picked.source,
      name: picked.name,
      fields: title.trim() !== request.title ? { title: title.trim() } : undefined,
      onKey: onChanged,
    });
    setBusy(false);
    if (ok) onClose();
  }

  if (!picked) {
    return (
      <>
        <SheetHead title={s.change.title} subtitle={request.title} onClose={onClose} />
        <SheetBody footer={false}>
          <SourcePicker
            current={request.current}
            lists={lists}
            onPick={(next) => {
              setPicked(next);
              setTitle(request.title);
            }}
          />
        </SheetBody>
      </>
    );
  }

  const change = preview.data;
  return (
    <>
      <SheetHead title={s.change.title} subtitle={request.title} onClose={onClose} />
      <SheetBody>
        <ChosenCard
          media={<Badge kind={"list" in picked.source ? "list" : picked.source.taxonomy} automatic={picked.automatic} />}
          title={picked.name}
          note={picked.count != null ? s.pick.products(picked.count) : s.pick.lists["list" in picked.source ? picked.source.list : ""]?.hint}
          onChange={() => setPicked(null)}
        />

        {preview.error ? (
          <FailedCard message={s.change.failed} onRetry={preview.retry} />
        ) : !change ? (
          <LoadingRows label={s.change.loading} />
        ) : (
          <ChangeNotes change={change} picked={picked} button={request.button.text} />
        )}

        <label className="block">
          <span className={HEADING}>{s.change.titleField}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            enterKeyHint="done"
            autoComplete="off"
            className={`${CARD} block h-12 w-full px-4 text-[16px] outline-none`}
          />
          {suggestion && suggestion !== title.trim() && (
            <span className="mt-1.5 flex flex-wrap gap-2">
              <ChoiceChip active={false} onClick={() => setTitle(suggestion)}>
                {s.change.suggest(suggestion)}
              </ChoiceChip>
            </span>
          )}
        </label>

        {(request.unpublished ?? 0) > 0 && <Note>{s.change.draftLost(request.unpublished ?? 0)}</Note>}
      </SheetBody>
      <SheetFooter>
        <PrimaryButton busy={busy} disabled={!change || problem != null} onClick={() => void confirm()}>
          {s.change.start(picked.name)}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}

/** What pointing the section there keeps and changes, in a few lines. */
function ChangeNotes({ change, picked, button }: { change: SourceChange; picked: PickedSource; button: string }) {
  const { t } = useI18n();
  const c = t.vetrinaCatalog.sections.change;
  const lines = [
    change.keptPins.length > 0 ? c.keptPins(change.keptPins.length) : "",
    change.droppedPins > 0 ? c.droppedPins(change.droppedPins) : "",
    change.droppedHidden > 0 ? c.droppedHidden(change.droppedHidden) : "",
    change.buttonFollows && button ? c.button(button, picked.name) : "",
  ].filter(Boolean);
  return (
    <div className="space-y-2">
      {change.alsoIn.length > 0 && <Note>{c.alsoIn(change.alsoIn.join(", "))}</Note>}
      {lines.length > 0 && (
        <ul className={`${CARD} divide-y divide-black/5 dark:divide-white/10`}>
          {lines.map((line) => (
            <li key={line} className="px-4 py-2.5 text-[15px] leading-snug">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2.5 rounded-2xl bg-amber-50 px-3.5 py-3 text-[14px] leading-snug text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
      <Warning className="mt-px h-[18px] w-[18px] shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** The server's word on what the change would keep, read again whenever the choice changes. */
function useSourcePreview(key: string | null, source: RailSource | null) {
  const { t } = useI18n();
  const network = t.vetrinaCatalog.act.sheet.network;
  const wanted = key && source ? JSON.stringify([key, source]) : "";
  const [state, setState] = React.useState<{ wanted: string; data: SourceChange | null; error: string | null }>({
    wanted: "",
    data: null,
    error: null,
  });
  const [tries, setTries] = React.useState(0);
  React.useEffect(() => {
    if (!wanted) return;
    let alive = true;
    const [k, src] = JSON.parse(wanted) as [string, RailSource];
    void call(() => previewVetrinaSource({ key: k, source: src }), network).then((res) => {
      if (!alive) return;
      setState(res.ok ? { wanted, data: res.data, error: null } : { wanted, data: null, error: res.error });
    });
    return () => {
      alive = false;
    };
  }, [wanted, tries, network]);
  const current = state.wanted === wanted;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    retry: () => {
      setState((s) => ({ ...s, wanted: "" }));
      setTries((n) => n + 1);
    },
  };
}
