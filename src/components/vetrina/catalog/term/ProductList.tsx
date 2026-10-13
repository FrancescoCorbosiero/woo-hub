"use client";

import * as React from "react";
import { Button, List, Preloader } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { skuKey } from "@/lib/skus";
import { toProductCard, type CatalogPage, type CatalogProduct, type CatalogQuery } from "@/lib/vetrina/catalog";
import { ProductSheet } from "../../ProductSheet";
import { Search, Stack } from "./glyphs";
import { ProductRow } from "./ProductRow";
import { SkeletonRows } from "./TermSkeleton";
import { useCatalogPages, type CatalogPages } from "./use-catalog-pages";
import { useProductCards } from "./use-product-cards";

export interface ProductListProps {
  /** What to list. The list pages through it on its own: no offset, no limit. */
  query: Omit<CatalogQuery, "offset" | "limit">;
  /** Page 1 of that query, read by the server for the first paint. */
  initial?: CatalogPage;
  demo: boolean;
  /** A product's tags changed in its sheet: the screen's own counts may have moved. */
  onProductsChanged?: () => void;
  /** Page 1 of every query, as it arrives: the screen draws its chips from the facets. */
  onFacets?: (facets: CatalogPage["facets"]) => void;
  /** At the right of the list's header (the sort button). */
  toolbar?: React.ReactNode;
  /** Chips are on: an empty list offers to take them off. */
  onClearFilters?: () => void;
  /** Change it to read the rows on screen again, in place (a rule moved products). */
  version?: number;
}

/**
 * A catalog list of products: a category's, a brand's, a quick view's or a
 * search's. Pages arrive as the owner scrolls (with a "Carica altri" twin),
 * thumbnails and live prices from the store's own cards, and a tap opens the
 * product sheet. A new query keeps the old rows on screen, dimmed, until its
 * page 1 arrives, so nothing jumps.
 */
export function ProductList({
  query,
  initial,
  demo,
  onProductsChanged,
  onFacets,
  toolbar,
  onClearFilters,
  version = 0,
}: ProductListProps) {
  const { t } = useI18n();
  const l = t.vetrinaCatalog.term.list;
  const pages = useCatalogPages(query, initial);
  const { loaded, phase, stale, hasMore, loadMore, reload } = pages;

  const ids = React.useMemo(() => loaded.products.map((p) => p.id), [loaded.products]);
  const { cards, refresh: refreshCard } = useProductCards(ids);
  // Locks changed in the sheet since the page was read, by SKU.
  const [locks, setLocks] = React.useState<ReadonlyMap<string, number>>(() => new Map());
  // The product whose sheet is open: kept whole, so the sheet stays even if the list moves under it.
  const [opened, setOpened] = React.useState<CatalogProduct | null>(null);
  const open = React.useCallback((product: CatalogProduct) => setOpened(product), []);

  const facets = stale ? null : loaded.facets;
  React.useEffect(() => {
    if (facets) onFacets?.(facets);
  }, [facets, onFacets]);

  const reloadRows = React.useCallback(() => {
    void reload().then((ok) => {
      if (!ok) toast.error(l.reloadFailed);
    });
  }, [reload, l]);

  const seenVersion = React.useRef(version);
  React.useEffect(() => {
    if (seenVersion.current === version) return;
    seenVersion.current = version;
    reloadRows();
  }, [version, reloadRows]);

  const sentinel = useAutoLoad(phase === "ready" && hasMore, loadMore);
  const empty = loaded.products.length === 0;
  // A count and a sort only over rows: an empty list says so below, and
  // "0 prodotti · Ordina" would only repeat it. The header keeps its height.
  const counted = !empty && phase !== "failed";

  return (
    <>
      <div className="flex min-h-11 items-center gap-2 pe-4 ps-5 pt-2">
        <span className={`text-[13px] font-semibold uppercase tracking-wide opacity-50 transition-opacity ${stale ? "!opacity-25" : ""}`}>
          {counted ? t.vetrinaCatalog.term.products(loaded.total) : "\u00a0"}
        </span>
        {phase === "loading" && <Preloader className="!h-4 !w-4" />}
        {!empty && <span className="ms-auto">{toolbar}</span>}
      </div>

      {phase === "failed" ? (
        <Failure message={l.failed} onRetry={pages.retry} />
      ) : empty && (stale || phase === "loading") ? (
        <SkeletonRows />
      ) : empty ? (
        <Empty q={query.q} onClearFilters={onClearFilters} />
      ) : (
        <List
          strong
          inset
          aria-busy={stale}
          className={`!my-0 transition-opacity duration-200 ${stale ? "pointer-events-none opacity-50" : ""}`}
        >
          {loaded.products.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              card={cards.get(product.id)}
              locks={locks.get(skuKey(product.sku)) ?? product.locks}
              onOpen={open}
            />
          ))}
        </List>
      )}

      <div ref={sentinel} aria-hidden className="h-px" />
      {hasMore && phase !== "failed" && <MoreRow pages={pages} />}

      <ProductSheet
        card={opened ? (cards.get(opened.id) ?? toProductCard(opened)) : null}
        onClose={() => setOpened(null)}
        onLocksChanged={(sku, count) => setLocks((prev) => new Map(prev).set(skuKey(sku), count))}
        onPricesChanged={refreshCard}
        onTagsChanged={() => {
          // Tags move products in and out of automatic categories: this list included.
          reloadRows();
          onProductsChanged?.();
        }}
        demo={demo}
      />
    </>
  );
}

