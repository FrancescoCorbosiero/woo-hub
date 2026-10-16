"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Block, Button, Link as KLink, Navbar, Page, Preloader, Segmented, SegmentedButton } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { CatalogOverview } from "@/lib/vetrina/catalog";
import type { VetrinaResult } from "@/server/vetrina/service";
import { refreshVetrina } from "@/server/actions/vetrina";
import { ErrorState } from "../../ErrorState";
import { ChevronLeft, Refresh } from "../../icons";
import { SEGMENTED_COLORS } from "../../segmented";
import { useStandalone } from "../../sheet-mount";
import { ActivityLink } from "../act/ActivityLink";
import { Plus } from "../act/icons";
import { useOperationSettled } from "../act/operations-context";
import { NewCategorySheet, type NewCategoryRequest } from "../rules/NewCategorySheet";
import { TabbarSpacer } from "../TabbarSpacer";
import { rememberTerms, replaceAddress, SearchField } from "../term/browse";
import { searchWords } from "../term/list-model";
import { readParams, type HomeTab, type TermOrder } from "./model";
import { QuickViewChips } from "./QuickViewChips";
import { SearchResults, revalidateSearches } from "./SearchResults";
import { BrandIndex, CategoryGroups } from "./TermGroups";

/** How long typing must pause before the words are searched. */
const SEARCH_PAUSE_MS = 200;
/** Konsta's large title: scrolled past this, it has folded into the bar. */
const LARGE_TITLE_PX = 52;

/**
 * "Catalogo": the shop by category and brand. The search bar sits under the
 * large title on every visit; typing swaps the lists for what it finds. The
 * list shown (?tab=brand), its order (?sort=count) and the search (?q=) live
 * in the address, so going back, or a link from a category's screen, opens
 * the same view. In the navbar: "Attività" (the log of the actions on
 * products, with "Annulla") and "+" (a new automatic category).
 */
export function CatalogHome({ result }: { result: VetrinaResult<CatalogOverview> }) {
  const { t } = useI18n();
  const h = t.vetrinaCatalog.home;
  const router = useRouter();
  // On the Vetrina's own address the operator Hub is not served: no way back to it.
  const standalone = useStandalone();
  const { tab, order, q: addressQ } = readParams(useSearchParams());
  const [refreshing, startRefresh] = React.useTransition();

  // An action ended: what it changed is already forgotten on the server, so the screen just reads again.
  const refresh = React.useCallback(() => {
    startRefresh(() => router.refresh());
    revalidateSearches();
  }, [router]);
  // ↻: the screens answer from what was read lately; this reads the store and the site again first.
  const refreshAll = React.useCallback(() => {
    startRefresh(async () => {
      await refreshVetrina({ store: true }).catch(() => undefined);
      startRefresh(() => router.refresh());
      revalidateSearches();
    });
  }, [router]);

  const { query, setQuery, searched } = useAddressSearch(addressQ);
  const searching = query.trim() !== "";
  const pageRef = useTopOnSwap(searching);
  const overview = result.ok ? result.data : null;
  const [newRule, setNewRule] = React.useState<NewCategoryRequest | null>(null);

  // An action ended (a hide, a sale…): the counts and the quick views follow.
  useOperationSettled(() => refresh());

  // What the lists know of each term shapes its screen's skeleton, next time it opens.
  React.useEffect(() => {
    if (!overview) return;
    rememberTerms(overview.categories);
    rememberTerms(overview.brands);
  }, [overview]);

  return (
    // The search bar's close button waits just past the right edge, scaled
    // to nothing: the page must not scroll sideways to it.
    <Page ref={pageRef} className="!overflow-x-hidden">
      <Navbar
        large
        transparent
        centerTitle
        title={h.title}
        subtitle={overview?.demo ? t.vetrina.demo : undefined}
        // Folded, the small title stays clear of the side buttons (two on each side, the Hub's link narrowed).
        titleClassName={`truncate ${standalone ? "max-w-[calc(100%-224px)]" : "max-w-[calc(100%-272px)]"}`}
        subtitleClassName="truncate"
        left={
          <>
            {!standalone && (
              <KLink href="/" component="a" className="gap-0.5 !px-2">
                <ChevronLeft className="h-5 w-5" />
                {t.vetrina.backToHub}
              </KLink>
            )}
            <KLink iconOnly onClick={refreshAll} aria-label={t.vetrina.refresh}>
              {refreshing ? <Preloader className="!h-5 !w-5" /> : <Refresh className="h-5 w-5" />}
            </KLink>
          </>
        }
        right={
          <>
            <ActivityLink />
            <KLink iconOnly onClick={() => setNewRule({})} aria-label={h.newRule} aria-haspopup="dialog">
              <Plus className="h-6 w-6" />
            </KLink>
          </>
        }
        subnavbar={<SearchField value={query} onChange={setQuery} placeholder={h.search} />}
      />

      {searching ? (
        <SearchResults
          q={searched}
          typing={searchWords(query) !== searched}
          demo={overview?.demo ?? false}
          onChanged={refresh}
        />
      ) : !result.ok ? (
        <ErrorState code={result.code} error={result.error} />
      ) : result.data.indexProducts === 0 ? (
        <FirstRead refreshing={refreshing} onRetry={refresh} />
      ) : (
        <Lists overview={result.data} tab={tab} order={order} />
      )}

      <TabbarSpacer />
      <NewCategorySheet request={newRule} onClose={() => setNewRule(null)} />
    </Page>
  );
}

