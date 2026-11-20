"use server";

import { z } from "zod";
import type { PageCheck } from "@/lib/pages/types";
import type { VetrinaErrorCode } from "@/lib/vetrina/types";
import type { VetrinaResult } from "@/server/vetrina/service";
import { VetrinaError } from "@/server/vetrina/source";
import { checkPage, savePage, type SaveOutcome } from "@/server/wordpress/pages/service";
import { getPageSource } from "@/server/wordpress/pages/source";
import { signedInActor } from "./signed-in";

/**
 * The Vetrina's "Pagine" tab, as server actions: a pasted markup checked
 * against the page as it is now ("Controlla"), and saved ("Aggiorna": checked
 * again, the page re-read, one write). Answers { ok, data } or
 * { ok: false, code } — the screen words every outcome itself
 * (pages.it.ts); WordPress's own words go to the log.
 */

const Input = z.object({
  id: z.number().int().positive(),
  // The checker refuses past MAX_MARKUP_BYTES in the owner's words; this only bounds the request.
  markup: z.string().max(8_000_000),
  expected: z.object({ modifiedGmt: z.string().min(1).max(40), digest: z.string().regex(/^[0-9a-f]{32}$/) }),
});
export type PageMarkupInput = z.infer<typeof Input>;

async function attempt<T>(what: string, fn: () => Promise<T>): Promise<VetrinaResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const code: VetrinaErrorCode = e instanceof VetrinaError ? e.code : "failed";
    console.error(`[vetrina-pages] ${what} failed:`, e);
    return { ok: false, code, error: "" };
  }
}

export async function checkPageMarkup(input: PageMarkupInput): Promise<VetrinaResult<{ check: PageCheck; stale: boolean }>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "" };
  return attempt("check", async () => checkPage(await getPageSource(), parsed.data));
}

/** Never retried, here or in the client: a save that timed out may have landed. */
export async function savePageMarkup(input: PageMarkupInput): Promise<VetrinaResult<SaveOutcome>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "" };
  const by = await signedInActor();
  const res = await attempt("save", async () => savePage(await getPageSource(), parsed.data));
  if (res.ok && res.data.outcome === "saved") {
    console.info(`[vetrina-pages] page ${parsed.data.id} saved by ${by?.name ?? "(no sign-in)"}: now ${res.data.saved.version.modifiedGmt}`);
  }
  return res;
}
