"use server";

import { z } from "zod";
import { RAIL_FALLBACKS, RAIL_LISTS } from "@/config/schema";
import {
  attempt,
  publishBlock,
  publishRail,
  readCards,
  readHistory,
  readRail,
  type VetrinaResult,
  type VetrinaRail,
} from "@/server/vetrina/service";
import {
  addSection,
  arrangeSections,
  changeSectionSource,
  previewSectionSource,
  removeSection,
  switchSection,
  type AddSectionInput,
  type SourceChange,
  type SourceResult,
} from "@/server/vetrina/layout";
import { forgetHomepagePresence } from "@/server/vetrina/catalog";
import type { ProductCard, RailHistoryState, RailWriteResult } from "@/lib/vetrina/types";

/**
 * The Vetrina editor's server actions: thin, validated wrappers over
 * server/vetrina/service.ts. Every one answers { ok, data } or
 * { ok: false, code, error } — the editor turns the code into a message.
 */

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

export async function publishVetrinaRail(input: z.input<typeof PublishSchema>): Promise<VetrinaResult<RailWriteResult>> {
  const parsed = PublishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: parsed.error.issues[0]?.message ?? "Dati non validi." };
  const res = await attempt(() => publishRail(parsed.data));
  // The catalog's homepage marks (badges, "In homepage", a product's places) follow at once.
  if (res.ok) forgetHomepagePresence();
  return res;
}

const PublishBlockSchema = z.object({
  path: z.string().min(1).max(40),
  blockName: z.string().min(3).max(100),
  expectedModifiedGmt: z.string().min(1).max(40),
  expectedAttrsHash: z.string().min(1).max(64),
  fields: Fields,
});

/** A block's fields (a slider's title, the FAQ's subtitle), straight to the site. */
export async function publishVetrinaBlock(input: z.input<typeof PublishBlockSchema>): Promise<VetrinaResult<RailWriteResult>> {
  const parsed = PublishBlockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: parsed.error.issues[0]?.message ?? "Dati non validi." };
  return attempt(() => publishBlock(parsed.data));
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
const Order = z.object({ pin: Ids, exclude: Ids, fallback: Fallback });
const Layout = z.record(z.enum(["columns", "columns_tablet", "columns_mobile", "ratio", "fit"]), z.string().max(10));

/** A write to the sections moved them: the catalog's homepage marks follow at once. */
function forgetOnSuccess<T>(res: VetrinaResult<T>): VetrinaResult<T> {
  if (res.ok) forgetHomepagePresence();
  return res;
}

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
  restore: Order.optional(),
});

/** Point a section at another category, brand or shop-wide list. */
export async function changeVetrinaSource(input: z.input<typeof SourceSchema>): Promise<VetrinaResult<SourceResult>> {
  const parsed = SourceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: parsed.error.issues[0]?.message ?? "Dati non validi." };
  return forgetOnSuccess(await attempt(() => changeSectionSource(parsed.data)));
}

const AddSchema = z.object({
  anchorKey: Key,
  place: z.enum(["after", "before"]),
  expectedModifiedGmt: Gmt,
  source: Source,
  fields: Fields,
  limit: z.number().int().min(1).max(100).optional(),
  restore: Order.extend({ layout: Layout }).optional(),
});

/** A new section next to another (or one taken away, put back). */
export async function addVetrinaSection(
  input: z.input<typeof AddSchema>,
): Promise<VetrinaResult<{ key: string | null; modifiedGmt: string }>> {
  const parsed = AddSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: parsed.error.issues[0]?.message ?? "Dati non validi." };
  return forgetOnSuccess(await attempt(() => addSection(parsed.data)));
}

/** A section taken off the homepage; the answer is its way back, for "Annulla". */
export async function removeVetrinaSection(input: {
  key: string;
  expectedModifiedGmt: string;
}): Promise<VetrinaResult<{ restore: AddSectionInput }>> {
  const parsed = z.object({ key: Key, expectedModifiedGmt: Gmt }).safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Sezione non valida." };
  return forgetOnSuccess(await attempt(() => removeSection(parsed.data)));
}

/** The sections in a new order: every key, once. */
export async function arrangeVetrinaSections(input: {
  keys: string[];
  expectedModifiedGmt: string;
}): Promise<VetrinaResult<{ keys: Record<string, string>; modifiedGmt: string }>> {
  const parsed = z.object({ keys: z.array(Key).min(1).max(100), expectedModifiedGmt: Gmt }).safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Sezioni non valide." };
  return forgetOnSuccess(await attempt(() => arrangeSections(parsed.data)));
}

/** A section switched off or on, straight to the site. */
export async function switchVetrinaSection(input: {
  key: string;
  on: boolean;
  expectedModifiedGmt: string;
  expectedAttrsHash: string;
}): Promise<VetrinaResult<RailWriteResult>> {
  const parsed = z
    .object({ key: Key, on: z.boolean(), expectedModifiedGmt: Gmt, expectedAttrsHash: Hash })
    .safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Sezione non valida." };
  return forgetOnSuccess(await attempt(() => switchSection(parsed.data)));
}
