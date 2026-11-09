"use client";

import * as React from "react";
import { Button, Navbar, NavbarBackLink, Page, Preloader } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { MAX_OPERATION_PRODUCTS } from "@/lib/vetrina/catalog-ops";
import type { ComparedItem, SourceComparison, SourceLookup } from "@/lib/vetrina/order-sources";
import { compareOrderSource, lookupOrderSourceItems } from "@/server/actions/vetrina-order-sources";
import type { VetrinaResult } from "@/server/vetrina/service";
import { ErrorState } from "../../ErrorState";
import { formatEuro } from "../../format";
import { ChevronRight } from "../../icons";
import { useBack } from "../../use-back";
import { call } from "../act/call";
import { useOperationSettled } from "../act/operations-context";
import { CARD, ChoiceChip, FILL } from "../act/parts";
import { formatCount } from "../format";
import { TabbarSpacer } from "../TabbarSpacer";
import { Check } from "../term/glyphs";
import { ImportSheet, type ImportPick, type ImportRequest } from "./ImportSheet";
import { PairSheet, type PairRequest } from "./PairSheet";
import { PriceMatchSheet, type PriceMatchRequest } from "./PriceMatchSheet";
import { SourceOrderSheet, type SourceOrderRequest } from "./SourceOrderSheet";

/**
 * A ranking against the shop (/vetrina/catalogo/classifica/…): which of its
 * products the shop has, and at what price against the other shop's.
 *
 * - Prezzi diversi: matched products whose price is off by more than the
 *   threshold (2%) — the chosen ones brought to the other shop's price
 *   ("Allinea", a priceMatch action: locks on the Hub's products, so the
 *   sync keeps them; with "Annulla").
 * - Mancanti: products the shop lacks — imported through Publish; one
 *   without a code is looked up on KicksDB by its name first.
 * - Da verificare: names several products fit — paired by hand.
 * - Tutti: the whole ranking in its order; any entry paired again; and
 *   "Disponi tutto il catalogo così" (sourceOrder).
 *
 * Pairings are saved with the ranking and outlive its next upload.
 */

type Tab = "prices" | "missing" | "uncertain" | "all";

/** Rows a tab shows before "Mostra altri". */
const PAGE = 100;

type LookupState = { state: "loading" } | { state: "done"; result: SourceLookup } | { state: "failed"; error: string };

function firstTab(data: SourceComparison | null): Tab {
  if (!data) return "all";
  if (data.summary.differ > 0) return "prices";
  if (data.summary.missing > 0) return "missing";
  if (data.summary.ambiguous > 0) return "uncertain";
  return "all";
}

