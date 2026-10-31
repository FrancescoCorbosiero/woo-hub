"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Navbar, Page } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { CatalogPage, CatalogQuery, QuickView } from "@/lib/vetrina/catalog";
import type { VetrinaResult } from "@/server/vetrina/service";
import { useChanged } from "../../../use-changed";
import { ErrorState } from "../../ErrorState";
import { ActivityLink } from "../act/ActivityLink";
import { useOperationSettled } from "../act/operations-context";
import { useProductSelection } from "../act/selection";
import { TabbarSpacer } from "../TabbarSpacer";
import { BackButton, SearchEverywhere, SearchField, useListControls, useStart } from "./browse";
import { FilterChips } from "./FilterChips";
import { CheckCircle } from "./glyphs";
import { CATALOG_HOME, filterQuery, hasFilters, NO_FILTER, type ListState } from "./list-model";
import { ProductList } from "./ProductList";
import { SortActions } from "./SortActions";

/** The search, the brand chip and the source chip, as the view's counts know them: "||" is the whole view. */
const countKey = (q: string, within: number | null, source: string | null | undefined) => `${q}|${within ?? ""}|${source ?? ""}`;
const WHOLE_VIEW = countKey("", null, null);

/**
 * A list across categories and brands: sold out, on sale, hidden, without a
 * photo, without a category, not published. One line says what it means on
 * the site; the sources' and brands' chips narrow it, the search looks inside
 * it, and its products can be chosen and acted on together. The hidden
 * products are where the owner checks what to delete: their sources' row
 * always shows, the supplier's products apart, and "Elimina" is in the
 * selection bar. A view with nothing in it is the good news it mostly is:
 * said so, with no search or sort to offer.
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
  const router = useRouter();
  const v = t.vetrinaCatalog.term;
  const about = v.views[view];
  const { start, facets, initial } = useStart(page, served, true);
  const controls = useListControls(facets, start);
  const { q, filter, sort, setFilter } = controls;
  const selection = useProductSelection();
  const refresh = React.useCallback(() => router.refresh(), [router]);

  const query = React.useMemo<CatalogQuery>(
    () => ({ view, q: q || undefined, sort, ...filterQuery(filter) }),
    [view, q, sort, filter],
  );

  // How many the list holds, and for which search, brand and source: the
  // facets of a quick view (status always "all") add up to its total.
  const listKey = countKey(q, filter.within?.id ?? null, filter.source);
  const keyNow = React.useRef(listKey);
  React.useEffect(() => {
    keyNow.current = listKey;
  });
  const [counted, setCounted] = React.useState<{ key: string; total: number } | null>(() =>
    initial ? { key: countKey(start.q, start.within, start.source), total: initial.total } : null,
  );
  const setFacets = controls.setFacets;
  const onFacets = React.useCallback(
    (next: CatalogPage["facets"]) => {
      setFacets(next);
      // The list hands its facets over only once they answer what it shows now.
      setCounted({ key: keyNow.current, total: next.instock + next.outofstock });
    },
    [setFacets],
  );
  // The server read the view again (after an action): its count is the newer word.
  const pageChanged = useChanged(page);
  if (pageChanged && page.ok) setCounted({ key: countKey(served.q, served.within, served.source), total: page.data.total });

  const total = counted?.key === listKey ? counted.total : null;
  const empty = page.ok && listKey === WHOLE_VIEW && counted?.key === WHOLE_VIEW && counted.total === 0;
  // With no list on screen, nothing else hears an action end: the view is read again here.
  useOperationSettled(() => {
    if (empty) refresh();
  });

  return (
    // The search bar's close button waits just past the right edge, scaled
    // to nothing: the page must not scroll sideways to it.
    <Page className="!overflow-x-hidden">
      <Navbar
        title={about.title}
        subtitle={total != null && !empty ? v.products(total) : undefined}
        titleClassName="max-w-[calc(100%-152px)] truncate"
        left={<BackButton href={CATALOG_HOME} label={v.backToCatalog} />}
        right={<ActivityLink />}
        subnavbar={
          empty ? undefined : (
            <SearchField value={controls.text} onChange={controls.setText} placeholder={v.searchView} />
          )
        }
      />

      {empty ? (
        <EmptyView view={view} />
      ) : (
        <>
          {!controls.text.trim() && <p className="px-5 pb-1 pt-3 text-[15px] leading-snug opacity-60">{about.hint}</p>}

          {page.ok ? (
            <>
              {/* A view already is a status: only the sources and the brands narrow it further. */}
              <FilterChips
                facets={controls.facets}
                filter={filter}
                onChange={setFilter}
                taxonomy="category"
                statuses={false}
                sources={view === "hidden"}
              />
              <ProductList
                query={query}
                initial={initial}
                demo={demo}
                onFacets={onFacets}
                toolbar={<SortActions sort={sort} onChange={controls.setSort} />}
                onClearFilters={hasFilters(filter) ? () => setFilter(NO_FILTER) : undefined}
                onProductsChanged={refresh}
                selection={selection}
                listName={about.title}
              />
            </>
          ) : (
            <ErrorState code={page.code} error={page.error} />
          )}

          {q && <SearchEverywhere q={q} />}
        </>
      )}
      <TabbarSpacer />
    </Page>
  );
}

/** Nothing in the view: a tick, and what that means for the shop. */
function EmptyView({ view }: { view: QuickView }) {
  const { t } = useI18n();
  const empty = t.vetrinaCatalog.term.viewsEmpty[view];
  return (
    <div className="flex flex-col items-center px-8 pb-6 pt-16 text-center">
      <span
        aria-hidden
        className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-[#34c759]/15 text-[#248a3d] dark:bg-[#30d158]/20 dark:text-[#30d158]"
      >
        <CheckCircle className="h-9 w-9" />
      </span>
      <p className="text-[20px] font-semibold leading-snug">{empty.title}</p>
      <p className="mt-1.5 max-w-[22rem] text-[15px] leading-snug opacity-60">{empty.text}</p>
    </div>
  );
}
