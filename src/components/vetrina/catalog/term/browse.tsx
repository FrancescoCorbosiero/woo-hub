"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { List, ListItem, NavbarBackLink, Searchbar } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { CatalogPage, CatalogSort } from "@/lib/vetrina/catalog";
import { Search } from "./glyphs";
import { NO_FILTER, searchHref, type ListFilter } from "./list-model";

/** The server caps a search at 100 characters. */
const MAX_QUERY = 100;
/** Typing settles this long before the list is asked again. */
const SEARCH_DELAY_MS = 300;

/**
 * What the owner has chosen on a list screen: the search, the chips, the
 * order, and the facets the chips count from (page 1 of the current query).
 */
export function useListControls(initialFacets: CatalogPage["facets"] | null) {
  const [text, setTextState] = React.useState("");
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<ListFilter>(NO_FILTER);
  const [sort, setSort] = React.useState<CatalogSort>("shop");
  const [facets, setFacets] = React.useState(initialFacets);

  // Clearing the search is at once; typing waits for a pause.
  const setText = React.useCallback((value: string) => {
    setTextState(value);
    if (!value.trim()) setQ("");
  }, []);
  React.useEffect(() => {
    const next = text.trim().slice(0, MAX_QUERY);
    if (!next) return;
    const timer = setTimeout(() => setQ(next), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return { text, setText, q, filter, setFilter, sort, setSort, facets, setFacets };
}

/** The search in the navbar's lower row. 17px text on iOS: the phone does not zoom on focus. */
export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <Searchbar
      value={value}
      placeholder={placeholder}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      onClear={() => onChange("")}
      disableButton
    />
  );
}

/** The navbar's back button: an arrow in a glass circle, so a long title keeps its room. */
export function BackButton({ href, label }: { href: string; label: string }) {
  return <NavbarBackLink component={Link} href={href} aria-label={label} />;
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