export function CompareScreen({ id, result, demo }: { id: string; result: VetrinaResult<SourceComparison>; demo: boolean }) {
  const { t, locale } = useI18n();
  const c = t.vetrinaCatalog.sources.compare;
  const back = useBack("/vetrina/catalogo");
  const [data, setData] = React.useState<SourceComparison | null>(result.ok ? result.data : null);
  const [tab, setTab] = React.useState<Tab>(() => firstTab(result.ok ? result.data : null));
  const [shown, setShown] = React.useState(PAGE);
  // Prices: every one chosen at first, the owner takes some out. Imports: none at first, the owner picks.
  const [priceOff, setPriceOff] = React.useState<ReadonlySet<number>>(new Set());
  const [picked, setPicked] = React.useState<ReadonlyMap<number, string>>(new Map());
  const [lookups, setLookups] = React.useState<ReadonlyMap<number, LookupState>>(new Map());
  const [pairing, setPairing] = React.useState<PairRequest | null>(null);
  const [matching, setMatching] = React.useState<PriceMatchRequest | null>(null);
  const [importing, setImporting] = React.useState<ImportRequest | null>(null);
  const [ordering, setOrdering] = React.useState<SourceOrderRequest | null>(null);
  const [reading, setReading] = React.useState(false);

  const network = t.vetrinaCatalog.act.sheet.network;
  const refresh = React.useCallback(async () => {
    setReading(true);
    const res = await call(() => compareOrderSource({ id }), network);
    setReading(false);
    if (res.ok) setData(res.data);
    else toast.error(res.error);
  }, [id, network]);

  // An action ended (prices matched, the order used, undone): the shop has moved.
  useOperationSettled(() => void refresh());

  const lists = React.useMemo(() => {
    const items = data?.items ?? [];
    return {
      prices: items.filter((i) => i.status === "matched" && i.differs),
      missing: items.filter((i) => i.status === "missing"),
      uncertain: items.filter((i) => i.status === "ambiguous"),
      all: items,
    } satisfies Record<Tab, ComparedItem[]>;
  }, [data]);

  if (!result.ok || !data) {
    const failed = result.ok ? null : result;
    return (
      <Page>
        <Navbar title={c.subtitle} left={<NavbarBackLink onClick={back} text={c.back} />} />
        {failed && <ErrorState code={failed.code} error={failed.error} />}
        <TabbarSpacer />
      </Page>
    );
  }

  const chosenPrices = lists.prices.filter((i) => !priceOff.has(i.position));
  const importPicks: ImportPick[] = lists.missing.flatMap((i) => {
    const sku = picked.get(i.position);
    return sku ? [{ position: i.position, sku, name: i.name ?? sku }] : [];
  });
  const priced = data.items.some((i) => i.price != null);
  const rows = lists[tab];

  function pickable(item: ComparedItem): string | null {
    const lookup = lookups.get(item.position);
    const found = lookup?.state === "done" ? lookup.result.matches : [];
    return item.sku ?? (found.length === 1 ? found[0].sku : null);
  }

  function toggleImport(item: ComparedItem, sku: string | null) {
    setPicked((now) => {
      const next = new Map(now);
      if (next.get(item.position) === sku || sku == null) next.delete(item.position);
      else next.set(item.position, sku);
      return next;
    });
  }

  async function lookup(item: ComparedItem) {
    setLookups((now) => new Map(now).set(item.position, { state: "loading" }));
    const res = await call(() => lookupOrderSourceItems({ id, positions: [item.position] }), network);
    setLookups((now) =>
      new Map(now).set(
        item.position,
        res.ok && res.data[0]
          ? res.data[0].error
            ? { state: "failed", error: res.data[0].error }
            : { state: "done", result: res.data[0] }
          : { state: "failed", error: res.ok ? c.lookupNone : res.error },
      ),
    );
  }

  const tabs: { key: Tab; count: number }[] = [
    { key: "prices", count: lists.prices.length },
    { key: "missing", count: lists.missing.length },
    { key: "uncertain", count: lists.uncertain.length },
    { key: "all", count: lists.all.length },
  ];

  const intro = { prices: c.pricesIntro, missing: c.missingIntro, uncertain: c.uncertainIntro, all: c.allIntro }[tab];
  const empty =
    rows.length === 0
      ? tab === "prices"
        ? priced
          ? c.empty.prices
          : c.empty.pricesUnknown
        : tab === "missing"
          ? c.empty.missing
          : tab === "uncertain"
            ? c.empty.uncertain
            : null
      : null;

  return (
    <Page>
      <Navbar
        title={data.source.name}
        subtitle={c.subtitle}
        titleClassName="truncate max-w-[calc(100%-176px)]"
        left={<NavbarBackLink onClick={back} text={c.back} />}
        right={reading ? <Preloader className="!h-5 !w-5" /> : undefined}
      />
      <div className="space-y-4 px-4 pt-3">
        <div className={`${CARD} px-4 py-3`}>
          <p className="text-[17px] font-semibold leading-snug">{c.summary(data.summary.matched, data.summary.items)}</p>
          <p className="mt-0.5 text-[13px] leading-snug opacity-60">{c.threshold(data.threshold)}</p>
        </div>

        <div role="group" aria-label={c.filter} className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {tabs.map(({ key, count }) => (
            <ChoiceChip
              key={key}
              active={tab === key}
              onClick={() => {
                setTab(key);
                setShown(PAGE);
              }}
            >
              {c.tabs[key]} · {formatCount(count, locale)}
            </ChoiceChip>
          ))}
        </div>

        {rows.length > 0 && <p className="px-1 text-[13px] leading-snug opacity-60">{intro}</p>}
        {tab === "missing" && demo && rows.length > 0 && <p className="px-1 text-[13px] leading-snug opacity-60">{c.demo}</p>}

        {empty ? (
          <p className={`${CARD} px-4 py-3 text-center text-[15px] leading-snug opacity-60`}>{empty}</p>
        ) : (
          <>
            {(tab === "prices" || tab === "missing") && rows.length > 1 && (
              <SelectAll
                all={tab === "prices" ? chosenPrices.length === rows.length : importPicks.length > 0 && importPicks.length === rows.filter((i) => pickable(i)).length}
                count={tab === "prices" ? chosenPrices.length : importPicks.length}
                onAll={() => {
                  if (tab === "prices") setPriceOff(new Set());
                  else setPicked(new Map(rows.flatMap((i) => (pickable(i) ? [[i.position, pickable(i)!] as const] : []))));
                }}
                onNone={() => (tab === "prices" ? setPriceOff(new Set(rows.map((i) => i.position))) : setPicked(new Map()))}
              />
            )}
            <ul className={`${CARD} divide-y divide-black/5 dark:divide-white/10`}>
              {rows.slice(0, shown).map((item) =>
                tab === "prices" ? (
                  <PriceRow
                    key={item.position}
                    item={item}
                    on={!priceOff.has(item.position)}
                    onToggle={() =>
                      setPriceOff((now) => {
                        const next = new Set(now);
                        if (next.has(item.position)) next.delete(item.position);
                        else next.add(item.position);
                        return next;
                      })
                    }
                  />
                ) : tab === "missing" ? (
                  <MissingRow
                    key={item.position}
                    item={item}
                    chosen={picked.get(item.position) ?? null}
                    lookup={lookups.get(item.position) ?? null}
                    onToggle={(sku) => toggleImport(item, sku)}
                    onLookup={() => void lookup(item)}
                    onPair={() => setPairing({ sourceId: id, item })}
                  />
                ) : (
                  <ItemRow key={item.position} item={item} onOpen={() => setPairing({ sourceId: id, item })} />
                ),
              )}
            </ul>
            {rows.length > shown && (
              <Button rounded tonal onClick={() => setShown((n) => n + PAGE)} className="!h-11">
                {c.more(Math.min(PAGE, rows.length - shown))}
              </Button>
            )}
          </>
        )}
      </div>

      {(tab === "prices" && chosenPrices.length > 0) || (tab === "missing" && importPicks.length > 0) || (tab === "all" && data.summary.matched > 0) ? (
        <div className="sticky bottom-[calc(var(--vetrina-tabbar,0px)+12px)] z-10 mt-4 px-4">
          <Button
            large
            rounded
            colors={FILL}
            disabled={tab === "missing" && demo}
            onClick={() => {
              if (tab === "prices") {
                setMatching({
                  source: data.source.name,
                  items: chosenPrices.slice(0, MAX_OPERATION_PRODUCTS).map((i) => ({ productId: i.product!.id, price: i.price! })),
                });
              } else if (tab === "missing") setImporting({ picks: importPicks });
              else setOrdering({ source: { id: data.source.id, name: data.source.name }, term: null });
            }}
            className="w-full shadow-lg"
          >
            <span className="truncate">
              {tab === "prices" ? c.align(chosenPrices.length) : tab === "missing" ? c.import(importPicks.length) : c.useOrder}
            </span>
          </Button>
        </div>
      ) : null}
      <TabbarSpacer />

      <PairSheet
        request={pairing}
        onClose={() => setPairing(null)}
        onPaired={(comparison, message) => {
          setData(comparison);
          toast.success(message);
        }}
      />
      <PriceMatchSheet request={matching} onClose={() => setMatching(null)} />
      <ImportSheet
        request={importing}
        onClose={() => setImporting(null)}
        onDone={() => {
          setPicked(new Map());
          void refresh();
        }}
      />
      <SourceOrderSheet request={ordering} onClose={() => setOrdering(null)} />
    </Page>
  );
}

