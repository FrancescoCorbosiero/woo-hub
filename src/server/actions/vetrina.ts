"use server";

import { z } from "zod";
import { RAIL_FALLBACKS } from "@/config/schema";
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
import type { ProductCard, RailHistoryState, RailWriteResult } from "@/lib/vetrina/types";
import { checkNow } from "@/server/collections/runner";
import { forgetCards } from "@/server/vetrina/card-cache";
import { forgetScreenTrees } from "@/server/vetrina/catalog";
import { forgetHomepage } from "@/server/vetrina/home-cache";
import { forgetPreviewSizes } from "@/server/vetrina/operations/live";
import { forgetTaxonomies } from "@/server/woo/taxonomy-cache";

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
  // The screens showing the homepage (the catalog's marks included) read it again: publishRail forgets it.
  return attempt(() => publishRail(parsed.data));
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

/** How long ↻ waits for the store index to catch up; a slower check finishes behind the answer. */
const REFRESH_WAIT_MS = 6_000;

/**
 * ↻ on a Vetrina screen. The screens answer from what was read lately (the
 * homepage, product cards, categories and brands, a preview's sizes); this
 * forgets all of it, so the next answer reads the site and the store again.
 * With `store`, the store index first asks the store what changed since its
 * last look — the check that otherwise runs every five minutes.
 */
export async function refreshVetrina(input: { store?: boolean } = {}): Promise<void> {
  const parsed = z.object({ store: z.boolean().optional() }).safeParse(input);
  forgetHomepage();
  forgetCards();
  forgetPreviewSizes();
  forgetScreenTrees();
  forgetTaxonomies();
  if (parsed.success && parsed.data.store) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<void>((resolve) => (timer = setTimeout(resolve, REFRESH_WAIT_MS)));
    await Promise.race([checkNow().catch(() => null), late]);
    clearTimeout(timer);
  }
}
