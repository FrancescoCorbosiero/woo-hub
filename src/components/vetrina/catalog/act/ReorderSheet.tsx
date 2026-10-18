"use client";

import * as React from "react";
import { Reorder, useDragControls } from "motion/react";
import { Button, Preloader } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { CATALOG_PAGE_MAX, isListed, type CatalogProduct } from "@/lib/vetrina/catalog";
import type { OperationInput, OperationView } from "@/lib/vetrina/catalog-ops";
import type { ProductCard } from "@/lib/vetrina/types";
import { loadCatalogPage } from "@/server/actions/vetrina-catalog";
import { Grip } from "../../icons";
import { useProductCards } from "../term/use-product-cards";
import { call } from "./call";
import { ToTop } from "./icons";
import { movedCount, movedPrefix } from "./model";
import type { OrderTerm } from "./OrderSheet";
import {
  ActSheetFrame,
  buttonCount,
  CARD,
  FailedCard,
  LoadingRows,
  PreviewView,
  PrimaryButton,
  SheetBody,
  SheetFooter,
  SheetHead,
  useLastShown,
  usePreview,
  useStartAction,
} from "./parts";

/**
 * "Riordina": a category's or brand's first products in the shop's order —
 * the order its page on the shop follows — dragged by the handle, or sent
 * to the top, as the section editor orders a homepage section. "Salva
 * l'ordine" shows the preview (the products moved, what to know), then
 * starts one "Ordina" over the rows down to the last one that moved: the
 * products below keep their order, and only the products that must change
 * are written.
 */
export function ReorderSheet({
  term,
  onClose,
  onStarted,
}: {
  /** The category or brand; null = closed. */
  term: OrderTerm | null;
  onClose: () => void;
  onStarted?: (view: OperationView) => void;
}) {
  const shown = useLastShown(term);
  return (
    <ActSheetFrame open={term != null} onClose={onClose}>
      {shown && <ReorderContent key={`${shown.taxonomy}:${shown.id}`} term={shown} onClose={onClose} onStarted={onStarted} />}
    </ActSheetFrame>
  );
}

/** The rows read so far, in the shop's order as it was read. */
interface Loaded {
  products: CatalogProduct[];
  total: number;
}