/** "Seleziona tutti" / "Deseleziona", and how many are chosen. */
function SelectAll({ all, count, onAll, onNone }: { all: boolean; count: number; onAll: () => void; onNone: () => void }) {
  const { t } = useI18n();
  const c = t.vetrinaCatalog.sources.compare;
  return (
    <div className="flex items-center justify-between px-1">
      <span className="text-[13px] tabular-nums opacity-60">{count > 0 ? c.selected(count) : ""}</span>
      <button type="button" onClick={all ? onNone : onAll} className="h-11 px-1 text-[15px] text-primary active:opacity-50">
        {all ? c.selectNone : c.selectAll}
      </button>
    </div>
  );
}

/** A round check, filled when chosen. */
function CheckMark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
        on ? "border-primary bg-primary text-white dark:text-black" : "border-black/20 dark:border-white/25"
      }`}
    >
      {on && <Check className="h-3.5 w-3.5" />}
    </span>
  );
}

const Position = ({ at }: { at: number }) => <span className="mt-0.5 w-9 shrink-0 text-end text-[13px] tabular-nums opacity-45">#{at}</span>;

/** The two prices, and how far apart: red when the shop asks more, green when less. */
function Prices({ theirs, ours, gap }: { theirs: number | null; ours: number | null; gap: number | null }) {
  const { t, locale } = useI18n();
  const c = t.vetrinaCatalog.sources.compare;
  return (
    <span className="shrink-0 text-end text-[13px] leading-snug tabular-nums">
      <span className="block opacity-60">
        {c.theirs} {formatEuro(theirs, locale)}
      </span>
      {ours != null && (
        <span className="block">
          {c.ours} {formatEuro(ours, locale)}
        </span>
      )}
      {gap != null && gap !== 0 && (
        <span className={`block font-semibold ${gap > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>{c.gap(gap)}</span>
      )}
    </span>
  );
}

