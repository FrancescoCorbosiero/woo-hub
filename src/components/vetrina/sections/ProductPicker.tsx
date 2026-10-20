"use client";

import * as React from "react";
import { Button, List, Preloader } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { withDescendantIds } from "@/lib/vetrina/sections";
import type { CatalogProduct, CatalogQuery, CatalogTaxonomy } from "@/lib/vetrina/catalog";
import { Pin } from "../icons";
import { useCatalogOverview } from "../catalog/act/data";
import { Warning } from "../catalog/act/icons";
import {
  ActSheetFrame,
  ChoiceChip,
  FailedCard,
  LoadingRows,
  ModeSwitch,
  PrimaryButton,
  SheetBody,
  SheetFooter,
  SheetHead,
  SheetSearch,
} from "../catalog/act/parts";
import { SHEET_LIST_COLORS } from "../catalog/sheet/look";
import { ProductRow } from "../catalog/term/ProductRow";
import { useCatalogPages } from "../catalog/term/use-catalog-pages";
import { useProductCards } from "../catalog/term/use-product-cards";

/**
 * "Aggiungi prodotti": a homepage section's products chosen from the whole
 * catalog, from the section editor — searched by name or SKU, the newest or
 * best sellers first. What may join depends on what fills the section: any
 * product for a section of a category filled by hand (those not in it join
 * the category when the section is published) or a shop-wide list; the
 * category's own products for one a rule fills; the brand's for a brand's;
 * those on sale for the list of what is on sale. The chosen ones go on top,
 * pinned, in the order chosen — into the editor's draft: nothing reaches the
 * site before "Pubblica".
 */

export interface PickerSection {
  title: string;
  /** What fills it: what may join, and how the sheet says so. */
  fill: "category" | "automatic" | "brand" | "sale" | "list";
  /** Its one category or brand. */
  term: { taxonomy: CatalogTaxonomy; id: number; name: string } | null;
}

export interface PickedProduct {
  product: CatalogProduct;
  /** Not in the section's category yet: it joins it when the section is published. */
  joins: boolean;
}

export type PickPlace = "top" | "afterPins";

type PickerSort = "newest" | "bestselling" | "name";

export function ProductPicker({
  open,
  section,
  shown,
  pinned,
  room,
  maxPins,
  onClose,
  onAdd,
}: {
  open: boolean;
  section: PickerSection;
  /** The products the section shows now: id → its place (1-based). */
  shown: ReadonlyMap<number, number>;
  pinned: ReadonlySet<number>;
  /** Pins the section may still take. */
  room: number;
  maxPins: number;
  onClose: () => void;
  onAdd: (picked: PickedProduct[], place: PickPlace) => void;
}) {
  return (
    <ActSheetFrame open={open} onClose={onClose}>
      {open && (
        <PickerContent
          section={section}
          shown={shown}
          pinned={pinned}
          room={room}
          maxPins={maxPins}
          onClose={onClose}
          onAdd={onAdd}
        />
      )}
    </ActSheetFrame>
  );
}