/**
 * Asks for the next page when the end of the list comes near. The Page
 * scrolls, not the window, so it is the observer's root; the margin starts
 * the request well before the last row shows.
 */
function useAutoLoad(enabled: boolean, loadMore: () => void): React.RefObject<HTMLDivElement | null> {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { root: el.closest(".k-page"), rootMargin: "0px 0px 800px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, loadMore]);
  return ref;
}

/** The scroll's button twin, and its spinner: the same height in every state. */
function MoreRow({ pages }: { pages: CatalogPages }) {
  const { t } = useI18n();
  const l = t.vetrinaCatalog.term.list;
  return (
    <div className="flex min-h-14 flex-col items-center justify-center px-4 pt-3 text-[14px]">
      {pages.phase === "more" ? (
        <span className="flex h-11 items-center gap-2 opacity-60">
          <Preloader className="!h-5 !w-5" />
          {l.loadingMore}
        </span>
      ) : pages.phase === "moreFailed" ? (
        <>
          <span className="opacity-60">{l.moreFailed}</span>
          <Button clear rounded inline onClick={pages.loadMore} className="!h-11">
            {l.retry}
          </Button>
        </>
      ) : (
        <Button clear rounded large onClick={pages.loadMore}>
          {l.loadMore}
        </Button>
      )}
    </div>
  );
}

function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-[17px] leading-snug">{message}</p>
      <Button rounded tonal inline onClick={onRetry} className="mt-4 !h-11 !px-6">
        {t.vetrinaCatalog.term.list.retry}
      </Button>
    </div>
  );
}

function Empty({ q, onClearFilters }: { q?: string; onClearFilters?: () => void }) {
  const { t } = useI18n();
  const l = t.vetrinaCatalog.term.list;
  const Icon = q ? Search : Stack;
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="mb-3 grid h-14 w-14 place-items-center rounded-full bg-black/[0.05] dark:bg-white/10" aria-hidden>
        <Icon className="h-7 w-7 opacity-40" />
      </span>
      <p className="text-[17px] font-semibold leading-snug">{q ? l.emptySearch(q) : l.empty}</p>
      {onClearFilters && (
        <>
          <p className="mt-1 text-[15px] leading-snug opacity-60">{l.emptyFiltered}</p>
          <Button rounded tonal inline onClick={onClearFilters} className="mt-4 !h-11 !px-6">
            {l.clearFilters}
          </Button>
        </>
      )}
    </div>
  );
}
