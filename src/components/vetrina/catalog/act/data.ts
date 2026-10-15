"use client";

import useSWR, { mutate } from "swr";
import type { TermOption } from "@/lib/collections/types";
import type { CatalogOverview } from "@/lib/vetrina/catalog";
import type { HomepageSectionOption, OperationTarget } from "@/lib/vetrina/catalog-ops";
import { loadCollectionOptions } from "@/server/actions/collections";
import { loadCatalogOverview } from "@/server/actions/vetrina-catalog";
import { loadHomepageSections } from "@/server/actions/vetrina-operations";

/**
 * What the sheets pick from — the store's tags, its categories (with the
 * automatic ones' rules), the homepage's sections — read once and kept for
 * the next sheet, read again in the background on the next opening after
 * half a minute, and after every action (a new tag, pins that moved).
 */

const PREFIX = "vetrina-act:";
const TAGS = `${PREFIX}tags`;
const OVERVIEW = `${PREFIX}overview`;
const SECTIONS = `${PREFIX}sections`;

const OPTIONS = { revalidateOnFocus: false, dedupingInterval: 30_000, shouldRetryOnError: false } as const;

async function fetchTags(): Promise<TermOption[]> {
  const res = await loadCollectionOptions();
  if (!res.ok) throw new Error(res.error);
  return res.data.options.tags;
}

async function fetchOverview(): Promise<CatalogOverview> {
  const res = await loadCatalogOverview();
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

async function fetchSections(key: string): Promise<HomepageSectionOption[]> {
  const target = key.slice(SECTIONS.length + 1);
  const res = await loadHomepageSections(target ? { target: JSON.parse(target) as OperationTarget } : {});
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export const useStoreTags = () => useSWR(TAGS, fetchTags, OPTIONS);
/** The categories, with their paths, counts and automatic rules (and the brands, unused here). */
export const useCatalogOverview = () => useSWR(OVERVIEW, fetchOverview, OPTIONS);
/** The homepage's sections; for some products, with how many of them each would take. */
export const useHomepageSections = (target?: OperationTarget | null) =>
  useSWR(`${SECTIONS}:${target ? JSON.stringify(target) : ""}`, fetchSections, OPTIONS);

/** An action ended: what the sheets pick from may have changed. Read again whatever is in use. */
export function refreshActData(): void {
  void mutate((key) => typeof key === "string" && key.startsWith(PREFIX));
}
