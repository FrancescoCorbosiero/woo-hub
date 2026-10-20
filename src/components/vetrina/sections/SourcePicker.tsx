"use client";

import * as React from "react";
import { useI18n } from "@/i18n/provider";
import type { CatalogTerm } from "@/lib/vetrina/catalog";
import { sameSource } from "@/lib/vetrina/sections";
import type { RailList, RailSource } from "@/lib/vetrina/types";
import { Funnel } from "../icons";
import { formatCount } from "../catalog/format";
import { useCatalogOverview } from "../catalog/act/data";
import { matches } from "../catalog/act/model";
import { FailedCard, LoadingRows, ModeSwitch, PickList, PickRow, SheetSearch } from "../catalog/act/parts";
import { Check, Folder, Stack, Tag } from "../catalog/term/glyphs";

/**
 * What a section shows, picked: one of the shop's categories (by name or
 * path), one of its brands (A–Z), or a shop-wide list (the newest, the best
 * sellers, what is on sale). What the section shows now is marked; a
 * category or brand says how many products it holds and which sections
 * already show it.
 */

export interface PickedSource {
  source: RailSource;
  /** As the screens say it: "Saldi", "Nike", "Più venduti". */
  name: string;
  /** The products a category or brand holds; null for a list. */
  count: number | null;
  /** A category an automatic rule fills. */
  automatic: boolean;
}

type Tab = "category" | "brand" | "list";

/** Rows drawn at most: a search narrows the rest. */
const MAX_ROWS = 150;
const collator = new Intl.Collator("it", { sensitivity: "base", numeric: true });

export function SourcePicker({
  current,
  lists,
  onPick,
}: {
  /** What the section shows now (a new section: nothing). */
  current: RailSource | null;
  lists: readonly RailList[];
  onPick: (picked: PickedSource) => void;
}) {
  const { t } = useI18n();
  const p = t.vetrinaCatalog.sections.pick;
  const [tab, setTab] = React.useState<Tab>(current && "list" in current ? "list" : current?.taxonomy ?? "category");
  const [text, setText] = React.useState("");
  const overview = useCatalogOverview();

  const tabs: { value: Tab; label: string }[] = [
    { value: "category", label: p.tabs.category },
    { value: "brand", label: p.tabs.brand },
    ...(lists.length > 0 ? [{ value: "list" as const, label: p.tabs.list }] : []),
  ];

  return (
    <>
      <ModeSwitch value={tab} options={tabs} onChange={setTab} label={p.tabsLabel} className="" />
      {tab === "list" ? (
        <>
          <p className="px-1 text-[14px] leading-snug opacity-60">{p.listsIntro}</p>
          <PickList label={p.tabs.list}>
            {lists.map((list) => {
              const source: RailSource = { list };
              const now = sameSource(current, source);
              return (
                <PickRow
                  key={list}
                  disabled={now}
                  media={<Badge kind="list" />}
                  title={p.lists[list]?.title ?? list}
                  subtitle={<span className="line-clamp-2">{p.lists[list]?.hint}</span>}
                  after={now ? <Current label={p.current} /> : undefined}
                  onPick={() => onPick({ source, name: p.lists[list]?.title ?? list, count: null, automatic: false })}
                />
              );
            })}
          </PickList>
        </>
      ) : (
        <>
          <SheetSearch value={text} onChange={setText} placeholder={p.search[tab]} />
          {overview.error != null && !overview.data ? (
            <FailedCard message={p.failed} onRetry={() => void overview.mutate()} />
          ) : !overview.data ? (
            <LoadingRows label={p.loading} />
          ) : (
            <TermRows
              taxonomy={tab}
              terms={tab === "category" ? overview.data.categories : overview.data.brands}
              text={text}
              current={current}
              onPick={onPick}
            />
          )}
        </>
      )}
    </>
  );
}

function TermRows({
  taxonomy,
  terms,
  text,
  current,
  onPick,
}: {
  taxonomy: "category" | "brand";
  terms: readonly CatalogTerm[];
  text: string;
  current: RailSource | null;
  onPick: (picked: PickedSource) => void;
}) {
  const { t, locale } = useI18n();
  const p = t.vetrinaCatalog.sections.pick;
  const found = React.useMemo(
    () =>
      terms
        .filter((term) => matches(term.path, text))
        .sort((a, b) => (taxonomy === "category" ? collator.compare(a.path, b.path) : collator.compare(a.name, b.name))),
    [terms, text, taxonomy],
  );

  if (found.length === 0) return <p className="px-1 py-6 text-center text-[15px] opacity-60">{p.empty}</p>;
  return (
    <PickList label={p.tabs[taxonomy]}>
      {found.slice(0, MAX_ROWS).map((term) => {
        const source: RailSource = { taxonomy, slug: term.slug };
        const now = sameSource(current, source);
        const cut = term.path.lastIndexOf(" › ");
        const parents = cut >= 0 ? term.path.slice(0, cut) : "";
        const automatic = term.automatic != null;
        const note = [
          parents,
          automatic ? p.automatic : "",
          term.sections.length > 0 ? p.inHomepage(term.sections.map((s) => s.title).join(", ")) : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <PickRow
            key={term.id}
            disabled={now}
            media={<Badge kind={taxonomy} automatic={automatic} />}
            title={term.name}
            subtitle={note ? <span className="line-clamp-2">{note}</span> : undefined}
            after={now ? <Current label={p.current} /> : <span className="tabular-nums">{formatCount(term.count, locale)}</span>}
            onPick={() => onPick({ source, name: term.name, count: term.count, automatic })}
          />
        );
      })}
    </PickList>
  );
}

function Current({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1 text-[14px] text-primary">
      <Check className="h-4 w-4" />
      {label}
    </span>
  );
}

/** A category's folder (a funnel when a rule fills it), a brand's tag, a list's stack. */
export function Badge({ kind, automatic = false }: { kind: Tab; automatic?: boolean }) {
  const Icon = kind === "list" ? Stack : kind === "brand" ? Tag : automatic ? Funnel : Folder;
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/[0.06] dark:bg-white/10">
      <Icon className="h-[18px] w-[18px] opacity-70" />
    </span>
  );
}
