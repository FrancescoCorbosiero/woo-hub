"use client";

import * as React from "react";
import useSWR, { mutate as revalidate } from "swr";
import { Block, BlockTitle, Button, List, ListButton, Preloader } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { skuKey } from "@/lib/skus";
import { toProductCard, type CatalogProduct, type CatalogSearch } from "@/lib/vetrina/catalog";
import type { ProductCard } from "@/lib/vetrina/types";
import type { VetrinaResult } from "@/server/vetrina/service";
import { loadVetrinaCards } from "@/server/actions/vetrina";
import { loadCatalogPage, searchCatalog } from "@/server/actions/vetrina-catalog";
import { ProductSheet } from "../../ProductSheet";
import { ProductRow } from "../term/ProductRow";
import { TermRow } from "./TermGroups";
import { formatCount } from "./ui";

/**
 * The catalog's search, in place of the lists: categories, brands and
 * products found at once. A term opens its screen; a product opens the
 * product sheet, as in the section editor.
 *
 * Answers are kept per query (SWR), so going back to a word is instant, and
 * an answer that arrives after the words have changed is never shown. While
 * a new answer is on its way the last one stays, dimmed: the screen does not
 * jump at every letter.
 */

const SEARCH_KEY = "vetrina-catalog-search";
/** Products asked per page after the first answer's 20. */
const MORE_PAGE = 40;

type Answer = { q: string; result: VetrinaResult<CatalogSearch> };

/** Never throws: a lost connection is an answer too, shown with "Riprova". */
async function fetchSearch([, q]: readonly [string, string]): Promise<Answer> {
  try {
    return { q, result: await searchCatalog({ q }) };
  } catch (e) {
    return { q, result: { ok: false, code: "failed", error: e instanceof Error ? e.message : String(e) } };
  }
}

/** Reads every search kept so far again (the navbar's refresh). */
export function revalidateSearches(): void {
  void revalidate((key) => Array.isArray(key) && key[0] === SEARCH_KEY);
}

/** Products past the first answer's, for one query: what is loaded, and where readPage stopped. */
interface More {
  q: string;
  products: CatalogProduct[];
  offset: number;
  total: number;
}

export function SearchResults({
  q,
  typing,
  demo,
  onChanged,
}: {
  /** The words searched (trimmed); "" while the first ones are being typed. */
  q: string;
  /** The search bar holds other words than q: an answer is coming. */
  typing: boolean;
  demo: boolean;
  /** A product's tags changed in its sheet: the counts may have moved. */
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const r = t.vetrinaCatalog.home.results;
  const { data, mutate } = useSWR(q ? ([SEARCH_KEY, q] as const) : null, fetchSearch, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });
  const current = data != null && data.q === q && !typing;

  const [more, setMore] = React.useState<More | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const found = data?.result.ok ? data.result.data : null;
  const products = React.useMemo(() => {
    if (!found || !data) return [];
    return more && more.q === data.q ? [...found.products, ...more.products] : found.products;
  }, [found, data, more]);

  const { cards, locks, fetchCards, setLocks } = useCards(products);
  const [open, setOpen] = React.useState<CatalogProduct | null>(null);

  async function loadMore() {
    if (!found || !data) return;
    const forQ = data.q;
    const from = more?.q === forQ ? more : { q: forQ, products: [], offset: 0, total: found.totalProducts };
    setLoadingMore(true);
    try {
      // The first answer's products are ranked; the rest come by name, minus
      // those already shown, so nothing moves and nothing repeats.
      const res = await loadCatalogPage({ q: forQ, sort: "name", offset: from.offset, limit: MORE_PAGE });
      if (!res.ok) {
        toast.error(t.vetrina.errors[res.code] ?? res.error);
        return;
      }
      const shown = new Set([...found.products, ...from.products].map((p) => p.id));
      setMore({
        q: forQ,
        products: [...from.products, ...res.data.products.filter((p) => !shown.has(p.id))],
        offset: from.offset + res.data.products.length,
        total: res.data.total,
      });
    } catch {
      toast.error(t.vetrina.errors.failed);
    } finally {
      setLoadingMore(false);
    }
  }

  if (!data) return <ResultsSkeleton />;

  if (!data.result.ok) {
    return (
      <Block strong inset className={`space-y-3 text-center ${current ? "" : "opacity-50"}`}>
        <p className="text-[17px]">{r.failed}</p>
        <Button rounded tonal onClick={() => void mutate()}>
          {r.retry}
        </Button>
        <p className="break-words text-[13px] opacity-50">{data.result.error}</p>
      </Block>
    );
  }

  const s = data.result.data;
  const nothing = s.categories.length + s.brands.length + s.products.length === 0;
  const finished = more?.q === data.q && more.offset >= more.total;
  const remaining = finished ? 0 : Math.max(0, s.totalProducts - products.length);

  return (
    <>
      <div aria-busy={!current} className={`transition-opacity duration-200 ${current ? "" : "opacity-50"}`}>
        {nothing ? (
          <Block strong inset className="space-y-1.5 text-center">
            <p className="text-[17px] font-semibold">{r.none(data.q)}</p>
            <p className="text-[15px] opacity-60">{r.hint}</p>
          </Block>
        ) : (
          <>
            {s.categories.length > 0 && (
              <>
                <BlockTitle>{r.categories}</BlockTitle>
                <List strong inset>
                  {s.categories.map((term) => (
                    <TermRow key={term.id} term={term} title={term.path} homeMark />
                  ))}
                </List>
              </>
            )}
            {s.brands.length > 0 && (
              <>
                <BlockTitle>{r.brands}</BlockTitle>
                <List strong inset>
                  {s.brands.map((term) => (
                    <TermRow key={term.id} term={term} title={term.path} homeMark />
                  ))}
                </List>
              </>
            )}
            {products.length > 0 && (
              <>
                <BlockTitle>
                  <span>{r.products}</span>
                  <CountLabel n={s.totalProducts} />
                </BlockTitle>
                <List strong inset>
                  {products.map((p) => (
                    // The same row as a category's list: one look for a product everywhere.
                    <ProductRow
                      key={p.id}
                      product={p}
                      card={cards.get(p.id)}
                      locks={locks[skuKey(p.sku)] ?? p.locks}
                      onOpen={setOpen}
                    />
                  ))}
                  {remaining > 0 && (
                    <ListButton onClick={() => void loadMore()}>
                      {loadingMore ? (
                        <Preloader className="!h-5 !w-5" />
                      ) : more?.q === data.q ? (
                        r.showMore(remaining)
                      ) : (
                        r.showAll(s.totalProducts)
                      )}
                    </ListButton>
                  )}
                </List>
              </>
            )}
          </>
        )}
      </div>

      <ProductSheet
        card={open ? (cards.get(open.id) ?? toProductCard(open)) : null}
        onClose={() => setOpen(null)}
        onLocksChanged={(sku, count) => setLocks((prev) => ({ ...prev, [skuKey(sku)]: count }))}
        onPricesChanged={(id) => fetchCards([id])}
        onTagsChanged={onChanged}
        demo={demo}
      />
    </>
  );
}

