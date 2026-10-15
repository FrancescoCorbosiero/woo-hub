"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Chip } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { CatalogOverview, QuickView } from "@/lib/vetrina/catalog";
import { EyeOff } from "../../icons";
import { formatCount } from "../format";
import { Draft, Empty, Folder, NoPhoto, Tag } from "../term/glyphs";
import { viewHref } from "../term/list-model";

const ICONS: Record<QuickView, (props: { className?: string }) => ReactNode> = {
  soldout: Empty,
  onsale: Tag,
  hidden: EyeOff,
  nophoto: NoPhoto,
  nocategory: Folder,
  unpublished: Draft,
};

/**
 * Sold out and on sale stand out, in the colours the product rows give them
 * (gold is the homepage's alone); the rest are housekeeping.
 */
const TONE: Partial<Record<QuickView, string>> = {
  soldout: "text-orange-600 dark:text-orange-400",
  onsale: "text-red-600 dark:text-red-400",
};

/**
 * The lists that cut across categories and brands, as a row of chips that
 * scrolls sideways: "Esauriti 23", "In saldo 41"… Only those with something
 * in them; none at all, no row.
 */
export function QuickViewChips({ views }: { views: CatalogOverview["views"] }) {
  const { t, locale } = useI18n();
  const h = t.vetrinaCatalog.home;
  const shown = views.filter((v) => v.count > 0);
  if (shown.length === 0) return null;

  return (
    <nav aria-label={h.viewsLabel} className="no-scrollbar -mb-2 flex gap-2 overflow-x-auto px-4 pt-1">
      {shown.map(({ view, count }) => {
        const Icon = ICONS[view];
        return (
          // The link is the 44px touch target; the chip inside is the look.
          <Link key={view} href={viewHref(view)} className="flex h-11 shrink-0 items-center transition-opacity active:opacity-50">
            <Chip
              className="!h-[34px] gap-1.5 !px-3.5 !text-[15px]"
              colors={{ fillBgIos: "bg-black/[0.06] dark:bg-white/[0.12]" }}
            >
              <Icon className={`h-4 w-4 shrink-0 ${TONE[view] ?? "opacity-60"}`} />
              {h.views[view]}
              <span className="font-semibold tabular-nums">{formatCount(count, locale)}</span>
            </Chip>
          </Link>
        );
      })}
    </nav>
  );
}
