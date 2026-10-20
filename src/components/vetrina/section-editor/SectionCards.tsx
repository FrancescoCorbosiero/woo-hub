"use client";

import { Button, Preloader, Segmented, SegmentedButton, Toggle } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { describeRule } from "@/lib/collections/describe";
import type { RailCollection } from "@/lib/collections/types";
import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import type { RailDetail, RailFallback, RailSource } from "@/lib/vetrina/types";
import { Folder, Stack, Tag } from "../catalog/term/glyphs";
import { ChevronRight, Funnel } from "../icons";
import { SEGMENTED_COLORS } from "../segmented";

/**
 * The cards above a section's products: what it shows (and "Cambia"), its
 * switch on the site, the rule filling its category, its texts and look, and
 * what follows the pinned products.
 */

const CARD = "rounded-2xl bg-white shadow-sm dark:bg-[#1c1c1e]";
const BUTTON_CARD = `flex w-full items-center gap-3 px-4 py-3 text-left transition-opacity active:opacity-60 ${CARD}`;
const LABEL = "block text-[12px] font-semibold uppercase tracking-wide opacity-50";

/** A switch in the iOS green: Konsta's own takes the primary, which turns white in dark mode. */
const TOGGLE_COLORS = { checkedBgIos: "bg-[#34c759] dark:bg-[#30d158]" };

/** The section's one category or brand, when it shows exactly one. */
export interface OneTerm {
  taxonomy: CatalogTaxonomy;
  id: number;
  name: string;
}

/** What the section shows, how many, and "Cambia" to show something else. */
export function ShowsCard({
  rail,
  source,
  oneTerm,
  visibleCount,
  title,
  onChange,
}: {
  rail: RailDetail;
  source: RailSource | null;
  oneTerm: OneTerm | null;
  /** How many the site shows now (all of them, not just the homepage's). */
  visibleCount: number;
  title: string;
  /** None: the site's plugin cannot point it elsewhere. */
  onChange: (() => void) | null;
}) {
  const { t } = useI18n();
  const sx = t.vetrinaCatalog.sections;
  const termName = rail.terms.map((term) => term.name).join(", ");
  const shows = !source
    ? rail.atts.tag
      ? sx.shows.tag(rail.atts.tag)
      : rail.terms.length > 1
        ? sx.shows.terms(termName)
        : sx.shows.fixed
    : "list" in source
      ? (sx.shows.list[source.list] ?? source.list)
      : source.taxonomy === "category"
        ? sx.shows.category(oneTerm?.name ?? source.slug)
        : sx.shows.brand(oneTerm?.name ?? source.slug);
  const ShowsIcon = !source || "list" in source ? Stack : source.taxonomy === "brand" ? Tag : Folder;

  return (
    <div className="px-4 pb-3 pt-3">
      <div className={`flex w-full items-center gap-3 py-3 pe-2 ps-4 text-left ${CARD}`}>
        <ShowsIcon className="h-5 w-5 shrink-0 opacity-60" />
        <span className="min-w-0 flex-1">
          <span className={LABEL}>{sx.shows.label}</span>
          <span className="block text-[15px] font-medium leading-snug">{shows}</span>
          <span className="mt-0.5 block text-[13px] leading-snug opacity-60">
            {oneTerm ? sx.shows.count(rail.terms[0].count, visibleCount) : sx.shows.visible(visibleCount)}
          </span>
        </span>
        {onChange && (
          <Button
            small
            rounded
            tonal
            inline
            onClick={onChange}
            aria-label={sx.shows.changeLabel(title)}
            className="!h-9 shrink-0 !px-3.5"
          >
            {sx.shows.change}
          </Button>
        )}
      </div>
      {!rail.editable && <p className="mt-2 px-1 text-[15px]">{t.vetrina.editor.readOnly}</p>}
    </div>
  );
}

