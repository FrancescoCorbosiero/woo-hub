"use server";

import { z } from "zod";
import { defaultLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";
import { getLocale } from "@/i18n/server";
import type {
  HomepageSectionOption,
  OperationInput,
  OperationPreview,
  OperationTarget,
  OperationView,
  TermActionsState,
  TermMarginState,
} from "@/lib/vetrina/catalog-ops";
import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import type { VetrinaErrorCode } from "@/lib/vetrina/types";
import { parseOperationInput, parseTarget } from "@/server/vetrina/operations/input";
import * as operations from "@/server/vetrina/operations/service";
import { currentLanguage, inLanguage, words } from "@/server/vetrina/operations/words";
import { attemptPlain, type VetrinaResult } from "@/server/vetrina/service";

/**
 * The Vetrina catalog's actions on products — hide and show, sale and its
 * end, tags, categories, a place on the homepage, a whole term's margin
 * (validated in server/vetrina/operations/input.ts) — as server actions: thin,
 * validated wrappers over server/vetrina/operations. Every one answers
 * { ok, data } or { ok: false, code, error }, like the rest of the Vetrina,
 * in the language the owner reads it in.
 */

const invalid = (error: string) => ({ ok: false as const, code: "invalid" as const, error });

/** The owner's language, from his cookie; Italian where there is no request to read it from. */
async function language(): Promise<Locale> {
  try {
    return await getLocale();
  } catch {
    return defaultLocale;
  }
}

/**
 * A failure in the owner's words, by its code: the store not set up or
 * refusing the key say so; anything else (a failed query, the store's own
 * text) is a problem on the server, whose log keeps the detail.
 */
function plain(code: VetrinaErrorCode): string {
  const dictionary = getDictionary(currentLanguage());
  if (code === "failed") return dictionary.vetrinaCatalog.ops.error.unexpected;
  return dictionary.vetrina.errors[code] ?? dictionary.vetrinaCatalog.ops.error.unexpected;
}

/** Run it; a failure answers in plain words (attemptPlain). */
const attempt = <T>(fn: () => Promise<T>) => attemptPlain(fn, plain);

/** Run the answer in the owner's language: every word built on the way — and by a run it starts — is his. */
async function answer<T>(fn: () => Promise<VetrinaResult<T>>): Promise<VetrinaResult<T>> {
  return inLanguage(await language(), fn);
}

/** What the action would do, product by product. Nothing is written. */
export async function previewOperation(input: OperationInput): Promise<VetrinaResult<OperationPreview>> {
  return answer(async () => {
    const parsed = parseOperationInput(input);
    if (!parsed.ok) return invalid(parsed.error);
    return attempt(() => operations.previewOperation(parsed.data));
  });
}

/** Start the action: it runs in the background, one at a time; follow it with loadOperation. */
export async function startOperation(input: OperationInput): Promise<VetrinaResult<OperationView>> {
  return answer(async () => {
    const parsed = parseOperationInput(input);
    if (!parsed.ok) return invalid(parsed.error);
    return attempt(() => operations.startOperation(parsed.data));
  });
}

const OperationId = z.object({ id: z.uuid() });

/** An action as it is now: its progress while it runs, how it went once done. */
export async function loadOperation(input: { id: string }): Promise<VetrinaResult<OperationView>> {
  return answer(async () => {
    const parsed = OperationId.safeParse(input);
    if (!parsed.success) return invalid(words().input.operation);
    return attempt(() => operations.loadOperation(parsed.data.id));
  });
}

/** The log, newest first (20 unless asked; at most 100). */
export async function listOperations(input: { limit?: number } = {}): Promise<VetrinaResult<OperationView[]>> {
  return answer(async () => {
    const parsed = z.object({ limit: z.number().int().min(1).max(100).optional() }).safeParse(input ?? {});
    if (!parsed.success) return invalid(words().input.invalid);
    return attempt(() => operations.listOperations(parsed.data.limit ?? 20));
  });
}

/** "Annulla": put back what the action changed, where the store still shows it. Runs in the background too. */
export async function undoOperation(input: { id: string }): Promise<VetrinaResult<OperationView>> {
  return answer(async () => {
    const parsed = OperationId.safeParse(input);
    if (!parsed.success) return invalid(words().input.operation);
    return attempt(() => operations.undoOperation(parsed.data.id));
  });
}

/** A category's or brand's screen: the action that hid it ("Mostra" undoes it), its running sale, its counts. */
export async function loadTermActions(input: {
  taxonomy: CatalogTaxonomy;
  id: number;
}): Promise<VetrinaResult<TermActionsState>> {
  return answer(async () => {
    const parsed = z.object({ taxonomy: z.enum(["category", "brand"]), id: z.number().int().positive() }).safeParse(input);
    if (!parsed.success) return invalid(words().input.term);
    return attempt(() => operations.loadTermActions(parsed.data.taxonomy, parsed.data.id));
  });
}

/**
 * "Nascondi i nuovi arrivati": the products that joined a hidden category or
 * brand since its hide, hidden now with it instead of after the next check
 * (filed under the term's own hide: its "Mostra" brings them back).
 */
export async function hideTermNewcomers(): Promise<VetrinaResult<null>> {
  return answer(() => attempt(async () => {
    await operations.hideTermNewcomers();
    return null;
  }));
}

/**
 * A category's or brand's margin (phase 4): its own, the one it gets from
 * a term above it, the standard, and how many of its products the Hub
 * prices — what its screen's "Ricarico" row and the margin sheet start from.
 */
export async function loadTermMargin(input: {
  taxonomy: CatalogTaxonomy;
  id: number;
}): Promise<VetrinaResult<TermMarginState>> {
  return answer(async () => {
    const parsed = z.object({ taxonomy: z.enum(["category", "brand"]), id: z.number().int().positive() }).safeParse(input);
    if (!parsed.success) return invalid(words().input.term);
    return attempt(() => operations.loadTermMargin(parsed.data.taxonomy, parsed.data.id));
  });
}

/**
 * The homepage's product sections, for "Metti in homepage" — for some
 * products (`target`), with how many of them each section would take.
 */
export async function loadHomepageSections(
  input: { target?: OperationTarget } = {},
): Promise<VetrinaResult<HomepageSectionOption[]>> {
  return answer(async () => {
    const target = input?.target ? parseTarget(input.target) : null;
    return attempt(() => operations.loadHomepageSections(target ?? undefined));
  });
}
