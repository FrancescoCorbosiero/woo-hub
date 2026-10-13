"use client";

import * as React from "react";
import type { ReactNode } from "react";
import { Block, BlockTitle, List, ListButton, ListGroup, ListItem } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { Dictionary } from "@/i18n/dictionary";
import { describeRule } from "@/lib/collections/describe";
import type { RailCollection } from "@/lib/collections/types";
import type { CatalogTerm } from "@/lib/vetrina/catalog";
import { Funnel } from "../../icons";
import { byLetter, statsLine, termHref, topLevel, type TermOrder } from "./model";
import { CountAfter, House, NextLinkTag, SortArrows, Tile } from "./ui";

/**
 * The catalog home's two lists. Categories: the ones behind a homepage
 * section, the automatic ones, then every top-level category (a tap opens it,
 * its sub-categories inside), the empty ones folded away. Brands: A to Z
 * under sticky letters, like the phone's contacts.
 */

/** One category or brand: its name, its count, what needs a look. Opens its screen. */
export function TermRow({
  term,
  title,
  text,
  media,
  homeMark = false,
}: {
  term: CatalogTerm;
  /** The name by default; a path ("Saldi › Nike") where the parent matters. */
  title?: string;
  /** "12 esauriti · 3 nascosti" by default. */
  text?: string;
  media?: ReactNode;
  /** A house before the count when a homepage section shows it. */
  homeMark?: boolean;
}) {
  const { t, locale } = useI18n();
  const h = t.vetrinaCatalog.home;
  const line = text ?? statsLine(term, h);
  return (
    <ListItem
      link
      linkComponent={NextLinkTag}
      href={termHref(term)}
      strongTitle={false}
      media={media}
      title={<span className={term.count === 0 ? "opacity-45" : undefined}>{title ?? term.name}</span>}
      text={line || undefined}
      after={
        <CountAfter
          count={term.count}
          locale={locale}
          home={homeMark && term.sections.length > 0}
          homeLabel={h.inHomepageMark}
        />
      }
    />
  );
}

export function CategoryGroups({
  categories,
  order,
  onOrder,
}: {
  categories: CatalogTerm[];
  order: TermOrder;
  onOrder: (order: TermOrder) => void;
}) {
  const { t } = useI18n();
  const h = t.vetrinaCatalog.home;
  const [showEmpty, setShowEmpty] = React.useState(false);
  const { filled, empty } = React.useMemo(() => topLevel(categories, order), [categories, order]);
  // The overview comes sorted by path, which reads as the tree: kept as is.
  const inHomepage = categories.filter((c) => c.sections.length > 0);
  const automatic = categories.filter((c): c is CatalogTerm & { automatic: RailCollection } => c.automatic != null);

  if (categories.length === 0) return <EmptyNote text={h.noCategories} />;

  return (
    <>
      {inHomepage.length > 0 && (
        <>
          <BlockTitle>{h.groups.inHomepage}</BlockTitle>
          <List strong inset>
            {inHomepage.map((term) => (
              <TermRow
                key={term.id}
                term={term}
                title={term.path}
                text={term.sections.map((s) => s.title || s.key).join(" · ")}
                media={
                  <Tile tone="ink">
                    <House className="h-[18px] w-[18px]" />
                  </Tile>
                }
              />
            ))}
          </List>
        </>
      )}

      {automatic.length > 0 && (
        <>
          <BlockTitle>{h.groups.automatic}</BlockTitle>
          <List strong inset>
            {automatic.map((term) => (
              <TermRow
                key={term.id}
                term={term}
                title={term.path}
                text={ruleLine(term.automatic, t)}
                media={
                  <Tile tone={ruleWorking(term.automatic) ? "gold" : "muted"}>
                    <Funnel className="h-[18px] w-[18px]" />
                  </Tile>
                }
              />
            ))}
          </List>
        </>
      )}

      <BlockTitle>
        <span>{h.groups.allCategories}</span>
        <button
          type="button"
          onClick={() => onOrder(order === "name" ? "count" : "name")}
          aria-label={order === "name" ? h.order.toCount : h.order.toName}
          className="-my-3 -me-2 flex h-11 items-center gap-1 px-2 text-[15px] font-normal text-primary transition-opacity active:opacity-50"
        >
          {order === "name" ? h.order.name : h.order.count}
          <SortArrows className="h-4 w-4" />
        </button>
      </BlockTitle>
      <List strong inset>
        {filled.map((term) => (
          <TermRow key={term.id} term={term} homeMark />
        ))}
        {showEmpty && empty.map((term) => <TermRow key={term.id} term={term} homeMark />)}
        {empty.length > 0 && (
          <ListButton onClick={() => setShowEmpty((v) => !v)}>
            {showEmpty ? h.hideEmpty : h.showEmpty(empty.length)}
          </ListButton>
        )}
      </List>
    </>
  );
}

/**
 * Where a letter's header sticks: right under the search bar once the large
 * title has folded away (Konsta's navbar: the top safe area or 16px, a 44px
 * bar, then the 56px search row).
 */
const STICKY_HEADER = "sticky top-[calc(max(16px,var(--k-safe-area-top))_+_100px)]";

export function BrandIndex({ brands }: { brands: CatalogTerm[] }) {
  const { t } = useI18n();
  const h = t.vetrinaCatalog.home;
  const [showEmpty, setShowEmpty] = React.useState(false);
  const top = React.useMemo(() => brands.filter((b) => b.parent === 0), [brands]);
  const emptyCount = top.filter((b) => b.count === 0).length;
  const groups = React.useMemo(
    () => byLetter(showEmpty ? top : top.filter((b) => b.count > 0)),
    [top, showEmpty],
  );

  if (top.length === 0) return <EmptyNote text={h.noBrands} />;

  return (
    <>
      <List strong className="!mb-4 !mt-6">
        {groups.map((group) => (
          <ListGroup key={group.letter}>
            <ListItem groupTitle title={group.letter} titleFontSizeIos="text-[15px] font-semibold" className={STICKY_HEADER} />
            {group.terms.map((term) => (
              <TermRow key={term.id} term={term} homeMark />
            ))}
          </ListGroup>
        ))}
      </List>
      {emptyCount > 0 && (
        <List strong inset className="!my-4">
          <ListButton onClick={() => setShowEmpty((v) => !v)}>
            {showEmpty ? h.hideEmptyBrands : h.showEmptyBrands(emptyCount)}
          </ListButton>
        </List>
      )}
    </>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <Block strong inset className="text-center text-[15px] opacity-70">
      {text}
    </Block>
  );
}

/** The rule fills the category on its own: on, not waiting, no error. */
function ruleWorking(rule: RailCollection): boolean {
  return rule.enabled && !rule.held && !rule.lastError;
}

/** The rule in words, after its state when it is not simply working: "In pausa · Tag «saldi»". */
function ruleLine(rule: RailCollection, t: Dictionary): string {
  const words = describeRule(rule, t.collections.words);
  const auto = t.vetrina.auto;
  const state = !rule.enabled ? auto.off : rule.held ? auto.held : rule.lastError ? auto.problem : null;
  return state ? `${state} · ${words}` : words;
}