function notesOf(item: ComparedItem, c: ReturnType<typeof useI18n>["t"]["vetrinaCatalog"]["sources"]["compare"]): string {
  const p = item.product;
  return [
    p && item.name && item.name !== p.name ? `«${item.name}»` : null,
    p?.sku || item.sku || null,
    p?.onSale ? c.onSale : null,
    p && p.status !== "publish" ? c.notPublished : null,
    item.paired ? (p ? c.paired : c.pairedNone) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function PriceRow({ item, on, onToggle }: { item: ComparedItem; on: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const c = t.vetrinaCatalog.sources.compare;
  return (
    <li>
      <button
        type="button"
        aria-pressed={on}
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-start active:bg-black/5 dark:active:bg-white/5"
      >
        <CheckMark on={on} />
        <Position at={item.position} />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[15px] leading-snug">{item.product?.name}</span>
          <span className="mt-0.5 block text-[12px] leading-snug opacity-55">{notesOf(item, c)}</span>
        </span>
        <Prices theirs={item.price} ours={item.product?.price ?? null} gap={item.gap} />
      </button>
    </li>
  );
}

function MissingRow({
  item,
  chosen,
  lookup,
  onToggle,
  onLookup,
  onPair,
}: {
  item: ComparedItem;
  chosen: string | null;
  lookup: LookupState | null;
  onToggle: (sku: string | null) => void;
  onLookup: () => void;
  onPair: () => void;
}) {
  const { t, locale } = useI18n();
  const c = t.vetrinaCatalog.sources.compare;
  const matches = lookup?.state === "done" ? lookup.result.matches : [];
  const own = item.sku;
  const notes = [own ?? c.noSku, item.inCatalog ? c.inCatalog : null, item.paired ? c.pairedNone : null, !own && chosen ? c.chosen(chosen) : null]
    .filter(Boolean)
    .join(" · ");
  const head = (
    <>
      <Position at={item.position} />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[15px] leading-snug">{item.name ?? item.sku}</span>
        <span className="mt-0.5 block text-[12px] leading-snug opacity-55">{notes}</span>
      </span>
      {item.price != null && <span className="shrink-0 text-[13px] tabular-nums opacity-70">{formatEuro(item.price, locale)}</span>}
    </>
  );
  return (
    <li className="py-1">
      {own ? (
        <button
          type="button"
          aria-pressed={chosen != null}
          onClick={() => onToggle(own)}
          className="flex w-full items-start gap-3 px-4 py-2 text-start active:bg-black/5 dark:active:bg-white/5"
        >
          <CheckMark on={chosen != null} />
          {head}
        </button>
      ) : (
        <div className="flex items-start gap-3 px-4 py-2">
          <CheckMark on={chosen != null} />
          {head}
        </div>
      )}
      <div className="flex flex-wrap gap-x-5 ps-[84px] pe-4">
        {!own && lookup?.state !== "done" && (
          <button type="button" disabled={lookup?.state === "loading"} onClick={onLookup} className="h-11 text-[15px] text-primary active:opacity-50 disabled:opacity-50">
            {lookup?.state === "loading" ? c.lookingUp : c.lookup}
          </button>
        )}
        <button type="button" onClick={onPair} className="h-11 text-[15px] text-primary active:opacity-50">
          {c.pairAction}
        </button>
      </div>
      {lookup?.state === "failed" && <p className="ps-[84px] pe-4 pb-2 text-[13px] leading-snug text-red-600 dark:text-red-400">{lookup.error}</p>}
      {lookup?.state === "done" &&
        (matches.length === 0 ? (
          <p className="ps-[84px] pe-4 pb-2 text-[13px] leading-snug opacity-60">{c.lookupNone}</p>
        ) : (
          <div className="ps-[84px] pe-4 pb-2">
            {matches.length > 1 && <p className="pb-1 text-[13px] opacity-60">{c.lookupPick}</p>}
            <ul className="space-y-1">
              {matches.map((m) => (
                <li key={m.sku}>
                  <button
                    type="button"
                    aria-pressed={chosen === m.sku}
                    onClick={() => onToggle(m.sku)}
                    className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-start active:opacity-60 ${
                      chosen === m.sku ? "bg-primary/10" : "bg-black/[0.03] dark:bg-white/5"
                    }`}
                  >
                    {m.image ? (
                      // KicksDB's own picture: a thumbnail, not worth the image optimizer.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.image} alt="" className="h-11 w-11 shrink-0 rounded-lg bg-white object-contain" />
                    ) : (
                      <span className="h-11 w-11 shrink-0 rounded-lg bg-black/5" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] leading-snug">{m.title}</span>
                      <span className="block text-[12px] opacity-55">{[m.sku, m.inCatalog ? c.inCatalog : null].filter(Boolean).join(" · ")}</span>
                    </span>
                    {chosen === m.sku && <Check className="h-5 w-5 shrink-0 text-primary" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </li>
  );
}

/** An entry of the whole ranking (or an uncertain one): tapped, it is paired by hand. */
function ItemRow({ item, onOpen }: { item: ComparedItem; onOpen: () => void }) {
  const { t } = useI18n();
  const c = t.vetrinaCatalog.sources.compare;
  const status = item.status === "matched" ? null : item.status === "ambiguous" ? c.several : c.notInShop;
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 px-4 py-3 text-start active:bg-black/5 dark:active:bg-white/5">
        <Position at={item.position} />
        <span className="min-w-0 flex-1">
          <span className={`block break-words text-[15px] leading-snug ${item.status === "matched" ? "" : "opacity-70"}`}>
            {item.product?.name ?? item.name ?? item.sku}
          </span>
          <span className="mt-0.5 block text-[12px] leading-snug opacity-55">{[status, notesOf(item, c)].filter(Boolean).join(" · ")}</span>
        </span>
        {item.price != null && <Prices theirs={item.price} ours={item.product?.price ?? null} gap={item.differs ? item.gap : null} />}
        <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 opacity-25" />
      </button>
    </li>
  );
}
