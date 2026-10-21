"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { RAIL_FALLBACKS, RAIL_LISTS } from "@/config/schema";
import { defaultLocale, type Locale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import type { OperationView } from "@/lib/vetrina/catalog-ops";
import { attempt, readCards, readHistory, readRail, type VetrinaResult, type VetrinaRail } from "@/server/vetrina/service";
import { previewSectionSource, type SourceChange, type SourceResult } from "@/server/vetrina/layout";
import { startPageOperation } from "@/server/vetrina/operations/service";
import { inLanguage } from "@/server/vetrina/operations/words";
import type { ProductCard, RailHistoryState, RailWriteResult } from "@/lib/vetrina/types";

/**
 * The Vetrina editor's server actions: thin, validated wrappers over
 * server/vetrina/service.ts. Every one answers { ok, data } or
 * { ok: false, code, error } — the editor turns the code into a message.
 *
 * Every write to the homepage is an action in the Vetrina's log
 * (server/vetrina/operations/page.ts): its answer carries the log's view of
 * it, whose id is its "Annulla" — null when the log could not file it.
 */

/** A write's answer, with the action the log filed. */
type Logged<T> = T & { operation: OperationView | null };

/** Run it in the owner's language (his cookie): the refusals the actions word are his. */
async function inOwnLanguage<T>(fn: () => Promise<T>): Promise<T> {
  let locale: Locale = defaultLocale;
  try {
    locale = await getLocale();
  } catch {
    // No request to read it from: Italian.
  }
  return inLanguage(locale, fn);
}

/**
 * A write to the homepage, in the owner's language: once it went through,
 * the screen that asked gets the page read again in the same answer
 * (next/cache's refresh). A router.refresh() of its own, sent right after
 * the action, could be dropped by the router — the screen then showed the
 * old page for seconds.
 */
async function write<T>(fn: () => Promise<T>): Promise<VetrinaResult<T>> {
  const res = await inOwnLanguage(() => attempt(fn));
  if (res.ok) refresh();
  return res;
}

const Key = z.string().min(3).max(300);
const Fallback = z.enum(RAIL_FALLBACKS);
const Ids = z.array(z.number().int().positive()).max(100);

export async function loadVetrinaRail(input: { key: string; fallback?: string }): Promise<VetrinaResult<VetrinaRail>> {
  const parsed = z.object({ key: Key, fallback: Fallback.optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Sezione non valida." };
  return attempt(() => readRail(parsed.data.key, parsed.data.fallback));
}

export async function loadVetrinaCards(input: {
  ids: number[];
}): Promise<VetrinaResult<{ cards: ProductCard[]; locks: Record<string, number> }>> {
  const parsed = z.object({ ids: Ids }).safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Prodotti non validi." };
  return attempt(() => readCards(parsed.data.ids));
}

export async function loadVetrinaHistory(input: { key: string }): Promise<VetrinaResult<RailHistoryState[]>> {
  const parsed = z.object({ key: Key }).safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Sezione non valida." };
  return attempt(() => readHistory(parsed.data.key));
}

// Field values are checked field by field in the service (lib/vetrina/fields.ts);
// here only their shape and a hard size cap.
const Fields = z.record(z.string().min(1).max(40), z.string().max(1000)).refine((f) => Object.keys(f).length <= 20);

const PublishSchema = z.object({
  key: Key,
  expectedModifiedGmt: z.string().min(1).max(40),
  expectedAttrsHash: z.string().min(1).max(64),
  pin: Ids,
  exclude: Ids,
  fallback: Fallback,
  fields: Fields.optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/** The section editor's "Pubblica": its products' places, hidden ones, automatic order, texts and size. */
export async function publishVetrinaRail(input: z.input<typeof PublishSchema>): Promise<VetrinaResult<Logged<RailWriteResult>>> {
  const parsed = PublishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: parsed.error.issues[0]?.message ?? "Dati non validi." };
  const { expectedModifiedGmt, expectedAttrsHash, ...settings } = parsed.data;
  return write(async () => {
    const { operation, result } = await startPageOperation({
      kind: "sectionEdit",
      ...settings,
      expected: { modifiedGmt: expectedModifiedGmt, attrsHash: expectedAttrsHash },
    });
    return { ...result, operation };
  });
}

const PublishBlockSchema = z.object({
  path: z.string().min(1).max(40),
  blockName: z.string().min(3).max(100),
  expectedModifiedGmt: z.string().min(1).max(40),
  expectedAttrsHash: z.string().min(1).max(64),
  fields: Fields,
});

/** A block's fields (a slider's title, the FAQ's subtitle), straight to the site. */
export async function publishVetrinaBlock(input: z.input<typeof PublishBlockSchema>): Promise<VetrinaResult<Logged<RailWriteResult>>> {
  const parsed = PublishBlockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: parsed.error.issues[0]?.message ?? "Dati non validi." };
  const { expectedModifiedGmt, expectedAttrsHash, ...block } = parsed.data;
  return write(async () => {
    const { operation, result } = await startPageOperation({
      kind: "blockEdit",
      ...block,
      expected: { modifiedGmt: expectedModifiedGmt, attrsHash: expectedAttrsHash },
    });
    return { ...result, operation };
  });
}

/* ---------------------------------------------------------------- *
 * The sections themselves (golden-hive-blocks 5.15.0)
 * ---------------------------------------------------------------- */

// A WordPress slug: lowercase letters, digits, dashes, underscores, and the percent escapes of accented letters.
const Source = z.union([
  z.object({ taxonomy: z.enum(["category", "brand"]), slug: z.string().regex(/^[a-z0-9_%-]{1,200}$/) }),
  z.object({ list: z.enum(RAIL_LISTS) }),
]);
const Gmt = z.string().min(1).max(40);
const Hash = z.string().min(1).max(64);

/** What pointing a section at something else would keep (pins, hidden products) and change (its button). */
export async function previewVetrinaSource(input: { key: string; source: unknown }): Promise<VetrinaResult<SourceChange>> {
  const parsed = z.object({ key: Key, source: Source }).safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Scelta non valida." };
  return attempt(() => previewSectionSource(parsed.data.key, parsed.data.source));
}

const SourceSchema = z.object({
  key: Key,
  expectedModifiedGmt: Gmt,
  expectedAttrsHash: Hash,
  source: Source,
  fields: Fields.optional(),
});

/** Point a section at another category, brand or shop-wide list. */
export async function changeVetrinaSource(input: z.input<typeof SourceSchema>): Promise<VetrinaResult<Logged<SourceResult>>> {
  const parsed = SourceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: parsed.error.issues[0]?.message ?? "Dati non validi." };
  const { expectedModifiedGmt, expectedAttrsHash, ...change } = parsed.data;
  return write(async () => {
    const { operation, result } = await startPageOperation({
      kind: "sectionSource",
      ...change,
      expected: { modifiedGmt: expectedModifiedGmt, attrsHash: expectedAttrsHash },
    });
    return { ...result, operation };
  });
}

const AddSchema = z.object({
  anchorKey: Key,
  place: z.enum(["after", "before"]),
  expectedModifiedGmt: Gmt,
  source: Source,
  fields: Fields,
  limit: z.number().int().min(1).max(100).optional(),
});

/** A new section next to another. */
export async function addVetrinaSection(
  input: z.input<typeof AddSchema>,
): Promise<VetrinaResult<Logged<{ key: string | null; modifiedGmt: string }>>> {
  const parsed = AddSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: parsed.error.issues[0]?.message ?? "Dati non validi." };
  const { expectedModifiedGmt, ...add } = parsed.data;
  return write(async () => {
    const { operation, result } = await startPageOperation({ kind: "sectionAdd", ...add, expected: { modifiedGmt: expectedModifiedGmt } });
    return { ...result, operation };
  });
}

/** A section taken off the homepage; its "Annulla" (the log's) puts it back as it was. */
export async function removeVetrinaSection(input: {
  key: string;
  expectedModifiedGmt: string;
}): Promise<VetrinaResult<Logged<{ modifiedGmt: string }>>> {
  const parsed = z.object({ key: Key, expectedModifiedGmt: Gmt }).safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Sezione non valida." };
  return write(async () => {
    const { operation, result } = await startPageOperation({
      kind: "sectionRemove",
      key: parsed.data.key,
      expected: { modifiedGmt: parsed.data.expectedModifiedGmt },
    });
    return { ...result, operation };
  });
}

/** The sections in a new order: every key, once. */
export async function arrangeVetrinaSections(input: {
  keys: string[];
  expectedModifiedGmt: string;
}): Promise<VetrinaResult<Logged<{ keys: Record<string, string>; modifiedGmt: string }>>> {
  const parsed = z.object({ keys: z.array(Key).min(1).max(100), expectedModifiedGmt: Gmt }).safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Sezioni non valide." };
  return write(async () => {
    const { operation, result } = await startPageOperation({
      kind: "sectionsArrange",
      keys: parsed.data.keys,
      expected: { modifiedGmt: parsed.data.expectedModifiedGmt },
    });
    return { ...result, operation };
  });
}

/** One section to a place among the sections (1-based): the card's "Sposta su" and "Sposta giù". */
export async function moveVetrinaSection(input: {
  key: string;
  position: number;
  expectedModifiedGmt: string;
}): Promise<VetrinaResult<Logged<{ keys: Record<string, string>; modifiedGmt: string }>>> {
  const parsed = z.object({ key: Key, position: z.number().int().min(1).max(100), expectedModifiedGmt: Gmt }).safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Sezione non valida." };
  return write(async () => {
    const { operation, result } = await startPageOperation({
      kind: "sectionMove",
      key: parsed.data.key,
      position: parsed.data.position,
      expected: { modifiedGmt: parsed.data.expectedModifiedGmt },
    });
    return { ...result, operation };
  });
}

/** A section switched off or on, straight to the site. */
export async function switchVetrinaSection(input: {
  key: string;
  on: boolean;
  expectedModifiedGmt: string;
  expectedAttrsHash: string;
}): Promise<VetrinaResult<Logged<RailWriteResult>>> {
  const parsed = z
    .object({ key: Key, on: z.boolean(), expectedModifiedGmt: Gmt, expectedAttrsHash: Hash })
    .safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Sezione non valida." };
  return write(async () => {
    const { operation, result } = await startPageOperation({
      kind: "sectionSwitch",
      key: parsed.data.key,
      on: parsed.data.on,
      expected: { modifiedGmt: parsed.data.expectedModifiedGmt, attrsHash: parsed.data.expectedAttrsHash },
    });
    return { ...result, operation };
  });
}
