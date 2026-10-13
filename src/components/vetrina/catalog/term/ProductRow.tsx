"use client";

import * as React from "react";
import { ListItem } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { isListed, type CatalogProduct } from "@/lib/vetrina/catalog";
import type { ProductCard } from "@/lib/vetrina/types";
import { formatEuro, formatFromPrice } from "../../format";
import { EyeOff, Lock, Pin } from "../../icons";
import { House, NoPhoto } from "./glyphs";

// Rows off screen skip layout and paint; the estimate keeps the scrollbar steady.
const ROW_STYLE: React.CSSProperties = { contentVisibility: "auto", containIntrinsicSize: "auto 90px" };

const TONES = {
  gold: "bg-[#d4a017]/15 text-[#8a6b00] dark:text-[#e8c35a]",
  orange: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  red: "bg-red-500/10 text-red-700 dark:text-red-400",
  gray: "bg-black/[0.06] text-black/60 dark:bg-white/10 dark:text-white/60",
};

/**
 * One product in a catalog list: its thumbnail, name, price and what is
 * worth knowing at a glance (homepage section, locked price, hidden, sold
 * out, on sale, not published). Memoised: when a batch of thumbnails
 * arrives, only the rows that got one draw again.
 */
export const ProductRow = React.memo(function ProductRow({
  product,
  card,
  locks,
  onOpen,
}: {
  product: CatalogProduct;
  /** The store's card, once it has arrived: the thumbnail and the live price. */
  card: ProductCard | undefined;
  /** Sizes with a locked price (the sheet may have changed them since the page was read). */
  locks: number;
  onOpen: (product: CatalogProduct) => void;
}) {
  const { t } = useI18n();
  const live = card && !card.missing ? card : null;
  const price = live ? formatFromPrice(live, t.vetrina.editor.from) : formatEuro(product.price);

  return (
    <ListItem
      link
      linkComponent="button"
      linkProps={{ type: "button", onClick: () => onOpen(product) }}
      contentClassName="w-full text-start"
      style={ROW_STYLE}
      media={<Thumb image={card?.image ?? null} hasImage={product.hasImage} noPhotoLabel={t.vetrinaCatalog.term.row.noPhoto} />}
      titleFontSizeIos="text-[16px]"
      titleFontSizeMaterial="text-[16px]"
      title={<span className="line-clamp-2 leading-snug">{product.name}</span>}
      subtitle={<Meta product={product} price={price} locks={locks} />}
    />
  );
});

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
    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="me-0.5 text-[14px] font-medium tabular-nums">{price}</span>
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
      {locks > 0 && (
        <span role="img" aria-label={r.locked} className="inline-flex">
          <Lock className="h-3.5 w-3.5 opacity-60" />
        </span>
      )}
      {!isListed(product.visibility) && (
        <Badge tone="gray">
          <EyeOff className="h-3 w-3" />
          {r.hidden}
        </Badge>
      )}
      {product.stockStatus === "outofstock" && <Badge tone="orange">{r.soldOut}</Badge>}
      {product.onSale && <Badge tone="red">{r.onSale}</Badge>}
      {product.status !== "publish" && <Badge tone="gray">{r.status[product.status] ?? r.status.other}</Badge>}
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
