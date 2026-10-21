"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import type { OperationView } from "@/lib/vetrina/catalog-ops";
import type { FieldValues, RailSource } from "@/lib/vetrina/types";
import {
  addVetrinaSection,
  arrangeVetrinaSections,
  changeVetrinaSource,
  moveVetrinaSection,
  removeVetrinaSection,
  switchVetrinaSection,
} from "@/server/actions/vetrina";
import { undoOperation } from "@/server/actions/vetrina-operations";
import type { AddSectionInput } from "@/server/vetrina/layout";
import type { VetrinaResult } from "@/server/vetrina/service";
import { call } from "../catalog/act/call";

/**
 * Every write to the homepage's sections, as the screens make them: the
 * server's answer — the page read again with it (server/actions/vetrina.ts)
 * — and a toast saying what happened. Each write is an action in the
 * Vetrina's log (server/vetrina/operations/page.ts): the toast's "Annulla"
 * is the log's, run on the server — the same one "Attività" offers later. A
 * refusal is toasted in the owner's words; a page that changed meanwhile is
 * read again.
 */

/** Refusals the server words for the owner (a duplicate section, the last one): shown as they are. */
const OWN_WORDS = new Set(["invalid", "not_found"]);

export function useSectionWrites() {
  const { t } = useI18n();
  const s = t.vetrinaCatalog.sections;
  const network = t.vetrinaCatalog.act.sheet.network;
  const router = useRouter();

  /**
   * A refusal, said — our own refusals in their words ("È l'ultima sezione…"),
   * anything else in the Vetrina's — and a page that changed meanwhile, read
   * again. True when it went through.
   */
  const said = React.useCallback(
    <T,>(res: VetrinaResult<T>): res is { ok: true; data: T } => {
      if (res.ok) return true;
      toast.error(OWN_WORDS.has(res.code) ? res.error : (t.vetrina.errors[res.code] ?? res.error));
      if (res.code === "stale") router.refresh();
      return false;
    },
    [t, router],
  );

  /**
   * The toast saying it is done, with the log's "Annulla" when the log filed
   * it. The undo runs on the server, which answers with the page read again;
   * `after` takes the section's key once undone and goes there. A refused
   * undo says why in the server's words (the section changed since, and
   * how), and the page is read again.
   */
  const offerUndo = React.useCallback(
    (message: string, operation: OperationView | null, undone: string, after?: (key: string | null) => void) => {
      toast.dismiss();
      if (!operation?.undoable) {
        toast.success(message);
        return;
      }
      toast.success(message, {
        duration: 10_000,
        action: {
          label: s.undo,
          onClick: () => {
            void call(() => undoOperation({ id: operation.id }), network).then((res) => {
              if (!res.ok) {
                toast.error(res.error);
                router.refresh();
                return;
              }
              toast.success(undone);
              after?.(res.data.sectionKey ?? null);
            });
          },
        },
      });
    },
    [s, network, router],
  );

  /** Point a section at something else; `onKey` hears its new key (the editor goes there). */
  const changeSource = React.useCallback(
    async (input: {
      key: string;
      expectedModifiedGmt: string;
      expectedAttrsHash: string;
      source: RailSource;
      /** The new source's name, for the toast. */
      name: string;
      fields?: FieldValues;
      onKey?: (key: string) => void;
    }): Promise<boolean> => {
      const res = await call(
        () =>
          changeVetrinaSource({
            key: input.key,
            expectedModifiedGmt: input.expectedModifiedGmt,
            expectedAttrsHash: input.expectedAttrsHash,
            source: input.source,
            fields: input.fields,
          }),
        network,
      );
      if (!said(res)) return false;
      const done = res.data;
      const onKey = input.onKey;
      offerUndo(
        s.change.done(input.name),
        done.operation,
        s.change.undone,
        // In the editor: back to the section as it is called again.
        onKey
          ? (key) => {
              if (key) onKey(key);
            }
          : undefined,
      );
      onKey?.(done.key);
      return true;
    },
    [network, said, offerUndo, s],
  );

  /** A new section; answers its key (null when refused). */
  const addSection = React.useCallback(
    async (input: Omit<AddSectionInput, "restore"> & { title: string }): Promise<string | null> => {
      const { title, ...add } = input;
      const res = await call(() => addVetrinaSection(add), network);
      if (!said(res)) return null;
      offerUndo(s.add.done(title), res.data.operation, s.add.removedAgain);
      return res.data.key;
    },
    [network, said, offerUndo, s],
  );

  /** A section taken away; "Annulla" puts it back as it was. */
  const removeSection = React.useCallback(
    async (input: { key: string; title: string; expectedModifiedGmt: string }): Promise<boolean> => {
      const res = await call(() => removeVetrinaSection({ key: input.key, expectedModifiedGmt: input.expectedModifiedGmt }), network);
      if (!said(res)) return false;
      offerUndo(s.remove.done(input.title), res.data.operation, s.remove.back(input.title));
      return true;
    },
    [network, said, offerUndo, s],
  );

  /** The sections in a new order (every key once); "Annulla" puts them back. */
  const arrange = React.useCallback(
    async (input: { keys: string[]; expectedModifiedGmt: string }): Promise<boolean> => {
      const res = await call(() => arrangeVetrinaSections({ keys: input.keys, expectedModifiedGmt: input.expectedModifiedGmt }), network);
      if (!said(res)) return false;
      offerUndo(s.arrange.done, res.data.operation, s.arrange.undone);
      return true;
    },
    [network, said, offerUndo, s],
  );

  /** One section to a place among them (1-based): "Sposta su", "Sposta giù". */
  const move = React.useCallback(
    async (input: { key: string; position: number; expectedModifiedGmt: string }): Promise<boolean> => {
      const res = await call(() => moveVetrinaSection(input), network);
      if (!said(res)) return false;
      offerUndo(s.arrange.done, res.data.operation, s.arrange.undone);
      return true;
    },
    [network, said, offerUndo, s],
  );

  /** A section switched off, or on again, straight to the site. */
  const switchSection = React.useCallback(
    async (input: { key: string; title: string; on: boolean; expectedModifiedGmt: string; expectedAttrsHash: string }) => {
      const res = await call(
        () =>
          switchVetrinaSection({
            key: input.key,
            on: input.on,
            expectedModifiedGmt: input.expectedModifiedGmt,
            expectedAttrsHash: input.expectedAttrsHash,
          }),
        network,
      );
      if (!said(res)) return false;
      offerUndo(
        input.on ? s.switch.turnedOn(input.title) : s.switch.turnedOff(input.title),
        res.data.operation,
        input.on ? s.switch.turnedOff(input.title) : s.switch.turnedOn(input.title),
      );
      return true;
    },
    [network, said, offerUndo, s],
  );

  return { changeSource, addSection, removeSection, arrange, move, switchSection };
}