function CountLabel({ n }: { n: number }) {
  const { locale } = useI18n();
  return <span className="text-[15px] font-normal tabular-nums opacity-55">{formatCount(n, locale)}</span>;
}

/**
 * The store's own cards for the products on screen: the thumbnail (never
 * the full photo), the live price and the Hub's locks. Each product is asked
 * for once, so a failing request cannot loop.
 */
function useCards(products: CatalogProduct[]) {
  const [cards, setCards] = React.useState(() => new Map<number, ProductCard>());
  const [locks, setLocks] = React.useState<Record<string, number>>({});
  const requested = React.useRef(new Set<number>());

  // A batch that fails leaves its rows on the neutral placeholder.
  const fetchCards = React.useCallback((ids: number[]) => {
    loadVetrinaCards({ ids })
      .then((res) => {
        if (!res.ok) return;
        setCards((prev) => {
          const next = new Map(prev);
          for (const c of res.data.cards) next.set(c.id, c);
          return next;
        });
        setLocks((prev) => ({ ...prev, ...res.data.locks }));
      })
      .catch(() => undefined);
  }, []);

  const wantedKey = products
    .filter((p) => !cards.has(p.id) && !requested.current.has(p.id))
    .slice(0, 100)
    .map((p) => p.id)
    .join(",");
  React.useEffect(() => {
    if (!wantedKey) return;
    const ids = wantedKey.split(",").map(Number);
    for (const id of ids) requested.current.add(id);
    fetchCards(ids);
  }, [wantedKey, fetchCards]);

  return { cards, locks, fetchCards, setLocks };
}

/** The first search's place holder: the shape of a few results, nothing that jumps when they come. */
function ResultsSkeleton() {
  return (
    <div aria-hidden className="animate-pulse">
      <div className="mx-4 mt-8 h-4 w-24 rounded-full bg-black/10 dark:bg-white/10" />
      <List strong inset className="!mt-3">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="flex items-center gap-4 py-2 ps-4 pe-4">
            <span className="h-16 w-16 shrink-0 rounded-xl bg-black/[0.06] dark:bg-white/10" />
            <span className="flex-1 space-y-2">
              <span className="block h-3.5 w-3/4 rounded-full bg-black/10 dark:bg-white/10" />
              <span className="block h-3 w-1/3 rounded-full bg-black/[0.07] dark:bg-white/[0.07]" />
            </span>
          </li>
        ))}
      </List>
    </div>
  );
}