function Lists({ overview, tab, order }: { overview: CatalogOverview; tab: HomeTab; order: TermOrder }) {
  const { t } = useI18n();
  const h = t.vetrinaCatalog.home;
  const choose = (next: HomeTab) => {
    if (next !== tab) replaceAddress({ tab: next === "brand" ? "brand" : null });
  };

  return (
    <>
      <div className="px-4 pt-2">
        <Segmented strong rounded colors={SEGMENTED_COLORS}>
          <SegmentedButton className="!h-11" active={tab === "category"} onClick={() => choose("category")}>
            {h.segments.category}
          </SegmentedButton>
          <SegmentedButton className="!h-11" active={tab === "brand"} onClick={() => choose("brand")}>
            {h.segments.brand}
          </SegmentedButton>
        </Segmented>
      </div>
      <div className="pt-2">
        <QuickViewChips views={overview.views} />
      </div>
      {tab === "brand" ? (
        <BrandIndex brands={overview.brands} />
      ) : (
        <CategoryGroups
          categories={overview.categories}
          order={order}
          onOrder={(next) => replaceAddress({ sort: next === "count" ? "count" : null })}
        />
      )}
    </>
  );
}

/**
 * The store index is read for the first time in the background: say so,
 * and look again on our own every few seconds for a couple of minutes (the
 * button is there too).
 */
function FirstRead({ refreshing, onRetry }: { refreshing: boolean; onRetry: () => void }) {
  const { t } = useI18n();
  const f = t.vetrinaCatalog.home.firstRead;

  React.useEffect(() => {
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (tries > 24) window.clearInterval(timer);
      else onRetry();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [onRetry]);

  return (
    <Block strong inset className="flex flex-col items-center gap-3 py-8 text-center">
      <Preloader className="!h-8 !w-8" />
      <p className="text-[17px] font-semibold">{f.title}</p>
      <p className="text-[15px] leading-snug opacity-60">{f.body}</p>
      <Button rounded tonal large disabled={refreshing} onClick={onRetry} className="mt-2">
        {f.retry}
      </Button>
    </Block>
  );
}

/**
 * The search bar's words, and the same words once typing pauses: those are
 * searched and written to the address (?q=). A new ?q= from outside (a link
 * from a category's screen, the tab bar back to the start) replaces them.
 */
function useAddressSearch(addressQ: string) {
  const [query, setQuery] = React.useState(addressQ);
  // No longer than the server takes: a long paste still searches.
  const searched = useSettled(searchWords(query), SEARCH_PAUSE_MS);
  // What the address holds as far as this screen knows: its own writes are not news.
  const known = React.useRef(searchWords(addressQ));
  // The last words searched. Effects can run again with nothing new (a screen
  // Next kept alive in the back comes forward): only a change is written.
  const lastSearched = React.useRef(searched);

  React.useEffect(() => {
    const fromAddress = searchWords(addressQ);
    if (fromAddress === known.current) return;
    known.current = fromAddress;
    setQuery(addressQ);
  }, [addressQ]);

  React.useEffect(() => {
    if (searched === lastSearched.current) return;
    lastSearched.current = searched;
    if (searched === known.current) return;
    known.current = searched;
    replaceAddress({ q: searched || null });
  }, [searched]);

  return { query, setQuery, searched };
}

/**
 * The results replace the lists (and back): from deep in a list, the page
 * comes back up to where the large title has just folded, so what was found
 * starts under the search bar and the bar does not move under the thumb.
 */
function useTopOnSwap(searching: boolean) {
  const pageRef = React.useRef<HTMLElement>(null);
  const was = React.useRef(searching);
  React.useLayoutEffect(() => {
    if (searching === was.current) return;
    was.current = searching;
    const page = pageRef.current;
    if (page && page.scrollTop > LARGE_TITLE_PX) page.scrollTop = LARGE_TITLE_PX;
  }, [searching]);
  return pageRef;
}

/** The value once it has stopped changing for `ms`; the first value at once. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
