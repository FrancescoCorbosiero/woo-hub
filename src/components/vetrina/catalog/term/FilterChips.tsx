"use client";

import * as React from "react";
import Link from "next/link";
import { Chip } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { CatalogPage, CatalogTaxonomy } from "@/lib/vetrina/catalog";
import { ChevronRight } from "../../icons";
import { STATUS_FILTERS, statusCount, withinChips, type ListFilter } from "./list-model";

const IDLE = {
  fillBgIos: "bg-black/[0.06] dark:bg-white/10",
  fillBgMaterial: "bg-black/[0.06] dark:bg-white/10",
  fillTextIos: "text-black dark:text-white",
  fillTextMaterial: "text-black dark:text-white",
};
// White text on the primary: globals.css turns it dark when the primary turns white.
const ACTIVE = {
  fillBgIos: "bg-primary",
  fillBgMaterial: "bg-primary",
  fillTextIos: "text-white",
  fillTextMaterial: "text-white",
};

/**
 * The chips over a list: one status at a time (Tutti, Disponibili, Esauriti,
 * Nascosti, In saldo) and, in a second row, the other taxonomy's terms (the
 * brands inside a category, the categories inside a brand). Counts come from
 * the facets, which are counted before the chips narrow the list: a chip's
 * number is what tapping it shows.
 */
export function FilterChips({
  facets,
  filter,
  onChange,
  taxonomy,
  statuses = true,
}: {
  facets: CatalogPage["facets"] | null;
  filter: ListFilter;
  onChange: (next: ListFilter) => void;
  /** The list's own taxonomy: the second row holds the other one's terms. */
  taxonomy: CatalogTaxonomy;
  /** The status chips; a quick view already is one. */
  statuses?: boolean;
}) {
  const { t } = useI18n();
  const f = t.vetrinaCatalog.term.filters;
  const within = facets ? withinChips(facets.within, filter.within) : [];
  // A single brand in a category narrows nothing: no row for it.
  const showWithin = within.length > 1 || filter.within != null;

  return (
    <div className="space-y-0.5 py-1">
      {statuses && (
        <ChipRow label={f.label}>
          {STATUS_FILTERS.map((status) => {
            const count = facets ? statusCount(status, facets) : null;
            const active = filter.status === status;
            return (
              <FilterChip
                key={status}
                label={f[status]}
                count={count}
                active={active}
                disabled={!active && count === 0}
                onClick={() => !active && onChange({ ...filter, status })}
              />
            );
          })}
        </ChipRow>
      )}
      {showWithin && (
        <ChipRow label={f.withinLabel[taxonomy]}>
          <FilterChip
            label={f.withinAll[taxonomy]}
            count={null}
            active={filter.within == null}
            onClick={() => filter.within && onChange({ ...filter, within: null })}
          />
          {within.map((term) => {
            const active = filter.within?.id === term.id;
            return (
              <FilterChip
                key={term.id}
                label={term.name}
                count={term.count}
                active={active}
                // Tapping the chosen one again lets it go, like "Tutti".
                onClick={() => onChange({ ...filter, within: active ? null : { id: term.id, name: term.name } })}
              />
            );
          })}
        </ChipRow>
      )}
    </div>
  );
}

/** A row of chips that scrolls sideways, edge to edge, with the page's side margin. */
export function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="no-scrollbar flex gap-2 overflow-x-auto scroll-px-4 ps-4 [overscroll-behavior-x:contain]"
    >
      {children}
      {/* The end margin: Safari drops a scrolling row's end padding. */}
      <span aria-hidden className="w-2 shrink-0" />
    </div>
  );
}

/** A chip inside a 44px-tall button: the pill stays small, the target does not. */
function FilterChip({
  label,
  count,
  active,
  disabled = false,
  onClick,
}: {
  label: string;
  count: number | null;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className="shrink-0 py-1.5 transition-opacity active:opacity-60 disabled:opacity-35"
    >
      <Chip component="span" colors={active ? ACTIVE : IDLE} className="!h-8 gap-1.5 !px-3.5 text-[14px] font-medium">
        <span className="max-w-[12rem] truncate">{label}</span>
        {count != null && <span className="tabular-nums opacity-60">{count}</span>}
      </Chip>
    </button>
  );
}

/** A chip that opens another screen (a sub-category): outlined, with an arrow. */
export function NavChip({ href, label, count }: { href: string; label: string; count: number }) {
  return (
    <Link href={href} className={`shrink-0 py-1.5 active:opacity-60 ${count === 0 ? "opacity-50" : ""}`}>
      <Chip component="span" outline className="!h-8 gap-1.5 !pe-2 !ps-3.5 text-[14px] font-medium">
        <span className="max-w-[12rem] truncate">{label}</span>
        <span className="tabular-nums opacity-50">{count}</span>
        <ChevronRight className="h-3.5 w-3.5 opacity-40" />
      </Chip>
    </Link>
  );
}