/** The section's switch on the site: in the draft, published with the rest. */
export function SwitchCard({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const sx = t.vetrinaCatalog.sections;
  return (
    <div className="px-4 pb-3">
      <div className={`flex w-full items-center gap-3 px-4 py-3 ${CARD}`}>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium">{sx.switch.label}</span>
          <span className={`mt-0.5 block text-[13px] leading-snug ${on ? "opacity-60" : "text-amber-700 dark:text-amber-400"}`}>
            {on ? sx.switch.on : sx.switch.off}
          </span>
        </span>
        <Toggle checked={on} colors={TOGGLE_COLORS} aria-label={sx.switch.label} onChange={onToggle} />
      </div>
    </div>
  );
}

/** The rule filling the section's category — or "Rendi automatica" for one filled by hand. */
export function RuleCard({ collection, onOpen }: { collection: RailCollection | null; onOpen: () => void }) {
  const { t } = useI18n();
  const auto = t.vetrina.auto;
  return (
    <div className="px-4 pb-3">
      <button type="button" onClick={onOpen} className={BUTTON_CARD}>
        <Funnel className={`h-5 w-5 shrink-0 ${collection?.enabled ? "text-[#b8860b]" : "opacity-40"}`} />
        <span className="min-w-0 flex-1">
          <span className={LABEL}>{collection ? (collection.enabled ? auto.card : auto.paused) : auto.make}</span>
          <span className="block text-[15px] font-medium leading-snug">
            {collection ? describeRule(collection, t.collections.words) : auto.makeHint}
          </span>
          {collection && (
            <span
              className={`mt-0.5 block text-[13px] leading-snug ${
                collection.enabled && (collection.held || collection.lastError) ? "text-amber-700 dark:text-amber-400" : "opacity-60"
              }`}
            >
              {!collection.enabled
                ? auto.cardPaused
                : collection.held
                  ? auto.heldHint
                  : collection.lastError
                    ? auto.problem
                    : collection.members != null
                      ? `${auto.members(collection.members)} · ${auto.cardHint}`
                      : auto.cardHint}
            </span>
          )}
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 opacity-30" />
      </button>
    </div>
  );
}

/** "Titolo, testi e aspetto": the eyebrow and title as they will read, a dot when changed. */
export function LooksCard({ text, changed, onOpen }: { text: string; changed: boolean; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <div className="px-4 pb-3">
      <button type="button" onClick={onOpen} className={BUTTON_CARD}>
        <span className="min-w-0 flex-1">
          <span className={LABEL}>{t.vetrina.section.open}</span>
          <span className="block truncate text-[15px] font-medium">{text}</span>
        </span>
        {changed && <span className="h-2 w-2 shrink-0 rounded-full bg-[#d4a017]" aria-hidden />}
        <ChevronRight className="h-5 w-5 shrink-0 opacity-30" />
      </button>
    </div>
  );
}

/**
 * "Dopo i fissati, in automatico": the order after the pinned products. On
 * "Negozio" it follows the shop's own positions — changed right here, for
 * the section's category or brand.
 */
export function AutoOrderCard({
  fallback,
  choices,
  loading,
  oneTerm,
  onFallback,
  onArrange,
  onRanking,
}: {
  fallback: RailFallback;
  choices: readonly RailFallback[];
  /** The order for this fallback is being read from the site. */
  loading: boolean;
  oneTerm: OneTerm | null;
  onFallback: (fallback: RailFallback) => void;
  onArrange: () => void;
  onRanking: () => void;
}) {
  const { t } = useI18n();
  const v = t.vetrina.editor;
  const sx = t.vetrinaCatalog.sections;
  return (
    <div className="px-4 pb-3">
      <div className={`px-4 pb-3 pt-3 ${CARD}`}>
        <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide opacity-50">
          {sx.auto.title}
          {loading && <Preloader className="!h-4 !w-4" />}
        </div>
        <Segmented strong rounded colors={SEGMENTED_COLORS}>
          {choices.map((f) => (
            <SegmentedButton key={f} active={fallback === f} onClick={() => fallback !== f && onFallback(f)}>
              {v.fallbacks[f] ?? f}
            </SegmentedButton>
          ))}
        </Segmented>
        {fallback === "menu_order" && (
          <>
            <p className="mt-2.5 text-[13px] leading-snug opacity-60">{oneTerm ? sx.auto.shop(oneTerm.name) : sx.auto.shopAny}</p>
            {oneTerm && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button small rounded tonal inline className="!h-9 !px-3.5" onClick={onArrange}>
                  {sx.auto.arrange(oneTerm.name)}
                </Button>
                <Button small rounded tonal inline className="!h-9 !px-3.5" onClick={onRanking}>
                  {sx.auto.ranking}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
