"use client";

import * as React from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { changedFields } from "@/lib/vetrina/fields";
import { countChanges, type StateChanges } from "@/lib/vetrina/order";
import { draftOf } from "@/lib/vetrina/section-editor";
import type { RailDetail, SectionDraft } from "@/lib/vetrina/types";
import { edited } from "../section-reload";

export interface SectionDraftState {
  /** The rail as the server last described it. */
  base: RailDetail;
  setBase: (rail: RailDetail) => void;
  /** The owner's draft over it: nothing reaches the site before "Pubblica". */
  draft: SectionDraft;
  setDraft: (draft: SectionDraft) => void;
  /** The base as a draft: what "unpublished" is measured against. */
  saved: SectionDraft;
  dirty: boolean;
  /** The order's changes, plus the texts and the size: one draft, one publish. */
  changes: StateChanges;
  fieldsChanged: string[];
  resized: boolean;
  /** The draft as it is now, for an answer that arrives after the owner changed it. */
  latestDraft: React.RefObject<SectionDraft>;
  /** A change to the draft, said in a toast with its "Annulla". */
  commit: (next: SectionDraft, message: string) => void;
}

export function useSectionDraft(initial: RailDetail, maxPins: number): SectionDraftState {
  const { t } = useI18n();
  const v = t.vetrina.editor;
  const [base, setBase] = React.useState<RailDetail>(initial);
  const [draft, setDraft] = React.useState<SectionDraft>(() => draftOf(initial));
  const saved = React.useMemo(() => draftOf(base), [base]);
  const fieldsChanged = changedFields(saved.fields, draft.fields);
  const resized = saved.limit !== draft.limit;
  const dirty = edited(saved, draft);
  const orderChanges = countChanges(saved, draft);
  const changes = { ...orderChanges, total: orderChanges.total + fieldsChanged.length + (resized ? 1 : 0) };

  const latestDraft = React.useRef(draft);
  React.useEffect(() => {
    latestDraft.current = draft;
  }, [draft]);

  function commit(next: SectionDraft, message: string) {
    if (next.pin.length > maxPins) {
      toast.error(v.limitReached(maxPins));
      return;
    }
    const before = draft;
    setDraft(next);
    toast.dismiss();
    toast(message, { action: { label: v.undo, onClick: () => setDraft(before) }, duration: 4000 });
  }

  return { base, setBase, draft, setDraft, saved, dirty, changes, fieldsChanged, resized, latestDraft, commit };
}
