"use client";

import * as React from "react";
import Link from "next/link";
import { Chip } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { CatalogPage, CatalogTaxonomy } from "@/lib/vetrina/catalog";
import { ChevronRight } from "../../icons";
import { formatCount } from "../format";
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
 * the facets, where each chip leaves only its own choice out: a chip's
 * number is what tapping it shows, the other row staying as it is.
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
  const { t, locale } = useI18n();
  const f = t.vetrinaCatalog.term.filters;
  const shownCount = (n: number | null) => (n == null ? null : formatCount(n, locale));
  const within = facets ? withinChips(facets.within, filter.within) : [];
  const showWithin = withinRowShown(facets, filter);

  return (
    <div className="space-y-0.5 py-1">
      {statuses && (
        <ChipRow label={f.label}>
          {STATUS_FILTERS.map((status) => {
            const n = facets ? statusCount(status, facets) : null;
            const active = filter.status === status;
            return (
              <FilterChip
                key={status}
                label={f[status]}
                count={shownCount(n)}
                active={active}
                disabled={!active && n === 0}
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
                count={shownCount(term.count)}
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

/**
 * The other taxonomy's row shows when a chip would narrow the list: a
 * category whose every product is Nike (and Nike Dunk) has nothing to
 * choose there. A chosen one always shows, to be let go.
 */
export function withinRowShown(facets: CatalogPage["facets"] | null, filter: ListFilter): boolean {
  if (filter.within != null) return true;
  if (!facets) return false;
  const shown = statusCount(filter.status, facets);
  return facets.within.some((term) => term.count < shown);
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
  /** Already formatted ("1.234"); none for "Tutti i brand". */
  count: string | null;
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
  const { locale } = useI18n();
  return (
    <Link href={href} className={`shrink-0 py-1.5 active:opacity-60 ${count === 0 ? "opacity-50" : ""}`}>
      <Chip component="span" outline className="!h-8 gap-1.5 !pe-2 !ps-3.5 text-[14px] font-medium">
        <span className="max-w-[12rem] truncate">{label}</span>
        <span className="tabular-nums opacity-50">{formatCount(count, locale)}</span>
        <ChevronRight className="h-3.5 w-3.5 opacity-40" />
      </Chip>
    </Link>
  );
}
