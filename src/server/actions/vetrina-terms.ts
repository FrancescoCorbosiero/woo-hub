"use server";

import { refresh } from "next/cache";
import { defaultLocale, type Locale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import type { OperationView } from "@/lib/vetrina/catalog-ops";
import type { TermActionInput } from "@/lib/vetrina/term-ops";
import type { VetrinaErrorCode } from "@/lib/vetrina/types";
import { startTermOperation } from "@/server/vetrina/operations/service";
import { parseTermActionInput } from "@/server/vetrina/operations/term-input";
import { assessTermAction } from "@/server/vetrina/operations/terms";
import { inLanguage } from "@/server/vetrina/operations/words";
import type { VetrinaResult } from "@/server/vetrina/service";
import { VetrinaError } from "@/server/vetrina/source";
import { signedInActor } from "./signed-in";

/**
 * A category's or a brand's own actions done at once, from its screen's
 * "⋯" (server/vetrina/operations/terms.ts): previewed in sentences, then
 * written and filed as the signed-in person's. Merging and deleting are
 * catalog actions, started like the others (vetrina-operations.ts).
 * Answers { ok, data } or { ok: false, code, error }: a refusal of ours in
 * the owner's words; anything else by its code, its detail in the log.
 */

async function language(): Promise<Locale> {
  try {
    return await getLocale();
  } catch {
    return defaultLocale;
  }
}

async function attempt<T>(fn: () => Promise<T>): Promise<VetrinaResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const code: VetrinaErrorCode = e instanceof VetrinaError ? e.code : "failed";
    if (e instanceof VetrinaError && (code === "invalid" || code === "not_found" || code === "stale")) return { ok: false, code, error: e.message };
    console.error("[vetrina-terms] request failed:", e);
    return { ok: false, code, error: "" };
  }
}

/** What it would do, in sentences, and what to know first — or why it cannot. */
export async function previewTermAction(input: TermActionInput): Promise<VetrinaResult<{ lines: string[]; warnings: string[] }>> {
  return inLanguage(await language(), async () => {
    const parsed = parseTermActionInput(input);
    if (!parsed.ok) return { ok: false, code: "invalid", error: parsed.error };
    return attempt(async () => {
      const { preview } = await assessTermAction(parsed.data);
      return { lines: preview.page?.lines ?? [], warnings: preview.warnings };
    });
  });
}

/** Do it: the log's view (its "Annulla") and the term as it is after. */
export async function runTermAction(
  input: TermActionInput,
): Promise<VetrinaResult<{ operation: OperationView | null; term: { id: number; name: string; parent: number } | null }>> {
  return inLanguage(await language(), async () => {
    const parsed = parseTermActionInput(input);
    if (!parsed.ok) return { ok: false, code: "invalid", error: parsed.error };
    const by = await signedInActor();
    const res = await attempt(async () => {
      const { operation, result } = await startTermOperation(parsed.data, "app", by);
      return { operation, term: result.term ? { id: result.term.id, name: result.term.name, parent: result.term.parent } : null };
    });
    if (res.ok) refresh();
    return res;
  });
}
