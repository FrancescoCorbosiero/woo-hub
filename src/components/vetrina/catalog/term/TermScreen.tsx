"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Block, Button, List, ListItem, Navbar, Page } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { describeRule } from "@/lib/collections/describe";
import type { RailCollection } from "@/lib/collections/types";
import type {
  CatalogPage,
  CatalogQuery,
  CatalogTaxonomy,
  CatalogTerm,
  CatalogTermDetail,
} from "@/lib/vetrina/catalog";
import { railKeyToParam } from "@/lib/vetrina/order";
import type { VetrinaErrorCode } from "@/lib/vetrina/types";
import type { VetrinaResult } from "@/server/vetrina/service";
import { CollectionSheet } from "../../CollectionSheet";
import { ErrorState } from "../../ErrorState";
import { Funnel } from "../../icons";
import { TabbarSpacer } from "../TabbarSpacer";
import { BackButton, SearchEverywhere, SearchField, useAppLink, useListControls } from "./browse";
import { ChipRow, FilterChips, NavChip } from "./FilterChips";
import { House, Stack } from "./glyphs";
import { backTarget, CATALOG_HOME, filterQuery, hasFilters, NO_FILTER, summaryParts, termHref } from "./list-model";
import { ProductList } from "./ProductList";
import { SortActions } from "./SortActions";

/**
 * A category's or a brand's screen. At the top, its control panel: the
 * automatic rule (categories), the homepage sections showing it, and what
 * is sold out, hidden or on sale. Then its sub-terms, the chips, and its
 * products, sub-terms' included, searched and sorted here.
 */
export function TermScreen({
  taxonomy,
  detail,
  page,
}: {
  taxonomy: CatalogTaxonomy;
  detail: VetrinaResult<CatalogTermDetail>;
  /** Page 1 in the shop's order, read with the term. */
  page: VetrinaResult<CatalogPage>;
}) {
  if (!detail.ok) return <TermError taxonomy={taxonomy} code={detail.code} error={detail.error} />;
  // Keyed: moving to a sibling term starts from a clean search and clean chips.
  return <Term key={`${taxonomy}:${detail.data.term.id}`} detail={detail.data} page={page} />;
}

function Term({ detail, page }: { detail: CatalogTermDetail; page: VetrinaResult<CatalogPage> }) {
  const { t } = useI18n();
  const router = useRouter();
  const v = t.vetrinaCatalog.term;
  const { term, ancestors, children } = detail;
  const initial = page.ok ? page.data : undefined;
  const controls = useListControls(initial?.facets ?? null);
  const { q, filter, sort, setFilter } = controls;
  const [ruleOpen, setRuleOpen] = React.useState(false);
  // Bumped when a rule moved products: the list reads its rows again.
  const [version, setVersion] = React.useState(0);

  const query = React.useMemo<CatalogQuery>(
    () => ({ taxonomy: term.taxonomy, termId: term.id, q: q || undefined, sort, ...filterQuery(filter) }),
    [term.taxonomy, term.id, q, sort, filter],
  );
  const searching = controls.text.trim() !== "";
  const back = backTarget(detail);
  const subtitle = [ancestors.map((a) => a.name).join(" › "), v.products(term.count)].filter(Boolean).join(" · ");
  const refreshCounts = React.useCallback(() => router.refresh(), [router]);

  return (
    <Page>
      <Navbar
        title={term.name}
        subtitle={subtitle}
        titleClassName="max-w-[calc(100%-152px)] truncate"
        subtitleClassName="truncate"
        left={<BackButton href={back.href} label={back.name ? v.backTo(back.name) : v.backToCatalog} />}
        subnavbar={<SearchField value={controls.text} onChange={controls.setText} placeholder={v.searchIn(term.name)} />}
      />

      {/* While searching, the results come first: with the keyboard up, the panel would hide them. */}
      {!searching && <ControlPanel term={term} onRule={() => setRuleOpen(true)} />}

      {!searching && children.length > 0 && (
        <div className="pb-1">
          <div className="px-5 pb-0.5 text-[13px] font-semibold uppercase tracking-wide opacity-50">
            {v.children[term.taxonomy]}
          </div>
          <ChipRow label={v.children[term.taxonomy]}>
            {children.map((child) => (
              <NavChip key={child.id} href={termHref(child.taxonomy, child.id)} label={child.name} count={child.count} />
            ))}
          </ChipRow>
        </div>
      )}

      {page.ok ? (
        <>
          <FilterChips facets={controls.facets} filter={filter} onChange={setFilter} taxonomy={term.taxonomy} />
          <ProductList
            query={query}
            initial={initial}
            demo={detail.demo}
            onFacets={controls.setFacets}
            toolbar={<SortActions sort={sort} onChange={controls.setSort} />}
            onClearFilters={hasFilters(filter) ? () => setFilter(NO_FILTER) : undefined}
            onProductsChanged={refreshCounts}
            version={version}
          />
        </>
      ) : (
        <ErrorState code={page.code} error={page.error} />
      )}

      {q && <SearchEverywhere q={q} />}
      <TabbarSpacer />

      {term.taxonomy === "category" && (
        <CollectionSheet
          termId={ruleOpen ? term.id : null}
          termName={term.name}
          onClose={() => setRuleOpen(false)}
          onChanged={() => {
            // The panel's rule and counts come from the server; the rows from the list.
            router.refresh();
            setVersion((n) => n + 1);
          }}
        />
      )}
    </Page>
  );
}

