"use client";

import * as React from "react";
import useSWR from "swr";
import { useI18n } from "@/i18n/provider";
import type { CatalogSearch } from "@/lib/vetrina/catalog";
import type { ComparedItem, SourceComparison } from "@/lib/vetrina/order-sources";
import { searchCatalog } from "@/server/actions/vetrina-catalog";
import { loadOrderSourceCandidates, pairOrderSourceItem } from "@/server/actions/vetrina-order-sources";
import type { VetrinaResult } from "@/server/vetrina/service";
import { call } from "../act/call";
import {
  ActSheetFrame,
  CARD,
  FailedCard,
  HEADING,
  LoadingRows,
  PickList,
  PickRow,
  SheetBody,
  SheetHead,
  SheetSearch,
  useLastShown,
} from "../act/parts";
import { formatEuro } from "../../format";

/**
 * "Quale prodotto è?": an item of a ranking paired by hand with a product of
 * the shop — one whose name comes close, or one found by searching the shop
 * — or marked as not in the shop (a name that fitted the wrong product), or
 * handed back to the automatic pairing. Saved at once; the comparison is
 * read again.
 */

export interface PairRequest {
  sourceId: string;
  item: ComparedItem;
}

/** How long typing must pause before the shop is searched. */
const SEARCH_PAUSE_MS = 300;
const SHOWN = 20;

type Answer = { q: string; result: VetrinaResult<CatalogSearch> };

async function fetchSearch([, q]: readonly [string, string]): Promise<Answer> {
  try {
    return { q, result: await searchCatalog({ q }) };
  } catch (e) {
    return { q, result: { ok: false, code: "failed", error: e instanceof Error ? e.message : String(e) } };
  }
}

/** One item's candidates, for an item the comparison named none for (it names them for its first open items only). */
async function fetchCandidates([, id, position]: readonly [string, string, number]): Promise<ComparedItem["candidates"]> {
  const res = await loadOrderSourceCandidates({ id, position });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function PairSheet({
  request,
  onClose,
  onPaired,
}: {
  request: PairRequest | null;
  onClose: () => void;
  /** The pairing saved: the comparison as it reads now, and what to say. */
  onPaired: (comparison: SourceComparison, message: string) => void;
}) {
  const shown = useLastShown(request);
  return (
    <ActSheetFrame open={request != null} onClose={onClose}>
      {shown && <PairContent request={shown} onClose={onClose} onPaired={onPaired} />}
    </ActSheetFrame>
  );
}

function PairContent({
  request,
  onClose,
  onPaired,
}: {
  request: PairRequest;
  onClose: () => void;
  onPaired: (comparison: SourceComparison, message: string) => void;
}) {
  const { t, locale } = useI18n();
  const c = t.vetrinaCatalog.sources.compare;
  const p = c.pair;
  const { item, sourceId } = request;
  const label = item.name ?? item.sku ?? "";
  const [text, setText] = React.useState("");
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const words = text.trim();
    const timer = setTimeout(() => setQ(words), words ? SEARCH_PAUSE_MS : 0);
    return () => clearTimeout(timer);
  }, [text]);

  const search = useSWR(q ? (["vetrina-pair-search", q] as const) : null, fetchSearch, { keepPreviousData: true, revalidateOnFocus: false });
  const answer = search.data?.q === q ? search.data.result : null;
  // Not among the comparison's first open items: its candidates asked for now (a failure leaves the search).
  const ask = item.status !== "matched" && item.candidates.length === 0;
  const asked = useSWR(ask ? (["vetrina-pair-candidates", sourceId, item.position] as const) : null, fetchCandidates, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const candidates = item.candidates.length > 0 ? item.candidates : (asked.data ?? []);

  async function pair(pick: number | "none" | "auto", message: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await call(() => pairOrderSourceItem({ id: sourceId, position: item.position, pair: pick }), t.vetrinaCatalog.act.sheet.network);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onClose();
    onPaired(res.data, message);
  }

  const productRow = (product: { id: number; sku: string; name: string; price?: number | null }) => (
    <PickRow
      key={product.id}
      title={product.name}
      subtitle={[product.sku, product.price != null ? formatEuro(product.price, locale) : null].filter(Boolean).join(" · ") || undefined}
      disabled={busy}
      onPick={() => void pair(product.id, p.done(product.name))}
    />
  );

  return (
    <>
      <SheetHead title={p.title} subtitle={p.subtitle(label)} onClose={onClose} />
      <SheetBody>
        {error && (
          <p role="alert" className="px-1 text-[14px] leading-snug text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {item.product && (
          <div>
            <span className={HEADING}>{p.current}</span>
            <p className={`${CARD} px-4 py-3 text-[15px] leading-snug`}>{item.product.name}</p>
          </div>
        )}
        <SheetSearch value={text} onChange={setText} placeholder={p.search} />
        {q ? (
          answer == null ? (
            <LoadingRows label={p.search} />
          ) : !answer.ok ? (
            <FailedCard message={answer.error} onRetry={() => void search.mutate()} />
          ) : answer.data.products.length === 0 ? (
            <p className="px-1 py-4 text-center text-[15px] opacity-60">{p.searchEmpty}</p>
          ) : (
            <PickList label={p.search}>{answer.data.products.slice(0, SHOWN).map(productRow)}</PickList>
          )
        ) : (
          candidates.length > 0 && (
            <div>
              <span className={HEADING}>{p.candidates}</span>
              <PickList label={p.candidates}>{candidates.map(productRow)}</PickList>
            </div>
          )
        )}
        <PickList label={p.title}>
          {!(item.status !== "matched" && item.paired) && (
            <PickRow title={p.none} subtitle={p.noneHint} disabled={busy} onPick={() => void pair("none", p.doneNone)} />
          )}
          {item.paired && <PickRow title={p.auto} subtitle={p.autoHint} disabled={busy} onPick={() => void pair("auto", p.doneAuto)} />}
        </PickList>
      </SheetBody>
    </>
  );
}
