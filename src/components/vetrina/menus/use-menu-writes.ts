"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import type { MenuActionInput } from "@/lib/vetrina/menu-ops";
import { runMenuAction } from "@/server/actions/vetrina-menus";
import { undoOperation } from "@/server/actions/vetrina-operations";
import type { VetrinaResult } from "@/server/vetrina/service";
import { call } from "../catalog/act/call";

/**
 * Every write to a menu, as the screens make it: the action written at once
 * on the server, which answers with the screen read again
 * (server/actions/vetrina-menus.ts), and a toast saying what happened, with
 * the log's "Annulla" — the same one "Attività" offers later. A refusal is
 * toasted in the owner's words; a menu that changed meanwhile is read again.
 */
/** What a write left: the items an add made, and the menu (a new one's id; null once deleted). */
export interface MenuWritten {
  created: number[];
  menuId: number | null;
}

export function useMenuWrites() {
  const { t } = useI18n();
  const m = t.vetrinaCatalog.menus;
  const network = t.vetrinaCatalog.act.sheet.network;
  const router = useRouter();

  /** A refusal, said: ours in its words, anything else in the Vetrina's; a stale read, read again. True when it went through. */
  const said = React.useCallback(
    <T,>(res: VetrinaResult<T>): res is { ok: true; data: T } => {
      if (res.ok) return true;
      const words = m.errors[res.code] ?? t.vetrina.errors[res.code];
      toast.error(res.error || words || t.vetrina.errors.failed);
      if (res.code === "stale") router.refresh();
      return false;
    },
    [t, m, router],
  );

  /**
   * Run a menu action; toast `done` with "Annulla". The answer: the items an
   * add made and the menu the action left (a new menu's id), or null when
   * refused.
   */
  const run = React.useCallback(
    async (input: MenuActionInput, done: string): Promise<MenuWritten | null> => {
      const res = await call(() => runMenuAction(input), network);
      if (!said(res)) return null;
      const operation = res.data.operation;
      const written = { created: res.data.created, menuId: res.data.menuId };
      toast.dismiss();
      if (!operation?.undoable) {
        toast.success(done);
        return written;
      }
      toast.success(done, {
        duration: 10_000,
        action: {
          label: m.undo,
          onClick: () => {
            void call(() => undoOperation({ id: operation.id }), network).then((undone) => {
              if (!undone.ok) {
                toast.error(undone.error);
                router.refresh();
                return;
              }
              toast.success(m.done.undone);
            });
          },
        },
      });
      return written;
    },
    [network, said, m, router],
  );

  return { run };
}