const ICON_TONES = {
  gold: "bg-[#d4a017] text-white",
  // White on the primary: globals.css turns it dark when the primary turns white.
  ink: "bg-primary text-white",
  muted: "bg-black/[0.07] text-black/55 dark:bg-white/15 dark:text-white/70",
};

/** The panel's icons: iOS Settings' rounded squares. */
function PanelIcon({ tone, children }: { tone: keyof typeof ICON_TONES; children: React.ReactNode }) {
  return <span className={`grid h-[30px] w-[30px] place-items-center rounded-[8px] ${ICON_TONES[tone]}`}>{children}</span>;
}

function ControlPanel({ term, onRule }: { term: CatalogTerm; onRule: () => void }) {
  const { t } = useI18n();
  const p = t.vetrinaCatalog.term.panel;
  const appLink = useAppLink();
  const summary = summaryParts(term, p);

  return (
    <List strong inset className="!mb-5 !mt-3">
      {term.taxonomy === "category" && <RuleRow collection={term.automatic} onOpen={onRule} />}
      {term.sections.length > 0 ? (
        term.sections.map((section) => (
          <ListItem
            key={section.key}
            link
            linkProps={appLink(`/vetrina/sezione/${railKeyToParam(section.key)}`)}
            media={
              <PanelIcon tone="ink">
                <House className="h-[18px] w-[18px]" />
              </PanelIcon>
            }
            title={<span className="line-clamp-2">{p.inHomepage(section.title)}</span>}
          />
        ))
      ) : (
        <ListItem
          media={
            <PanelIcon tone="muted">
              <House className="h-[18px] w-[18px]" />
            </PanelIcon>
          }
          title={<span className="opacity-50">{p.notInHomepage}</span>}
        />
      )}
      {term.count > 0 && (
        <ListItem
          media={
            <PanelIcon tone="muted">
              <Stack className="h-[18px] w-[18px]" />
            </PanelIcon>
          }
          title={summary.length > 0 ? summary.join(" · ") : p.allGood}
        />
      )}
    </List>
  );
}

/** "Automatica: <the rule in words>", with its state, like the section editor's card; or "Rendi automatica". */
function RuleRow({ collection, onOpen }: { collection: RailCollection | null; onOpen: () => void }) {
  const { t } = useI18n();
  const p = t.vetrinaCatalog.term.panel;
  const auto = t.vetrina.auto;
  const state = collection ? ruleState(collection, auto) : null;

  return (
    <ListItem
      link
      linkComponent="button"
      linkProps={{ type: "button", onClick: onOpen }}
      contentClassName="w-full text-start"
      media={
        <PanelIcon tone={collection?.enabled ? "gold" : "muted"}>
          <Funnel className="h-[18px] w-[18px]" />
        </PanelIcon>
      }
      title={
        <span className="line-clamp-2">
          {collection ? p.automatic(describeRule(collection, t.collections.words)) : auto.make}
        </span>
      }
      text={
        collection ? (
          state && <span className={state.warn ? "text-amber-700 dark:text-amber-400" : undefined}>{state.text}</span>
        ) : (
          p.makeHint
        )
      }
    />
  );
}

/** What a rule needs the owner to know, if anything: paused, waiting for a confirmation, a problem. */
function ruleState(
  c: RailCollection,
  auto: { cardPaused: string; heldHint: string; problem: string },
): { text: string; warn: boolean } | null {
  if (!c.enabled) return { text: auto.cardPaused, warn: false };
  if (c.held) return { text: auto.heldHint, warn: true };
  if (c.lastError) return { text: auto.problem, warn: true };
  return null;
}

function TermError({ taxonomy, code, error }: { taxonomy: CatalogTaxonomy; code: VetrinaErrorCode; error: string }) {
  const { t } = useI18n();
  const v = t.vetrinaCatalog.term;
  return (
    <Page>
      <Navbar title={v.catalog} left={<BackButton href={CATALOG_HOME} label={v.backToCatalog} />} />
      {code === "not_found" ? (
        // The server's own words are only the detail: here the term is simply gone.
        <Block strong inset className="space-y-4 text-center">
          <p className="text-[17px] leading-snug">{v.errors[taxonomy]}</p>
          <Button rounded large component={Link} href={CATALOG_HOME} className="w-full">
            {v.backToCatalog}
          </Button>
        </Block>
      ) : (
        <ErrorState code={code} error={error} />
      )}
      <TabbarSpacer />
    </Page>
  );
}
