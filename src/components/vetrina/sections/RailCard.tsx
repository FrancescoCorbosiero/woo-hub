"use client";

import type * as React from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/provider";
import { describeRule } from "@/lib/collections/describe";
import type { RailCollection } from "@/lib/collections/types";
import { skuKey } from "@/lib/skus";
import type { RailSummary } from "@/lib/vetrina/types";
import { Plus, Warning } from "../catalog/act/icons";
import { railCatalogHref, sectionHref } from "../catalog/sheet/links";
import { Stack } from "../catalog/term/glyphs";
import { EyeOff, Funnel, Lock, More, Pin } from "../icons";
import { railHealth } from "../rail-health";

/** A section's card on the page, for scrolling a new one into view. */
export const cardId = (key: string) => `sezione-${key.replace(/[^a-z0-9_-]/gi, "-")}`;

/**
 * A homepage section's card: what the site shows now (its first products,
 * their places and locks), its rule, its health, its counts — and its
 * controls: the editor (the card itself), the catalog's chip, the "⋯", and
 * "Aggiungi prodotti".
 */
export function RailCard({
  rail,
  locks,
  collection,
  onMenu,
  highlighted,
  canAdd,
}: {
  rail: RailSummary;
  locks: Record<string, number>;
  /** The rule filling the rail's category, when it is automatic. */
  collection: RailCollection | null;
  onMenu: () => void;
  highlighted: boolean;
  /** Products can be added to it from the catalog. */
  canAdd: boolean;
}) {
  const { t } = useI18n();
  const v = t.vetrina.home;
  const r = t.vetrinaCatalog.home.rail;
  const sx = t.vetrinaCatalog.sections;
  const auto = t.vetrina.auto;
  const pinned = rail.pin.length;
  const hidden = rail.exclude.length;
  const health = railHealth(rail, r);
  const title = rail.title.trim() || rail.key;
  // A section showing exactly one category or brand: its screen in the catalog, one tap away.
  const catalogHref = railCatalogHref(rail);
  const sectionHrefOf = rail.editable ? sectionHref(rail.key) : null;

  const heading = (
    <div className="min-w-0 flex-1">
      {rail.eyebrow && (
        <div className="truncate text-[12px] font-semibold uppercase tracking-wide opacity-50">{rail.eyebrow}</div>
      )}
      {/* Two lines before it is cut: beside the "Catalogo" chip, one line would cut most titles short. */}
      <div className="line-clamp-2 break-words text-[19px] font-bold leading-tight">{title}</div>
      {collection && (
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px]">
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              !collection.enabled
                ? "bg-black/5 opacity-60 dark:bg-white/10"
                : collection.held || collection.lastError
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
                  : "bg-[#d4a017]/15 text-[#8a6b00] dark:text-[#e8c35a]"
            }`}
          >
            <Funnel className="h-3 w-3" />
            {!collection.enabled
              ? auto.paused
              : collection.held
                ? auto.held
                : collection.lastError
                  ? auto.problem
                  : auto.badge}
          </span>
          <span className="truncate opacity-60">{describeRule(collection, t.collections.words)}</span>
        </div>
      )}
    </div>
  );

  const content = (
    <>
      {rail.products.length === 0 ? (
        <p className="px-4 py-3 text-[15px] opacity-50">{v.empty}</p>
      ) : (
        // Switched off, the site shows none of them: they are drawn faded.
        <div className={`no-scrollbar mt-3 flex gap-2 overflow-x-auto px-4 pb-1 ${rail.switchedOff ? "opacity-40" : ""}`}>
          {rail.products.slice(0, 12).map((p, i) => (
            <div key={p.id} className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- the shop's own thumbnail sizes */}
              <img
                src={p.image}
                alt={p.name}
                loading="lazy"
                className="h-[72px] w-[72px] overflow-hidden rounded-xl bg-black/[0.04] object-contain text-[0px] dark:bg-white/10"
              />
              <span className="absolute left-1 top-1 rounded-md bg-white/90 px-1 text-[11px] font-semibold tabular-nums text-black shadow-sm">
                {i + 1}
              </span>
              {(locks[skuKey(p.sku)] ?? 0) > 0 && (
                <span className="absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-black/80 text-white">
                  <Lock className="h-3 w-3" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {health && !rail.switchedOff && (
        <div className="flex items-center gap-1.5 px-4 pt-2 text-[13px] font-medium text-amber-700 dark:text-amber-400">
          <Warning className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">{r.health(health)}</span>
        </div>
      )}

      {/* Room at its end for "Aggiungi prodotti", drawn over it (a link cannot hold another). */}
      <div className={`flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3 pt-2 text-[13px] ${canAdd ? "pe-40" : ""}`}>
        {rail.switchedOff ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.06] px-2 py-0.5 text-[12px] font-semibold dark:bg-white/10">
            <EyeOff className="h-3.5 w-3.5" />
            {sx.switch.offBadge}
          </span>
        ) : (
          <span className="opacity-60">{v.inHomepage(Math.min(rail.limit, rail.products.length))}</span>
        )}
        {pinned > 0 && (
          <span className="inline-flex items-center gap-1 opacity-60">
            <Pin className="h-3.5 w-3.5 text-amber-600" />
            {v.pinned(pinned)}
          </span>
        )}
        {hidden > 0 && <span className="opacity-60">{v.hidden(hidden)}</span>}
        {!rail.editable && <span className="opacity-60">{v.fixedList}</span>}
      </div>
    </>
  );

  // The card is a few controls side by side (a link cannot hold another): the
  // section editor's link — the title, the products, the counts — the
  // catalog's chip, the "⋯", and "Aggiungi prodotti". Pressing any part of
  // the first dims the whole card.
  const toSection = (className: string, children: React.ReactNode) =>
    sectionHrefOf ? (
      <Link href={sectionHrefOf} className={`card-link ${className}`}>
        {children}
      </Link>
    ) : (
      <div className={className}>{children}</div>
    );

  return (
    <div
      id={cardId(rail.key)}
      className={`relative block scroll-mt-24 overflow-hidden rounded-2xl bg-white shadow-sm transition-shadow duration-500 has-[.card-link:active]:opacity-80 dark:bg-[#1c1c1e] ${
        highlighted ? "ring-2 ring-[#d4a017]" : ""
      }`}
    >
      <div className="flex items-center">
        {toSection("flex min-w-0 flex-1 items-center pe-2 ps-4 pt-3.5", heading)}
        {catalogHref && (
          <Link
            href={catalogHref}
            aria-label={r.catalogLabel(rail.terms[0]?.name ?? rail.title)}
            // A 44px target that takes no more room than the pill it holds.
            className="-mb-2.5 mt-1 flex h-11 shrink-0 items-center transition-opacity active:opacity-50"
          >
            <span className="inline-flex h-7 items-center gap-1 rounded-full bg-black/[0.06] px-2.5 text-[13px] font-semibold dark:bg-white/10">
              <Stack className="h-3.5 w-3.5 opacity-60" />
              {r.catalog}
            </span>
          </Link>
        )}
        <button
          type="button"
          onClick={onMenu}
          aria-label={sx.menu.open(title)}
          aria-haspopup="dialog"
          className="-mb-2.5 me-1 mt-1 grid h-11 w-11 shrink-0 place-items-center opacity-50 transition-opacity active:opacity-25"
        >
          <More className="h-5 w-5" />
        </button>
      </div>
      {/* flow-root: the products' top margin stays inside the link, so the gap is tappable too. */}
      {toSection("flow-root", content)}
      {canAdd && sectionHrefOf && (
        <Link
          href={`${sectionHrefOf}?aggiungi=1`}
          aria-label={t.vetrinaCatalog.picker.openLabel(title)}
          // A 44px target over the counts line's end.
          className="absolute bottom-0.5 end-2 flex h-11 items-center px-1.5 transition-opacity active:opacity-50"
        >
          <span className="inline-flex h-8 items-center gap-1 rounded-full bg-black/[0.06] px-3 text-[13px] font-semibold dark:bg-white/10">
            <Plus className="h-3.5 w-3.5" />
            {sx.quick.add}
          </span>
        </Link>
      )}
    </div>
  );
}
