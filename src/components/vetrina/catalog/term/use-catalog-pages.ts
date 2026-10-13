"use client";

import * as React from "react";
import type { CatalogPage, CatalogQuery } from "@/lib/vetrina/catalog";
import { loadCatalogPage } from "@/server/actions/vetrina-catalog";
import type { VetrinaResult } from "@/server/vetrina/service";
import { appendPage, fromPage, joinPages, queryKey, sliceRequests, type Loaded } from "./list-model";

/**
 * - ready: nothing in flight;
 * - loading: page 1 of a new query (the old rows stay on screen, dimmed);
 * - more: the next page;
 * - failed: page 1 did not come; moreFailed: the next page did not.
 */
export type PagesPhase = "ready" | "loading" | "more" | "failed" | "moreFailed";

interface PagesState {
  loaded: Loaded;
  phase: PagesPhase;
}

export interface CatalogPages {
  loaded: Loaded;
  phase: PagesPhase;
  /** The rows on screen answer an older query: the new one is on its way. */
  stale: boolean;
  hasMore: boolean;
  /** The next page; after a failure, the same page again. */
  loadMore: () => void;
  /** Page 1 again, after it failed. */
  retry: () => void;
  /** Read the rows already shown again, in place: no jump, no spinner. False when it could not. */
  reload: () => Promise<boolean>;
}

/** A request that never reached the server (offline, a deploy) answers like any other failure. */
async function fetchPage(query: CatalogQuery): Promise<VetrinaResult<CatalogPage>> {
  try {
    return await loadCatalogPage(query);
  } catch (e) {
    return { ok: false, code: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * A catalog list, page by page. A new query reads page 1 again; every request
 * takes a ticket and only the latest one's answer is kept, so typing fast or
 * tapping chips never shows an older list over a newer one.
 */
export function useCatalogPages(query: CatalogQuery, initial?: CatalogPage): CatalogPages {
  const key = queryKey(query);
  const [state, setState] = React.useState<PagesState>(() =>
    initial
      ? { loaded: fromPage(query, initial), phase: "ready" }
      : { loaded: { key: "", query, products: [], total: 0, facets: null }, phase: "loading" },
  );
  const ticket = React.useRef(0);
  // A request is in flight: the sentinel and the button must not ask twice.
  const busy = React.useRef(false);
  // The query the list shows, or is about to.
  const wanted = React.useRef<string | null>(initial ? key : null);

  const loadFirst = React.useCallback(async (q: CatalogQuery) => {
    const mine = ++ticket.current;
    busy.current = true;
    setState((s) => ({ ...s, phase: "loading" }));
    const res = await fetchPage({ ...q, offset: 0 });
    if (mine !== ticket.current) return;
    busy.current = false;
    setState((s) => (res.ok ? { loaded: fromPage(q, res.data), phase: "ready" } : { ...s, phase: "failed" }));
  }, []);

  React.useEffect(() => {
    if (wanted.current === key) return;
    wanted.current = key;
    void loadFirst(query);
  }, [key, query, loadFirst]);

  const { loaded, phase } = state;
  const stale = loaded.key !== key;
  const hasMore = !stale && loaded.products.length < loaded.total;

  const loadMore = React.useCallback(() => {
    if (busy.current || (phase !== "ready" && phase !== "moreFailed") || !hasMore) return;
    busy.current = true;
    const mine = ticket.current;
    setState((s) => ({ ...s, phase: "more" }));
    void fetchPage({ ...loaded.query, offset: loaded.products.length }).then((res) => {
      // A new query, or a reload, took over meanwhile.
      if (mine !== ticket.current) return;
      busy.current = false;
      setState((s) => (res.ok ? { loaded: appendPage(s.loaded, res.data), phase: "ready" } : { ...s, phase: "moreFailed" }));
    });
  }, [phase, hasMore, loaded]);

  const retry = React.useCallback(() => void loadFirst(query), [query, loadFirst]);

  const reload = React.useCallback(async () => {
    if (stale) return true; // page 1 of a newer query is on its way anyway
    const mine = ++ticket.current;
    busy.current = true;
    const answers = await Promise.all(
      sliceRequests(loaded.products.length).map((slice) => fetchPage({ ...loaded.query, ...slice })),
    );
    if (mine !== ticket.current) return true;
    busy.current = false;
    const pages = answers.flatMap((a) => (a.ok ? [a.data] : []));
    const ok = pages.length === answers.length;
    // A page in flight was dropped for this reload: the list is ready again either way.
    setState((s) =>
      ok ? { loaded: joinPages(loaded.query, pages), phase: "ready" } : { ...s, phase: s.phase === "more" ? "ready" : s.phase },
    );
    return ok;
  }, [stale, loaded]);

  return { loaded, phase, stale, hasMore, loadMore, retry, reload };
}
