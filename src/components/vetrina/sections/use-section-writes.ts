"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import type { FieldValues, RailFallback, RailSource } from "@/lib/vetrina/types";
import {
  addVetrinaSection,
  arrangeVetrinaSections,
  changeVetrinaSource,
  removeVetrinaSection,
  switchVetrinaSection,
} from "@/server/actions/vetrina";
import type { AddSectionInput } from "@/server/vetrina/layout";
import type { VetrinaResult } from "@/server/vetrina/service";
import { call } from "../catalog/act/call";

/**
 * Every write to the homepage's sections, as the screens make them: the
 * server's answer, a toast saying what happened with an "Annulla" that
 * writes the way back (each answer carries what that needs), and the
 * screens read again. A refusal is toasted in the owner's words; a page that
 * changed meanwhile is read again.
 */

/** Refusals the server words for the owner (a duplicate section, the last one): shown as they are. */
const OWN_WORDS = new Set(["invalid", "not_found"]);

/** What a section was, for "Annulla" after it is pointed elsewhere. */
export interface SourceBefore {
  source: RailSource;
  title: string;
  buttonUrl: string;
  pin: number[];
  exclude: number[];
  fallback: RailFallback;
}

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
   * A toast with "Annulla": the way back runs once, then the screens read the
   * page again — unless the way back went to another address ("navigated"),
   * which reads it: a refresh right after a navigation would cancel it.
   */
  const offerUndo = React.useCallback(
    (message: string, undo: () => Promise<boolean | "navigated">, undone: string) => {
      toast.dismiss();
      toast.success(message, {
        duration: 10_000,
        action: {
          label: s.undo,
          onClick: () => {
            void undo().then((ok) => {
              if (ok) toast.success(undone);
              if (ok !== "navigated") router.refresh();
            });
          },
        },
      });
    },
    [s, router],
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
      /** What "Annulla" puts back; none for what a write cannot name again (a fixed list, a tag): no "Annulla". */
      before: SourceBefore | null;
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
      const before = input.before;
      if (before) {
        offerUndo(
          s.change.done(input.name),
          async () => {
            const back = await call(
              () =>
                changeVetrinaSource({
                  key: done.key,
                  expectedModifiedGmt: done.modifiedGmt,
                  expectedAttrsHash: done.attrsHash,
                  source: before.source,
                  fields: { title: before.title, buttonUrl: before.buttonUrl },
                  restore: { pin: before.pin, exclude: before.exclude, fallback: before.fallback },
                }),
              network,
            );
            if (!said(back)) return false;
            if (!input.onKey) return true;
            input.onKey(back.data.key);
            return "navigated";
          },
          s.change.undone,
        );
      } else {
        toast.success(s.change.done(input.name));
      }
      if (input.onKey) input.onKey(done.key);
      else router.refresh();
      return true;
    },
    [network, said, offerUndo, s, router],
  );

  /** A new section; answers its key (null when refused). */
  const addSection = React.useCallback(
    async (input: AddSectionInput & { title: string }): Promise<string | null> => {
      const { title, ...add } = input;
      const res = await call(() => addVetrinaSection(add), network);
      if (!said(res)) return null;
      const { key, modifiedGmt } = res.data;
      if (key) {
        offerUndo(
          s.add.done(title),
          async () => said(await call(() => removeVetrinaSection({ key, expectedModifiedGmt: modifiedGmt }), network)),
          s.add.removedAgain,
        );
      }
      router.refresh();
      return key;
    },
    [network, said, offerUndo, s, router],
  );

  /** A section taken away; "Annulla" puts it back as it was. */
  const removeSection = React.useCallback(
    async (input: { key: string; title: string; expectedModifiedGmt: string }): Promise<boolean> => {
      const res = await call(() => removeVetrinaSection({ key: input.key, expectedModifiedGmt: input.expectedModifiedGmt }), network);
      if (!said(res)) return false;
      const { restore } = res.data;
      offerUndo(
        s.remove.done(input.title),
        async () => said(await call(() => addVetrinaSection(restore), network)),
        s.remove.back(input.title),
      );
      router.refresh();
      return true;
    },
    [network, said, offerUndo, s, router],
  );

  /** The sections in a new order (every key once); "Annulla" puts them back. */
  const arrange = React.useCallback(
    async (input: { keys: string[]; before: string[]; expectedModifiedGmt: string }): Promise<boolean> => {
      const res = await call(() => arrangeVetrinaSections({ keys: input.keys, expectedModifiedGmt: input.expectedModifiedGmt }), network);
      if (!said(res)) return false;
      const { keys: renamed, modifiedGmt } = res.data;
      offerUndo(
        s.arrange.done,
        async () =>
          said(
            await call(
              () =>
                arrangeVetrinaSections({ keys: input.before.map((key) => renamed[key] ?? key), expectedModifiedGmt: modifiedGmt }),
              network,
            ),
          ),
        s.arrange.undone,
      );
      router.refresh();
      return true;
    },
    [network, said, offerUndo, s, router],
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
      const done = res.data;
      offerUndo(
        input.on ? s.switch.turnedOn(input.title) : s.switch.turnedOff(input.title),
        async () =>
          said(
            await call(
              () =>
                switchVetrinaSection({
                  key: input.key,
                  on: !input.on,
                  expectedModifiedGmt: done.modifiedGmt,
                  expectedAttrsHash: done.attrsHash,
                }),
              network,
            ),
          ),
        input.on ? s.switch.turnedOff(input.title) : s.switch.turnedOn(input.title),
      );
      router.refresh();
      return true;
    },
    [network, said, offerUndo, s, router],
  );

  return { changeSource, addSection, removeSection, arrange, switchSection };
}
