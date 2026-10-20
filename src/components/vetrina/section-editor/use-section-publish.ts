"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { draftOf, joinersOf, type AddedProduct } from "@/lib/vetrina/section-editor";
import { loadVetrinaRail, publishVetrinaRail } from "@/server/actions/vetrina";
import { isActive, outcomeOf, type Outcome } from "../catalog/act/model";
import { useOperations } from "../catalog/act/operations-context";
import type { SectionDraftState } from "./use-section-draft";
import type { SectionRail } from "./use-section-rail";

export interface SectionPublish {
  publish: () => Promise<void>;
  publishing: boolean;
  /** Products added from the catalog are going into the category first. */
  joining: boolean;
  /** The page changed under the draft: publish again over the new version? */
  stale: boolean;
  closeStale: () => void;
}

/**
 * "Pubblica": products added from the catalog that are not in the section's
 * category yet go into it first (one "Categoria +" the activity log keeps,
 * with its "Annulla"), then the draft is written as one block write. A page
 * changed meanwhile is read again, the draft kept, and the owner asked.
 */
export function useSectionPublish({
  railKey,
  section,
  rail,
  added,
  joinTo,
  onJoined,
  onPublished,
  demo,
}: {
  railKey: string;
  section: SectionDraftState;
  rail: Pick<SectionRail, "adoptRail" | "ownOps">;
  /** Products added from the catalog, until published. */
  added: ReadonlyMap<number, AddedProduct>;
  /** The category products added by hand join before publishing; null: none joins. */
  joinTo: number | null;
  /** These are in the category now: a second publish (after a refusal) does not put them in again. */
  onJoined: (ids: number[]) => void;
  /** Published: what was added is the section's own now. */
  onPublished: () => void;
  demo: boolean;
}): SectionPublish {
  const { t } = useI18n();
  const v = t.vetrina.editor;
  const pk = t.vetrinaCatalog.picker;
  const router = useRouter();
  const ops = useOperations();
  const [publishing, setPublishing] = React.useState(false);
  const [joining, setJoining] = React.useState(false);
  const [stale, setStale] = React.useState(false);
  const { base, draft, setDraft } = section;
  const { adoptRail, ownOps } = rail;

  /** Puts the products in the category, as an action; answers how that ended. */
  async function joinCategory(ids: number[], categoryId: number): Promise<Outcome | "refused"> {
    const res = await ops.start({ kind: "categorize", target: { kind: "ids", ids }, categoryId });
    if (!res.ok) {
      toast.error(res.error);
      return "refused";
    }
    const id = res.data.id;
    ownOps.current.add(id);
    if (!isActive(res.data)) return outcomeOf("running", res.data) ?? "done";
    return new Promise((resolve) => {
      const off = ops.subscribe((view, outcome) => {
        if (view.id !== id) return;
        off();
        resolve(outcome);
      });
    });
  }

  async function publish() {
    setPublishing(true);
    try {
      const joiners = joinTo != null ? joinersOf(draft.pin, added, base.visible) : [];
      if (joiners.length > 0 && joinTo != null) {
        setJoining(true);
        const outcome = await joinCategory(joiners, joinTo);
        setJoining(false);
        if (outcome !== "done") {
          if (outcome !== "refused") toast.error(pk.joinFailed);
          return;
        }
        onJoined(joiners);
      }
      const res = await publishVetrinaRail({
        key: railKey,
        expectedModifiedGmt: base.modifiedGmt,
        expectedAttrsHash: base.attrsHash,
        ...draft,
      });
      if (res.ok) {
        const fresh = await loadVetrinaRail({ key: railKey });
        if (fresh.ok) {
          adoptRail(fresh.data);
          setDraft(draftOf(fresh.data.rail));
          onPublished();
        }
        // The homepage the back button returns to is the router's copy from before: read again.
        router.refresh();
        toast.dismiss();
        toast.success(demo ? v.publishedDemo : v.published, {
          action: base.pageLink
            ? { label: t.vetrina.viewSite, onClick: () => window.open(base.pageLink, "_blank", "noreferrer") }
            : undefined,
        });
        return;
      }
      if (res.code === "stale") {
        // Someone changed the page: take the new version, keep the draft.
        const fresh = await loadVetrinaRail({ key: railKey, fallback: draft.fallback });
        if (fresh.ok) adoptRail(fresh.data);
        setStale(true);
        return;
      }
      toast.error(t.vetrina.errors[res.code] ?? res.error);
    } finally {
      setPublishing(false);
      setJoining(false);
    }
  }

  return { publish, publishing, joining, stale, closeStale: () => setStale(false) };
}
