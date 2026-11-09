"use server";

import { refresh } from "next/cache";
import { defaultLocale, type Locale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import type { SitePage } from "@/lib/menus/types";
import type { OperationView } from "@/lib/vetrina/catalog-ops";
import type { MenuActionInput } from "@/lib/vetrina/menu-ops";
import type { VetrinaErrorCode } from "@/lib/vetrina/types";
import { parseMenuActionInput } from "@/server/vetrina/operations/menu-input";
import { startMenuOperation } from "@/server/vetrina/operations/service";
import { inLanguage, words } from "@/server/vetrina/operations/words";
import type { VetrinaResult } from "@/server/vetrina/service";
import { VetrinaError } from "@/server/vetrina/source";
import { getMenuSource } from "@/server/wordpress/menus/source";
import { signedInActor } from "./signed-in";

/**
 * The Vetrina's "Menu" tab, as server actions: a menu action (added, moved,
 * taken away, renamed — server/vetrina/operations/menu.ts) done at once and
 * filed as the signed-in person's, and the site's pages for "Aggiungi
 * voci". Answers { ok, data } or { ok: false, code, error }: a refusal of
 * ours in the owner's words; anything else (WordPress not answering, a key
 * refused) by its code, for the screen to word, its detail in the log.
 */

async function language(): Promise<Locale> {
  try {
    return await getLocale();
  } catch {
    return defaultLocale;
  }
}

/** Our own refusals, said as they are — a write WordPress took only part of included. */
function own(e: unknown): boolean {
  if (!(e instanceof VetrinaError)) return false;
  if (e.code === "invalid" || e.code === "not_found" || e.code === "stale") return true;
  const w = words().menu;
  return e.code === "failed" && (e.message === w.writeFailed || e.message === w.halfWritten);
}

async function attempt<T>(fn: () => Promise<T>): Promise<VetrinaResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const code: VetrinaErrorCode = e instanceof VetrinaError ? e.code : "failed";
    if (own(e)) return { ok: false, code, error: (e as VetrinaError).message };
    console.error("[vetrina-menus] request failed:", e);
    return { ok: false, code, error: "" };
  }
}

/**
 * A menu action, as the screens ask it (with the menu's fingerprint they
 * read, `expected`): written at once, the screen read again in the same
 * answer. The answer is the log's view of it — its "Annulla" — and the
 * items an add made.
 */
export async function runMenuAction(input: MenuActionInput): Promise<VetrinaResult<{ operation: OperationView | null; created: number[] }>> {
  return inLanguage(await language(), async () => {
    const parsed = parseMenuActionInput(input);
    if (!parsed.ok) return { ok: false, code: "invalid", error: parsed.error };
    const by = await signedInActor();
    const res = await attempt(async () => {
      const { operation, result } = await startMenuOperation(parsed.data, "app", by);
      return { operation, created: result.created };
    });
    if (res.ok) refresh();
    return res;
  });
}

/** The site's published pages, for an item that leads to one. */
export async function loadSitePages(): Promise<VetrinaResult<SitePage[]>> {
  return inLanguage(await language(), () => attempt(async () => (await getMenuSource()).pages()));
}
