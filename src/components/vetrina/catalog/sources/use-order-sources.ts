"use client";

import useSWR, { mutate } from "swr";
import type { OrderSourceSummary } from "@/lib/vetrina/order-sources";
import { loadOrderSourceNames, loadOrderSources } from "@/server/actions/vetrina-order-sources";

/**
 * The order sources, read with SWR: whole (matched to the shop — the sheet
 * that manages them) or by name only (a list's "Usa l'ordine di «…»", read
 * with every category's screen, so kept light).
 */

const SOURCES_KEY = "vetrina-order-sources";
const NAMES_KEY = "vetrina-order-source-names";

async function fetchSources(): Promise<OrderSourceSummary[]> {
  const res = await loadOrderSources();
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

async function fetchNames(): Promise<{ id: string; name: string }[]> {
  const res = await loadOrderSourceNames();
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/** Every source, matched to the shop now; read only while `active` (the sheet is open). */
export function useOrderSources(active: boolean) {
  return useSWR(active ? SOURCES_KEY : null, fetchSources, { shouldRetryOnError: false, dedupingInterval: 3_000 });
}

/** Every source's id and name. */
export function useOrderSourceNames() {
  return useSWR(NAMES_KEY, fetchNames, { shouldRetryOnError: false, dedupingInterval: 30_000, revalidateOnFocus: false });
}

/** A source saved or deleted: both reads follow. */
export function sourcesChanged(): void {
  void mutate(SOURCES_KEY);
  void mutate(NAMES_KEY);
}
