"use client";

import * as React from "react";
import { Navbar, Page } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { CatalogPage, CatalogQuery, QuickView } from "@/lib/vetrina/catalog";
import type { VetrinaResult } from "@/server/vetrina/service";
import { ErrorState } from "../../ErrorState";
import { TabbarSpacer } from "../TabbarSpacer";
import { BackButton, SearchEverywhere, SearchField, useListControls, useStart } from "./browse";
import { FilterChips } from "./FilterChips";
import { CATALOG_HOME, filterQuery, hasFilters, NO_FILTER, type ListState } from "./list-model";
import { ProductList } from "./ProductList";
import { SortActions } from "./SortActions";

/**
 * A list across categories and brands: sold out, on sale, hidden, without a
 * photo, without a category, not published. One line says what it means on
 * the site; the brands chips narrow it, the search looks inside it.
 */
export function QuickViewScreen({
  view,
  page,
  served,
  demo,
}: {
  view: QuickView;
  /** Page 1 of the list, read by the server. */
  page: VetrinaResult<CatalogPage>;
  /** The list state (search, brand, order) that page answers. */
  served: ListState;
  demo: boolean;
}) {
  const { t } = useI18n();
  const v = t.vetrinaCatalog.term;
  const about = v.views[view];
  const { start, facets, initial } = useStart(page, served, true);
  const controls = useListControls(facets, start);
  const { q, filter, sort, setFilter } = controls;

  const query = React.useMemo<CatalogQuery>(
    () => ({ view, q: q || undefined, sort, ...filterQuery(filter) }),
    [view, q, sort, filter],
  );

  return (
    // The search bar's close button waits just past the right edge, scaled
    // to nothing: the page must not scroll sideways to it.
    <Page className="!overflow-x-hidden">
      <Navbar
        title={about.title}
        subtitle={initial ? v.products(initial.total) : undefined}
        titleClassName="max-w-[calc(100%-152px)] truncate"
        left={<BackButton href={CATALOG_HOME} label={v.backToCatalog} />}
        subnavbar={<SearchField value={controls.text} onChange={controls.setText} placeholder={v.searchView} />}
      />

      {!controls.text.trim() && <p className="px-5 pb-1 pt-3 text-[15px] leading-snug opacity-60">{about.hint}</p>}

      {page.ok ? (
        <>
          {/* A view already is a status: only the brands narrow it further. */}
          <FilterChips facets={controls.facets} filter={filter} onChange={setFilter} taxonomy="category" statuses={false} />
          <ProductList
            query={query}
            initial={initial}
            demo={demo}
            onFacets={controls.setFacets}
            toolbar={<SortActions sort={sort} onChange={controls.setSort} />}
            onClearFilters={hasFilters(filter) ? () => setFilter(NO_FILTER) : undefined}
          />
        </>
      ) : (
        <ErrorState code={page.code} error={page.error} />
      )}

      {q && <SearchEverywhere q={q} />}
      <TabbarSpacer />
    </Page>
  );
}