function ReorderContent({
  term,
  onClose,
  onStarted,
}: {
  term: OrderTerm;
  onClose: () => void;
  onStarted?: (view: OperationView) => void;
}) {
  const { t } = useI18n();
  const r = t.vetrinaCatalog.act.reorder;
  const network = t.vetrinaCatalog.act.sheet.network;
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [ids, setIds] = React.useState<number[]>([]);
  const [confirming, setConfirming] = React.useState(false);

  const read = React.useCallback(
    async (offset: number) => {
      const res = await call(
        () => loadCatalogPage({ taxonomy: term.taxonomy, termId: term.id, sort: "shop", offset, limit: CATALOG_PAGE_MAX }),
        network,
      );
      if (!res.ok) {
        setFailed(res.error);
        return;
      }
      setFailed(null);
      setLoaded((prev) => {
        const products = offset === 0 || !prev ? res.data.products : [...prev.products, ...res.data.products];
        return { products, total: res.data.total };
      });
      // Rows read later go below what the owner has dragged so far.
      setIds((prev) => (offset === 0 ? res.data.products.map((p) => p.id) : [...prev, ...res.data.products.map((p) => p.id)]));
    },
    [term.taxonomy, term.id, network],
  );

  React.useEffect(() => {
    void read(0);
  }, [read]);

  const original = React.useMemo(() => loaded?.products.map((p) => p.id) ?? [], [loaded]);
  const byId = React.useMemo(() => new Map(loaded?.products.map((p) => [p.id, p]) ?? []), [loaded]);
  const { cards } = useProductCards(ids);
  const prefix = React.useMemo(() => movedPrefix(original, ids), [original, ids]);
  const changed = React.useMemo(() => movedCount(original, ids), [ids, original]);

  const input: OperationInput | null =
    confirming && prefix.length > 0
      ? { kind: "order", target: { kind: "ids", ids: prefix }, term: { taxonomy: term.taxonomy, id: term.id }, position: 1, reorder: true }
      : null;
  const preview = usePreview(input);
  const { run, busy, error } = useStartAction(onClose, onStarted);
  const count = buttonCount(preview);

  function toTop(id: number) {
    setIds((prev) => [id, ...prev.filter((x) => x !== id)]);
  }

  async function more() {
    setLoadingMore(true);
    await read(original.length);
    setLoadingMore(false);
  }

  const subtitle = loaded ? r.subtitle(term.name, original.length, loaded.total) : term.name;

  if (confirming && input) {
    return (
      <>
        <SheetHead title={r.title} subtitle={subtitle} onClose={onClose} />
        <SheetBody>
          <PreviewView state={preview} />
        </SheetBody>
        <SheetFooter error={error}>
          <PrimaryButton busy={busy} disabled={!preview.current || !count} onClick={() => void run(input)}>
            {count ? t.vetrinaCatalog.act.order.start(count) : r.save}
          </PrimaryButton>
          <Button large rounded tonal onClick={() => setConfirming(false)} className="w-full">
            {r.back}
          </Button>
        </SheetFooter>
      </>
    );
  }

  return (
    <>
      <SheetHead title={r.title} subtitle={subtitle} onClose={onClose} />
      {/* The rows are dragged by their handle: the sheet does not follow the finger. */}
      <SheetBody disableDrag>
        <p className={`${CARD} px-4 py-3 text-[15px] leading-snug`}>{r.intro}</p>
        {failed && !loaded ? (
          <FailedCard message={failed} onRetry={() => void read(0)} />
        ) : !loaded ? (
          <LoadingRows label={r.loading} />
        ) : ids.length === 0 ? (
          <p className={`${CARD} px-4 py-3 text-center text-[15px] opacity-60`}>{r.empty}</p>
        ) : (
          <>
            <Reorder.Group as="ul" axis="y" values={ids} onReorder={setIds} className={`${CARD} divide-y divide-black/5 dark:divide-white/10`}>
              {ids.map((id, i) => {
                const product = byId.get(id);
                return product ? (
                  <ReorderRow key={id} product={product} card={cards.get(id)} position={i + 1} moved={original[i] !== id} onTop={toTop} />
                ) : null;
              })}
            </Reorder.Group>
            {original.length < loaded.total && (
              <Button large rounded tonal disabled={loadingMore} onClick={() => void more()} className="w-full">
                {loadingMore ? <Preloader className="!h-5 !w-5" /> : t.vetrinaCatalog.home.results.showMore(Math.min(CATALOG_PAGE_MAX, loaded.total - original.length))}
              </Button>
            )}
          </>
        )}
      </SheetBody>
      <SheetFooter>
        <div className="flex items-center gap-3 px-1 text-[14px]">
          <span className="min-w-0 flex-1 truncate opacity-60">{changed > 0 ? r.moved(changed) : r.nothing}</span>
          {changed > 0 && (
            <button type="button" onClick={() => setIds(original)} className="h-11 shrink-0 px-2 font-medium text-primary active:opacity-50">
              {r.reset}
            </button>
          )}
        </div>
        <PrimaryButton disabled={prefix.length === 0} onClick={() => setConfirming(true)}>
          {r.save}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}

function ReorderRow({
  product,
  card,
  position,
  moved,
  onTop,
}: {
  product: CatalogProduct;
  card: ProductCard | undefined;
  position: number;
  /** Not where the shop has it now. */
  moved: boolean;
  onTop: (id: number) => void;
}) {
  const { t } = useI18n();
  const r = t.vetrinaCatalog.act.reorder;
  const controls = useDragControls();
  const soldOut = product.stockStatus === "outofstock";
  const hidden = !isListed(product.visibility);
  const image = card && !card.missing ? card.image : null;

  return (
    <Reorder.Item
      as="li"
      value={product.id}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, boxShadow: "0 12px 32px -12px rgba(0,0,0,0.35)" }}
      className="relative select-none bg-white dark:bg-[#2c2c2e]"
    >
      <div className="flex items-center gap-3 py-2 ps-3 pe-1">
        <span className={`w-7 shrink-0 text-end text-[13px] font-medium tabular-nums ${moved ? "text-primary opacity-100" : "opacity-50"}`}>
          {position}
        </span>
        <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-black/[0.04] dark:bg-white/10">
          {image && (
            // eslint-disable-next-line @next/next/no-img-element -- the shop's own thumbnail size, never the full photo
            <img src={image} alt="" loading="lazy" decoding="async" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[15px] leading-snug">{product.name}</span>
          {(soldOut || hidden) && (
            <span className="mt-0.5 flex gap-2 text-[12px] font-medium">
              {soldOut && <span className="text-orange-700 dark:text-orange-400">{r.soldOut}</span>}
              {hidden && <span className="opacity-60">{r.hidden}</span>}
            </span>
          )}
        </span>
        {position > 1 && (
          <button
            type="button"
            aria-label={r.toTop}
            onClick={() => onTop(product.id)}
            className="grid h-11 w-9 shrink-0 place-items-center opacity-45 active:opacity-20"
          >
            <ToTop className="h-5 w-5" />
          </button>
        )}
        <div
          role="button"
          aria-label={r.dragHandle}
          onPointerDown={(e) => {
            e.preventDefault();
            controls.start(e);
          }}
          style={{ touchAction: "none" }}
          className="grid h-12 w-10 shrink-0 cursor-grab place-items-center opacity-35 active:cursor-grabbing"
        >
          <Grip className="h-5 w-5" />
        </div>
      </div>
    </Reorder.Item>
  );
}
