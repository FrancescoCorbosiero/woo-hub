"use client";

import { useI18n } from "@/i18n/provider";
import type { ProductSource } from "@/lib/vetrina/catalog";

/**
 * Where a product comes from, in its colour — the same wherever it shows: a
 * row's badge and thumbnail, a "Provenienza" chip, the product sheet. The
 * supplier's feed is yellow (GoldenSneakers' gold), solid: what the owner
 * must not take for one of the shop's own. The Hub's KicksDB picks are blue.
 * A product the feed dropped keeps the feed's yellow, faded and dashed: it
 * was the supplier's, and "Elimina" now takes it. One made in the shop is
 * grey, the colour of no source. The homepage's pale gold, with its house,
 * stays the homepage's.
 */
const TONES: Record<ProductSource, { badge: string; ring: string; dot: string }> = {
  goldensneakers: {
    badge: "bg-[#facc15] text-black",
    ring: "ring-2 ring-[#facc15]",
    dot: "bg-[#facc15]",
  },
  kicksdb: {
    badge: "bg-[#2563eb] text-white",
    ring: "ring-2 ring-[#2563eb]",
    dot: "bg-[#2563eb]",
  },
  delisted: {
    badge: "border border-dashed border-[#ca8a04] bg-[#facc15]/20 text-[#854d0e] dark:border-[#facc15]/80 dark:text-[#fde047]",
    ring: "outline-dashed outline-2 outline-[#ca8a04] dark:outline-[#facc15]/80",
    dot: "border border-dashed border-[#ca8a04] bg-[#facc15]/30 dark:border-[#facc15]/80",
  },
  woo: {
    badge: "bg-black/[0.08] text-black/70 dark:bg-white/15 dark:text-white/75",
    ring: "",
    dot: "bg-black/25 dark:bg-white/35",
  },
};

/** The thumbnail's frame in its source's colour: a column of colour down the list. None for a shop-made product. */
export function sourceRing(source: ProductSource | undefined): string {
  return source ? TONES[source].ring : "";
}

/** A row's badge: the source's few letters on its colour, its whole name for a screen reader. */
export function SourceBadge({ source, className = "" }: { source: ProductSource; className?: string }) {
  const { t } = useI18n();
  const o = t.vetrinaCatalog.origin;
  return (
    <span
      data-source={source}
      className={`inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-bold leading-none ${TONES[source].badge} ${className}`}
    >
      <span aria-hidden>{o.short[source]}</span>
      <span className="sr-only">{o.aria(o.name[source])}</span>
    </span>
  );
}

/** A chip's dot: the source's colour beside its name. */
export function SourceDot({ source }: { source: ProductSource }) {
  return <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${TONES[source].dot}`} />;
}
