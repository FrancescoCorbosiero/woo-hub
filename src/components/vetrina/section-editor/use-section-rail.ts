"use client";

import * as React from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import type { RailCollection } from "@/lib/collections/types";
import { draftOf } from "@/lib/vetrina/section-editor";
import type { HiddenReason } from "@/lib/vetrina/types";
import { loadVetrinaRail } from "@/server/actions/vetrina";
import type { VetrinaRail } from "@/server/vetrina/service";
import { useOperationSettled } from "../catalog/act/operations-context";
import { edited, movedUnderDraft, movesSection } from "../section-reload";
import type { SectionCards } from "./use-section-cards";
import type { SectionDraftState } from "./use-section-draft";

export interface SectionRail {
  /** The site's automatic order for the draft's fallback (the base's own until it is read). */
  siteVisible: number[];
  /** The draft's fallback has no automatic order yet: it is being read. */
  loadingFallback: boolean;
  /** The rule filling the section's category, when it is automatic. */
  collection: RailCollection | null;
  /** Why each hidden pin waits. */
  reasons: ReadonlyMap<number, HiddenReason>;
  /** A rail read again (after a publish, a stale write): it becomes the base. */
  adoptRail: (data: VetrinaRail) => void;
  /** The section's members moved: read it again. */
  reloadMembers: () => Promise<void>;
  /** Actions this editor started itself: their end does not read the section again. */
  ownOps: React.RefObject<Set<string>>;
}

/**
 * What the site says about the section beyond the draft: its automatic order
 * for each fallback (the server computes it once, the phone reuses it), why
 * hidden pins wait, the rule filling its category — read again when
 * something moved the section: its rule, a product's tags, an action.
 */
export function useSectionRail(
  railKey: string,
  initial: VetrinaRail,
  section: SectionDraftState,
  absorb: SectionCards["absorb"],
): SectionRail {
  const { t } = useI18n();
  const v = t.vetrina.editor;
  const { base, setBase, draft, setDraft, saved, latestDraft } = section;

  const [visibleByFallback, setVisibleByFallback] = React.useState<Record<string, number[]>>({
    [initial.rail.previewFallback]: initial.rail.visible,
  });
  const siteVisible = visibleByFallback[draft.fallback] ?? base.visible;
  const loadingFallback = visibleByFallback[draft.fallback] == null;
  const [collection, setCollection] = React.useState<RailCollection | null>(initial.collection);
  const [reasons, setReasons] = React.useState<ReadonlyMap<number, HiddenReason>>(
    () => new Map(initial.rail.hidden.map((h) => [h.id, h.reason])),
  );

  const adoptRail = React.useCallback(
    (data: VetrinaRail) => {
      setBase(data.rail);
      setVisibleByFallback((prev) => ({ ...prev, [data.rail.previewFallback]: data.rail.visible }));
      setReasons(new Map(data.rail.hidden.map((h) => [h.id, h.reason])));
      setCollection(data.collection);
      absorb([...data.rail.items, ...data.rail.hidden], data.locks);
    },
    [absorb, setBase],
  );

  /**
   * The category's members moved (its rule changed, a product's tags did):
   * read the rail again, and every automatic order cached so far is stale.
   * A draft with nothing unpublished becomes the fresh rail; one with the
   * owner's own changes keeps them — they are theirs — and they hear that
   * the section changed under them, to look before publishing.
   */
  const reloadMembers = React.useCallback(async () => {
    // The rail the draft was made over, as it was when asked: what "unedited" is measured against.
    const before = saved;
    const shownBefore = base.visible;
    const fresh = await loadVetrinaRail({ key: railKey, fallback: draft.fallback });
    if (!fresh.ok) {
      toast.error(t.vetrina.errors[fresh.code] ?? fresh.error);
      return;
    }
    setVisibleByFallback({ [fresh.data.rail.previewFallback]: fresh.data.rail.visible });
    adoptRail(fresh.data);
    // The draft as it is now: the owner may have changed it while the rail was read.
    if (!edited(before, latestDraft.current)) setDraft(draftOf(fresh.data.rail));
    // Said only when the section really moved under the draft: its pins, hidden ones, texts, or products.
    else if (movedUnderDraft({ state: before, shown: shownBefore }, { state: draftOf(fresh.data.rail), shown: fresh.data.rail.visible })) {
      toast(v.changedMeanwhile);
    }
  }, [railKey, draft.fallback, saved, base.visible, adoptRail, latestDraft, setDraft, t, v]);

  // Actions this editor started itself (the category its new products join): it reads the section after publishing.
  const ownOps = React.useRef(new Set<string>());
  // An action that ended — from a toast's "Annulla", the log, a product's sheet — may have moved this section:
  // a pin, a product hidden or shown, one put in or out of its category, the shop's positions.
  useOperationSettled((view) => {
    if (ownOps.current.has(view.id)) return;
    if (movesSection(view.kind)) void reloadMembers();
  });

  // A fallback we have no automatic order for yet: ask the site (nothing is saved).
  React.useEffect(() => {
    if (!loadingFallback) return;
    let cancelled = false;
    loadVetrinaRail({ key: railKey, fallback: draft.fallback }).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        toast.error(t.vetrina.errors[res.code] ?? res.error);
        return;
      }
      setVisibleByFallback((prev) => ({ ...prev, [draft.fallback]: res.data.rail.visible }));
      absorb([...res.data.rail.items, ...res.data.rail.hidden], res.data.locks);
    });
    return () => {
      cancelled = true;
    };
  }, [loadingFallback, draft.fallback, railKey, absorb, t]);

  return { siteVisible, loadingFallback, collection, reasons, adoptRail, reloadMembers, ownOps };
}
