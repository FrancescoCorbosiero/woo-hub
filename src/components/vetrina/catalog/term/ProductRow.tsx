"use client";

import * as React from "react";
import { Checkbox, ListItem } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { isListed, type CatalogProduct } from "@/lib/vetrina/catalog";
import type { ProductCard } from "@/lib/vetrina/types";
import { formatEuro, formatFromPrice } from "../../format";
import { EyeOff, Lock, Pin } from "../../icons";
import { House, NoPhoto } from "./glyphs";

// Rows off screen skip layout and paint; the estimate keeps the scrollbar steady.
const ROW_STYLE: React.CSSProperties = { contentVisibility: "auto", containIntrinsicSize: "auto 90px" };
// A press held this long starts a selection, as on a phone's own lists.
const LONG_PRESS_MS = 450;
// A finger that moves this far is scrolling, not pressing.
const LONG_PRESS_SLOP = 10;

const TONES = {
  gold: "bg-[#d4a017]/15 text-[#8a6b00] dark:text-[#e8c35a]",
  orange: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  red: "bg-red-500/10 text-red-700 dark:text-red-400",
  gray: "bg-black/[0.06] text-black/60 dark:bg-white/10 dark:text-white/60",
};

/**
 * One product in a catalog list: its thumbnail, name, price and what is
 * worth knowing at a glance (homepage section, locked price, hidden, sold
 * out, on sale, not published). A tap opens its sheet; a long press starts a
 * selection. While selecting, the row is a checkbox: a tap picks it.
 * Memoised: when a batch of thumbnails arrives, or one row is picked, only
 * the rows that changed draw again.
 */
export const ProductRow = React.memo(function ProductRow({
  product,
  card,
  locks,
  onOpen,
  selecting = false,
  selected = false,
  onToggle,
  onLongPress,
  note,
}: {
  product: CatalogProduct;
  /** The store's card, once it has arrived: the thumbnail and the live price. */
  card: ProductCard | undefined;
  /** Sizes with a locked price (the sheet may have changed them since the page was read). */
  locks: number;
  onOpen: (product: CatalogProduct) => void;
  /** The list is selecting: the row picks instead of opening. */
  selecting?: boolean;
  selected?: boolean;
  onToggle?: (product: CatalogProduct) => void;
  /** A long press: the list starts selecting, with this product picked. None: no long press. */
  onLongPress?: (product: CatalogProduct) => void;
  /** A line under the row's states, for where the list is shown (a picker: "In sezione · #3"). */
  note?: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const live = card && !card.missing ? card : null;
  const price = live ? formatFromPrice(live, t.vetrina.editor.from, locale) : formatEuro(product.price, locale);
  const press = useLongPress(onLongPress ? () => onLongPress(product) : undefined);
  const thumb = <Thumb image={card?.image ?? null} hasImage={product.hasImage} noPhotoLabel={t.vetrinaCatalog.term.row.noPhoto} />;
  const title = <span className="line-clamp-2 leading-snug">{product.name}</span>;
  const subtitle = (
    <>
      <Meta product={product} price={price} locks={locks} />
      {note && <span className="mt-1 block text-[13px] leading-snug">{note}</span>}
    </>
  );

  if (selecting) {
    // The whole row is the checkbox's label: a tap anywhere picks it.
    return (
      <ListItem
        label
        style={ROW_STYLE}
        className="select-none"
        contentClassName="w-full text-start"
        media={
          <span className="flex items-center gap-3">
            <Checkbox component="span" checked={selected} onChange={() => onToggle?.(product)} />
            {thumb}
          </span>
        }
        titleFontSizeIos="text-[16px]"
        titleFontSizeMaterial="text-[16px]"
        title={title}
        subtitle={subtitle}
      />
    );
  }

  return (
    <ListItem
      link
      linkComponent="button"
      linkProps={{ type: "button", onClick: () => onOpen(product), ...press }}
      // No text selection or callout on a held finger.
      className="select-none [-webkit-touch-callout:none]"
      contentClassName="w-full text-start"
      style={ROW_STYLE}
      media={thumb}
      titleFontSizeIos="text-[16px]"
      titleFontSizeMaterial="text-[16px]"
      title={title}
      subtitle={subtitle}
    />
  );
});

/**
 * A press held still for LONG_PRESS_MS calls `onLongPress` (with a tick of
 * the phone's vibration, where it has one). Moving the finger (a scroll) or
 * lifting it earlier cancels it. Without `onLongPress`, no handlers at all.
 */
function useLongPress(onLongPress: (() => void) | undefined) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = React.useRef<{ x: number; y: number } | null>(null);
  const latest = React.useRef(onLongPress);
  React.useEffect(() => {
    latest.current = onLongPress;
  });

  const cancel = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);
  React.useEffect(() => cancel, [cancel]);

  const enabled = onLongPress != null;
  return React.useMemo(
    () =>
      enabled
        ? {
            onPointerDown: (e: React.PointerEvent) => {
              if (e.pointerType === "mouse" && e.button !== 0) return;
              cancel();
              origin.current = { x: e.clientX, y: e.clientY };
              timer.current = setTimeout(() => {
                timer.current = null;
                origin.current = null;
                navigator.vibrate?.(10);
                swallowClickAfterRelease();
                latest.current?.();
              }, LONG_PRESS_MS);
            },
            onPointerMove: (e: React.PointerEvent) => {
              const o = origin.current;
              if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > LONG_PRESS_SLOP) cancel();
            },
            onPointerUp: cancel,
            onPointerCancel: cancel,
            onPointerLeave: cancel,
            // Android's long-press menu, a right click: what a held row offers is the selection.
            onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
          }
        : {},
    [enabled, cancel],
  );
}

