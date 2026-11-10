"use server";

import { z } from "zod";
import { defaultLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";
import { getLocale } from "@/i18n/server";
import {
  MAX_SOURCE_NAME,
  type OrderSourceCheck,
  type OrderSourceSummary,
  type SourceComparison,
  type SourceImport,
  type SourceLookup,
} from "@/lib/vetrina/order-sources";
import { compareSource, pairItem } from "@/server/vetrina/order-sources/compare";
import { importSkus, lookupItems, MAX_IMPORT, MAX_LOOKUP } from "@/server/vetrina/order-sources/import";
import type { VetrinaErrorCode } from "@/lib/vetrina/types";
import * as sources from "@/server/vetrina/order-sources/service";
import { currentLanguage, inLanguage, words } from "@/server/vetrina/operations/words";
import { attemptPlain, type VetrinaResult } from "@/server/vetrina/service";

/**
 * Order sources ("fonti d'ordine") from the Vetrina: listed, checked before
 * saving, saved, deleted, compared with the shop — an item paired by hand,
 * looked up on KicksDB, imported (server/vetrina/order-sources). Using one on a
 * category, a brand or the whole catalog is a catalog action, "sourceOrder"
 * (server/actions/vetrina-operations.ts). Every one answers { ok, data } or
 * { ok: false, code, error }, in the owner's language.
 */

/** A source's text: as long as a whole catalog's ranking can be, no more. */
const MAX_TEXT = 4_000_000;

const invalid = (error: string) => ({ ok: false as const, code: "invalid" as const, error });

async function language(): Promise<Locale> {
  try {
    return await getLocale();
  } catch {
    return defaultLocale;
  }
}

function plain(code: VetrinaErrorCode): string {
  const dictionary = getDictionary(currentLanguage());
  if (code === "failed") return dictionary.vetrinaCatalog.ops.error.unexpected;
  return dictionary.vetrina.errors[code] ?? dictionary.vetrinaCatalog.ops.error.unexpected;
}

const attempt = <T>(fn: () => Promise<T>) => attemptPlain(fn, plain);

async function answer<T>(fn: () => Promise<VetrinaResult<T>>): Promise<VetrinaResult<T>> {
  return inLanguage(await language(), fn);
}

const SourceId = z.object({ id: z.uuid() });

/** Every source, with how many of its products the shop has now. */
export async function loadOrderSources(): Promise<VetrinaResult<OrderSourceSummary[]>> {
  return answer(() => attempt(() => sources.listSources()));
}

/** Every source's id and name, light: the "Usa l'ordine di «…»" of a list's sort sheet. */
export async function loadOrderSourceNames(): Promise<VetrinaResult<{ id: string; name: string }[]>> {
  return answer(() => attempt(() => sources.listSourceNames()));
}

/** One source, matched to the shop now (the products it names that the shop does not have, first of all). */
export async function loadOrderSource(input: { id: string }): Promise<VetrinaResult<OrderSourceSummary>> {
  return answer(async () => {
    const parsed = SourceId.safeParse(input);
    if (!parsed.success) return invalid(words().source.gone);
    return attempt(() => sources.loadSource(parsed.data.id));
  });
}

/** A text read as a source — what it holds, how it matches the shop — before it is saved. */
export async function checkOrderSource(input: { text: string }): Promise<VetrinaResult<OrderSourceCheck>> {
  return answer(async () => {
    const parsed = z.object({ text: z.string().max(MAX_TEXT) }).safeParse(input);
    if (!parsed.success) return invalid(words().input.invalid);
    return attempt(() => sources.checkSourceText(parsed.data.text));
  });
}

/** Save a new source (with its text), or change one (its name, its origin, its text when one is given). */
export async function saveOrderSource(input: {
  id?: string;
  name: string;
  origin?: string | null;
  text?: string | null;
}): Promise<VetrinaResult<OrderSourceSummary>> {
  return answer(async () => {
    const parsed = z
      .object({
        id: z.uuid().optional(),
        name: z.string().max(MAX_SOURCE_NAME * 2),
        origin: z.string().max(2000).nullish(),
        text: z.string().max(MAX_TEXT).nullish(),
      })
      .safeParse(input);
    if (!parsed.success) return invalid(words().input.invalid);
    return attempt(() => sources.saveSource(parsed.data));
  });
}

export async function deleteOrderSource(input: { id: string }): Promise<VetrinaResult<null>> {
  return answer(async () => {
    const parsed = SourceId.safeParse(input);
    if (!parsed.success) return invalid(words().source.gone);
    return attempt(async () => {
      await sources.deleteSource(parsed.data.id);
      return null;
    });
  });
}

/** A source against the shop, item by item: prices beyond the threshold, the missing, the uncertain. */
export async function compareOrderSource(input: { id: string; threshold?: number }): Promise<VetrinaResult<SourceComparison>> {
  return answer(async () => {
    const parsed = z.object({ id: z.uuid(), threshold: z.number().min(0).max(100).optional() }).safeParse(input);
    if (!parsed.success) return invalid(words().source.gone);
    return attempt(() => compareSource(parsed.data.id, { threshold: parsed.data.threshold }));
  });
}

/** An item paired by hand — a product of the shop, "none", or "auto" (the matcher again): the comparison as it reads now. */
export async function pairOrderSourceItem(input: {
  id: string;
  position: number;
  pair: number | "none" | "auto";
}): Promise<VetrinaResult<SourceComparison>> {
  return answer(async () => {
    const parsed = z
      .object({
        id: z.uuid(),
        position: z.number().int().positive(),
        pair: z.union([z.number().int().positive(), z.enum(["none", "auto"])]),
      })
      .safeParse(input);
    if (!parsed.success) return invalid(words().input.invalid);
    const { id, position, pair } = parsed.data;
    return attempt(() => pairItem(id, position, pair === "none" ? null : pair === "auto" ? undefined : pair));
  });
}

/** KicksDB's products for some items of a source (by place): closest first. */
export async function lookupOrderSourceItems(input: { id: string; positions: number[] }): Promise<VetrinaResult<SourceLookup[]>> {
  return answer(async () => {
    const parsed = z
      .object({ id: z.uuid(), positions: z.array(z.number().int().positive()).min(1).max(MAX_LOOKUP) })
      .safeParse(input);
    if (!parsed.success) return invalid(words().input.invalid);
    return attempt(() => lookupItems(parsed.data.id, parsed.data.positions));
  });
}

/** A slice of the comparison's "Importa": these SKUs published (POST /api/order-sources/import calls it). */
export async function importSourceSkus(input: unknown): Promise<VetrinaResult<SourceImport>> {
  return answer(async () => {
    const parsed = z
      .object({ skus: z.array(z.string().trim().min(1).max(64)).min(1).max(MAX_IMPORT), dryRun: z.boolean().default(false) })
      .safeParse(input);
    if (!parsed.success) return invalid(words().source.importEmpty);
    return attempt(() => importSkus(parsed.data.skus, { dryRun: parsed.data.dryRun }));
  });
}