function PickerContent({
  section,
  shown,
  pinned,
  room,
  maxPins,
  onClose,
  onAdd,
}: {
  section: PickerSection;
  shown: ReadonlyMap<number, number>;
  pinned: ReadonlySet<number>;
  room: number;
  maxPins: number;
  onClose: () => void;
  onAdd: (picked: PickedProduct[], place: PickPlace) => void;
}) {
  const { t } = useI18n();
  const p = t.vetrinaCatalog.picker;
  const [text, setText] = React.useState("");
  const q = useDebounced(text.trim(), 250);
  const [sort, setSort] = React.useState<PickerSort>("newest");
  const [inStock, setInStock] = React.useState(true);
  const [onSale, setOnSale] = React.useState(false);
  const [place, setPlace] = React.useState<PickPlace>("top");
  // In the order picked: that is their order on top of the section.
  const [chosen, setChosen] = React.useState<CatalogProduct[]>([]);
  const chosenIds = React.useMemo(() => new Set(chosen.map((c) => c.id)), [chosen]);

  // A brand's section, a rule's, the list of sales: only what it can show is offered.
  const query = React.useMemo<CatalogQuery>(() => {
    const scoped =
      (section.fill === "brand" || section.fill === "automatic") && section.term
        ? { taxonomy: section.term.taxonomy, termId: section.term.id }
        : {};
    return {
      ...scoped,
      q: q || undefined,
      sort,
      stock: inStock ? "instock" : undefined,
      onSale: section.fill === "sale" || onSale ? true : undefined,
    };
  }, [section, q, sort, inStock, onSale]);
  const pages = useCatalogPages(query);
  const { loaded, phase, stale, hasMore } = pages;
  const ids = React.useMemo(() => loaded.products.map((product) => product.id), [loaded.products]);
  const { cards } = useProductCards(ids);

  // A category filled by hand takes anyone: those outside it (and its sub-categories) join it.
  const overview = useCatalogOverview();
  const members = React.useMemo(() => {
    if (section.fill !== "category" || !section.term || !overview.data) return null;
    const children = new Map(overview.data.categories.map((c) => [c.id, c.children]));
    return withDescendantIds(section.term.id, children);
  }, [section, overview.data]);
  const joins = React.useCallback(
    (product: CatalogProduct) =>
      section.fill === "category" && members != null && !shown.has(product.id) && !product.categories.some((c) => members.has(c.id)),
    [section.fill, members, shown],
  );

  const full = chosen.length >= room;
  function toggle(product: CatalogProduct) {
    setChosen((list) => {
      if (list.some((c) => c.id === product.id)) return list.filter((c) => c.id !== product.id);
      return list.length >= room ? list : [...list, product];
    });
  }

  const hasPins = pinned.size > 0;
  const intro =
    section.fill === "category" && section.term
      ? p.intro.category(section.term.name)
      : section.fill === "automatic" && section.term
        ? p.intro.automatic(section.term.name)
        : section.fill === "brand" && section.term
          ? p.intro.brand(section.term.name)
          : section.fill === "sale"
            ? p.intro.sale
            : p.intro.list;

  return (
    <>
      <SheetHead title={p.title(section.title)} subtitle={intro} onClose={onClose} />
      <SheetBody footer>
        <div className="space-y-2">
          <SheetSearch value={text} onChange={setText} placeholder={p.search} />
          <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4" role="group" aria-label={p.filtersLabel}>
            {(["newest", "bestselling", "name"] as const).map((option) => (
              <ChoiceChip key={option} active={sort === option} onClick={() => setSort(option)}>
                {p.sort[option]}
              </ChoiceChip>
            ))}
            <span className="mx-1 h-5 w-px shrink-0 bg-black/10 dark:bg-white/15" aria-hidden />
            <ChoiceChip active={inStock} onClick={() => setInStock((v) => !v)}>
              {p.filters.instock}
            </ChoiceChip>
            {section.fill !== "sale" && (
              <ChoiceChip active={onSale} onClick={() => setOnSale((v) => !v)}>
                {p.filters.onSale}
              </ChoiceChip>
            )}
          </div>
        </div>

        {phase === "failed" && loaded.products.length === 0 ? (
          <FailedCard message={p.failed} onRetry={pages.retry} />
        ) : phase === "loading" && loaded.products.length === 0 ? (
          <LoadingRows label={p.loading} />
        ) : loaded.products.length === 0 && !stale ? (
          <p className="px-1 py-8 text-center text-[15px] opacity-60">{q ? p.emptySearch(q) : p.empty}</p>
        ) : (
          <div>
            <List
              strong
              inset
              dividers
              colors={SHEET_LIST_COLORS}
              aria-busy={stale}
              className={`!mx-0 !my-0 transition-opacity duration-200 ${stale ? "pointer-events-none opacity-50" : ""}`}
            >
              {loaded.products.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  card={cards.get(product.id)}
                  locks={product.locks}
                  onOpen={toggle}
                  selecting
                  selected={chosenIds.has(product.id)}
                  onToggle={toggle}
                  note={<RowNote product={product} place={shown.get(product.id)} pinned={pinned.has(product.id)} joins={joins(product)} term={section.term?.name ?? ""} />}
                />
              ))}
            </List>
            {(hasMore || phase === "more" || phase === "moreFailed") && (
              <div className="mt-2 flex justify-center">
                <Button clear rounded inline disabled={phase === "more"} onClick={pages.loadMore} className="!h-11">
                  {phase === "more" ? (
                    <span className="flex items-center gap-2">
                      <Preloader className="!h-4 !w-4" />
                      {p.loadingMore}
                    </span>
                  ) : (
                    p.loadMore
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </SheetBody>
      <SheetFooter error={full && chosen.length > 0 ? p.room(maxPins) : null}>
        {hasPins && chosen.length > 0 && (
          <ModeSwitch
            value={place}
            onChange={setPlace}
            label={p.place.label}
            className=""
            options={[
              { value: "top", label: p.place.top },
              { value: "afterPins", label: p.place.afterPins },
            ]}
          />
        )}
        <div className="flex items-center gap-3">
          {chosen.length > 0 && (
            <Button clear rounded inline onClick={() => setChosen([])} className="!h-11 shrink-0 !px-3">
              {p.clear}
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <PrimaryButton
              disabled={chosen.length === 0}
              onClick={() => {
                onAdd(
                  chosen.map((product) => ({ product, joins: joins(product) })),
                  hasPins ? place : "top",
                );
                onClose();
              }}
            >
              {p.start(chosen.length)}
            </PrimaryButton>
          </div>
        </div>
        <span className="sr-only" aria-live="polite">
          {p.picked(chosen.length)}
        </span>
      </SheetFooter>
    </>
  );
}

/** What the section has to do with this product: in it already (where), pinned, joining its category, or not to be seen. */
function RowNote({
  product,
  place,
  pinned,
  joins,
  term,
}: {
  product: CatalogProduct;
  place: number | undefined;
  pinned: boolean;
  joins: boolean;
  term: string;
}) {
  const { t } = useI18n();
  const p = t.vetrinaCatalog.picker;
  const parts: React.ReactNode[] = [];
  if (pinned) {
    parts.push(
      <span key="pinned" className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400">
        <Pin className="h-3 w-3" />
        {p.pinned}
      </span>,
    );
  } else if (place != null) {
    parts.push(
      <span key="shown" className="font-medium text-primary">
        {p.shown(place)}
      </span>,
    );
  }
  if (joins) parts.push(<span key="joins" className="font-medium text-[#8a6b00] dark:text-[#e8c35a]">{p.joins(term)}</span>);
  if (product.visibility === "hidden" || product.status !== "publish") {
    parts.push(<span key="hidden" className="opacity-60">{p.hidden}</span>);
  } else if (product.stockStatus === "outofstock") {
    parts.push(
      <span key="soldout" className="inline-flex items-center gap-1 text-orange-700 dark:text-orange-400">
        <Warning className="h-3 w-3" />
        {p.soldOut}
      </span>,
    );
  }
  if (parts.length === 0) return null;
  return <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">{parts}</span>;
}

/** The value, once it has stayed the same for `ms`: a search does not ask at every letter. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