/**
 * The click that comes when the finger lifts after a long press must neither
 * open the product nor un-pick it: by then the row is a checkbox, and the
 * browser may send that click to it. One click is swallowed, if it comes
 * soon after the finger lifts.
 */
function swallowClickAfterRelease(): void {
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    done();
  };
  const released = () => setTimeout(done, 400);
  const backstop = setTimeout(() => done(), 10_000);
  function done() {
    window.removeEventListener("click", stop, true);
    window.removeEventListener("pointerup", released, true);
    window.removeEventListener("pointercancel", released, true);
    clearTimeout(backstop);
  }
  window.addEventListener("click", stop, true);
  window.addEventListener("pointerup", released, true);
  window.addEventListener("pointercancel", released, true);
}

/** A fixed 64px box: the row never moves when its photo arrives. */
function Thumb({ image, hasImage, noPhotoLabel }: { image: string | null; hasImage: boolean; noPhotoLabel: string }) {
  // Before the card arrives, the index already knows a product has no photo.
  const noPhoto = image === null ? !hasImage : image === "";
  return (
    <span className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-black/[0.04] dark:bg-white/10">
      {image ? (
        <ThumbImage key={image} src={image} />
      ) : noPhoto ? (
        <span role="img" aria-label={noPhotoLabel}>
          <NoPhoto className="h-6 w-6 opacity-25" />
        </span>
      ) : null}
    </span>
  );
}

function ThumbImage({ src }: { src: string }) {
  const [shown, setShown] = React.useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the shop's own thumbnail size, never the full photo
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={() => setShown(true)}
      className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`}
    />
  );
}

function Meta({ product, price, locks }: { product: CatalogProduct; price: string; locks: number }) {
  const { t } = useI18n();
  const r = t.vetrinaCatalog.term.row;
  const [section, ...otherSections] = product.sections;
  return (
    // The short states first, beside the price; the homepage's pill, the longest, last: when a row runs
    // out of room it is the pill that moves to the next line, not "In saldo".
    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="me-0.5 text-[14px] font-medium tabular-nums">{price}</span>
      {locks > 0 && (
        <span role="img" aria-label={r.locked} className="inline-flex">
          <Lock className="h-3.5 w-3.5 opacity-60" />
        </span>
      )}
      {product.onSale && <Badge tone="red">{r.onSale}</Badge>}
      {product.stockStatus === "outofstock" && <Badge tone="orange">{r.soldOut}</Badge>}
      {!isListed(product.visibility) && (
        <Badge tone="gray">
          <EyeOff className="h-3 w-3" />
          {r.hidden}
        </Badge>
      )}
      {product.status !== "publish" && <Badge tone="gray">{r.status[product.status] ?? r.status.other}</Badge>}
      {section && (
        <Badge tone="gold">
          <span className="sr-only">{r.sectionLabel(section.title, section.position, section.pinned)}</span>
          <span aria-hidden className="inline-flex min-w-0 items-center gap-1">
            <House className="h-3 w-3 shrink-0" />
            <span className="max-w-[9rem] truncate">{r.section(section.title, section.position)}</span>
            {section.pinned && <Pin className="h-3 w-3 shrink-0" />}
            {otherSections.length > 0 && <span className="opacity-70">{r.moreSections(otherSections.length)}</span>}
          </span>
        </Badge>
      )}
    </span>
  );
}

function Badge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex h-5 max-w-full items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold leading-none ${TONES[tone]}`}>
      {children}
    </span>
  );
}
