"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { List, ListItem, NavbarBackLink, Searchbar } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { CatalogPage, CatalogSort } from "@/lib/vetrina/catalog";
import type { VetrinaResult } from "@/server/vetrina/service";
import { tabOf } from "../../VetrinaTabbar";
import { useBack } from "../../use-back";
import { Search } from "./glyphs";
import {
  listParams,
  readListState,
  sameList,
  searchHref,
  searchWords,
  withParams,
  type ListFilter,
  type ListState,
} from "./list-model";

/** Typing settles this long before the list is asked again. */
const SEARCH_DELAY_MS = 300;

/** The address with some parameters changed, in place: no new history entry, no server round trip, no scroll. */
export function replaceAddress(patch: Record<string, string | null>): void {
  const { pathname, search } = window.location;
  const current = `${pathname}${search}`;
  const next = withParams(current, patch);
  if (next !== current) window.history.replaceState(null, "", next);
}

/** A chosen term from the address, named by the facets; one they do not know (gone from the shop) is let go. */
function namedWithin(id: number | null, facets: CatalogPage["facets"] | null): ListFilter["within"] {
  const found = id != null ? facets?.within.find((f) => f.id === id) : undefined;
  return found ? { id: found.id, name: found.name } : null;
}

/**
 * The list state a screen opens with — the address's, minus a chosen term
 * the facets cannot name — and the server's page 1 when it answers that
 * state. After a step back the address can be newer than the page Next
 * kept: the list then asks for its own page 1.
 */
export function useStart(page: VetrinaResult<CatalogPage>, served: ListState, view = false) {
  const params = useSearchParams();
  const facets = page.ok ? page.data.facets : null;
  const [start] = React.useState<ListState>(() => {
    const fromAddress = readListState(params);
    // A quick view already is a status: only its search, brand and order count.
    const state = view ? { ...fromAddress, status: "all" as const } : fromAddress;
    return { ...state, within: namedWithin(state.within, facets)?.id ?? null };
  });
  return { start, facets, initial: page.ok && sameList(start, served) ? page.data : undefined };
}

/**
 * What the owner has chosen on a list screen: the search, the chips, the
 * order, and the facets the chips count from (page 1 of the current query).
 * It starts from the address and is written back to it as it changes, so
 * going back to the screen, or a reload, opens the list as it was left.
 */
export function useListControls(initialFacets: CatalogPage["facets"] | null, start: ListState) {
  const [text, setTextState] = React.useState(start.q);
  const [q, setQ] = React.useState(start.q);
  const [filter, setFilter] = React.useState<ListFilter>(() => ({
    status: start.status,
    within: namedWithin(start.within, initialFacets),
  }));
  const [sort, setSort] = React.useState<CatalogSort>(start.sort);
  const [facets, setFacets] = React.useState(initialFacets);

  // Clearing the search is at once; typing waits for a pause.
  const setText = React.useCallback((value: string) => {
    setTextState(value);
    if (!value.trim()) setQ("");
  }, []);
  React.useEffect(() => {
    const next = searchWords(text);
    if (!next) return;
    const timer = setTimeout(() => setQ(next), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  React.useEffect(() => {
    replaceAddress(listParams({ q, status: filter.status, within: filter.within?.id ?? null, sort }));
  }, [q, filter, sort]);

  return { text, setText, q, filter, setFilter, sort, setSort, facets, setFacets };
}

// The page's own focus ring would draw a square around the round field.
const NO_RING: React.CSSProperties = { outline: "none" };

/**
 * Konsta's search field takes no input attributes: set the ones a phone
 * needs here. No autocorrect or capitals ("dunk" and "dd1391" are not
 * typos), a "Cerca" key, and a name for screen readers.
 */
function useSearchInput(label: string) {
  const ref = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const input = ref.current?.querySelector("input");
    if (!input) return;
    input.enterKeyHint = "search";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("aria-label", label);
  }, [label]);
  return ref;
}

/**
 * The search in the navbar's lower row, the same on every catalog screen.
 * 17px text on iOS: the phone does not zoom on focus. "Cerca" on the
 * keyboard puts it away, so the results show whole.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const ref = useSearchInput(placeholder);
  return (
    <Searchbar
      ref={ref}
      value={value}
      placeholder={placeholder}
      inputStyle={NO_RING}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      onClear={() => onChange("")}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter") (e.target as HTMLElement).blur();
      }}
      disableButton
    />
  );
}

/** Back goes to the screen before, unless that is the other tab: then to the parent, as a phone's tabs do. */
const sameTab = (previous: string) => tabOf(previous) !== "home";

/**
 * The navbar's back button: an arrow in a glass circle, so a long title keeps
 * its room. It goes back to the screen the owner came from (the search, the
 * Brand list, the section editor); `href`, the parent, is where it goes when
 * there is none, and what a long press opens.
 */
export function BackButton({ href, label }: { href: string; label: string }) {
  const back = useBack(href, sameTab);
  return <NavbarBackLink component={Link} href={href} aria-label={label} onClick={back} />;
}

/** The same button while a screen loads: back, or the catalog's home. */
export function useCatalogBack(fallback: string): (e?: React.MouseEvent) => void {
  return useBack(fallback, sameTab);
}

/**
 * Link props for a Konsta list row: a real href (long press, open in a new
 * tab), but a plain tap navigates inside the app instead of reloading it.
 */
export function useAppLink(): (href: string) => { href: string; onClick: (e: React.MouseEvent) => void } {
  const router = useRouter();
  return React.useCallback(
    (href: string) => ({
      href,
      onClick: (e: React.MouseEvent) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        router.push(href);
      },
    }),
    [router],
  );
}

/** Below a list being searched: the same words over the whole catalog. */
export function SearchEverywhere({ q }: { q: string }) {
  const { t } = useI18n();
  const appLink = useAppLink();
  return (
    <List strong inset className="!mb-2 !mt-4">
      <ListItem
        link
        linkProps={appLink(searchHref(q))}
        media={<Search className="h-5 w-5 opacity-60" />}
        title={<span className="line-clamp-2 text-primary">{t.vetrinaCatalog.term.searchAll(q)}</span>}
      />
    </List>
  );
}
