"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Actions, ActionsButton, ActionsGroup, ActionsLabel, Block, Button, Link as KLink, Navbar, Page } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { CatalogPage, CatalogQuery, CatalogTaxonomy, CatalogTermDetail } from "@/lib/vetrina/catalog";
import type { VetrinaErrorCode } from "@/lib/vetrina/types";
import type { VetrinaResult } from "@/server/vetrina/service";
import { CollectionSheet } from "../../CollectionSheet";
import { ErrorState } from "../../ErrorState";
import { More } from "../../icons";
import type { OrderTerm } from "../act/OrderSheet";
import { ReorderSheet } from "../act/ReorderSheet";
import { useOrderSourceSheets } from "../sources/SourceOrderSheet";
import { useOperations } from "../act/operations-context";
import { useProductSelection } from "../act/selection";
import { NewCategorySheet, type NewCategoryRequest } from "../rules/NewCategorySheet";
import { ruleFromList } from "../rules/prefill";
import { TabbarSpacer } from "../TabbarSpacer";
import { BackButton, rememberShape, SearchEverywhere, SearchField, shapeOf, useListControls, useStart } from "./browse";
import { ControlPanel } from "./ControlPanel";
import { ChipRow, FilterChips, NavChip, withinRowShown } from "./FilterChips";
import { backTarget, CATALOG_HOME, filterQuery, hasFilters, NO_FILTER, termHref, type ListState } from "./list-model";
import { PositionsPanel } from "./PositionsPanel";
import { ProductList } from "./ProductList";
import { SortActions } from "./SortActions";
import { TermActionsPanel } from "./TermActionsPanel";

/**
 * A category's or a brand's screen. At the top, its control panel: the
 * automatic rule (categories), the homepage sections showing it, what is
 * sold out, hidden or on sale — and what the owner can do to all of it at
 * once: hide it from the shop ("Visibile nel negozio") and put it on sale.
 * Then its sub-terms, the chips, and its products, sub-terms' included,
 * searched, sorted and selected here. The "⋯" saves the list's filters as a
 * new automatic category.
 */
export function TermScreen({
  taxonomy,
  detail,
  page,
  served,
}: {
  taxonomy: CatalogTaxonomy;
  detail: VetrinaResult<CatalogTermDetail>;
  /** Page 1 of the list, read with the term. */
  page: VetrinaResult<CatalogPage>;
  /** The list state (search, chips, order) that page answers: the address's when the server read it. */
  served: ListState;
}) {
  if (!detail.ok) return <TermError taxonomy={taxonomy} code={detail.code} error={detail.error} />;
  // Keyed: moving to a sibling term starts from its own address, clean or not.
  return <Term key={`${taxonomy}:${detail.data.term.id}`} detail={detail.data} page={page} served={served} />;
}

function Term({
  detail,
  page,
  served,
}: {
  detail: CatalogTermDetail;
  page: VetrinaResult<CatalogPage>;
  served: ListState;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const v = t.vetrinaCatalog.term;
  const r = t.vetrinaCatalog.rules;
  const { term, ancestors, children } = detail;
  const { start, facets, initial } = useStart(page, served);
  const controls = useListControls(facets, start);
  const { q, filter, sort, setFilter } = controls;
  const ops = useOperations();
  const selection = useProductSelection();
  const [ruleOpen, setRuleOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [reorderOpen, setReorderOpen] = React.useState(false);
  const [newRule, setNewRule] = React.useState<NewCategoryRequest | null>(null);
  // Bumped when a rule moved products: the list reads its rows again.
  const [version, setVersion] = React.useState(0);

  const query = React.useMemo<CatalogQuery>(
    () => ({ taxonomy: term.taxonomy, termId: term.id, q: q || undefined, sort, ...filterQuery(filter) }),
    [term.taxonomy, term.id, q, sort, filter],
  );
  const searching = controls.text.trim() !== "";
  // Its positions are the ones its page on the shop follows: set by "Posiziona" (a selection), "Disponi a mano" (dragged), a ranking.
  const orderTerm = React.useMemo<OrderTerm>(
    () => ({ taxonomy: term.taxonomy, id: term.id, name: term.name, count: term.count }),
    [term.taxonomy, term.id, term.name, term.count],
  );
  const openReorder = term.count > 0 ? () => setReorderOpen(true) : undefined;
  // "Disponi come «X»": the rankings (order sources), and their sheets.
  const sourceSheets = useOrderSourceSheets();
  const back = backTarget(detail);
  const subtitle = [ancestors.map((a) => a.name).join(" › "), v.products(term.count)].filter(Boolean).join(" · ");
  const refreshCounts = React.useCallback(() => router.refresh(), [router]);
  /** Products moved outside the tracker (a rule, the hidden term's newcomers): the panel's counts and the rows, read again. */
  const refreshAll = React.useCallback(() => {
    router.refresh();
    setVersion((n) => n + 1);
  }, [router]);

  // Its skeleton, next time, takes the room this screen takes (the chips' row once the facets say).
  const withinShown = controls.facets ? withinRowShown(controls.facets, filter) : null;
  React.useEffect(() => {
    rememberShape(term.taxonomy, term.id, withinShown == null ? shapeOf(term) : { ...shapeOf(term), within: withinShown });
  }, [term, withinShown]);

  /** The list as it is filtered now, as a new automatic category's rule. */
  function saveAsRule() {
    setMenuOpen(false);
    const prefill = ruleFromList({
      term: { taxonomy: term.taxonomy, id: term.id, path: term.path },
      status: filter.status,
      within: filter.within,
      q,
    });
    setNewRule({
      conditions: prefill.conditions,
      from: r.fromList(term.name),
      notes: prefill.notes.map((note) => r.notes[note]),
    });
  }

  return (
    // The search bar's close button waits just past the right edge, scaled
    // to nothing: the page must not scroll sideways to it.
    <Page className="!overflow-x-hidden">
      <Navbar
        title={term.name}
        subtitle={subtitle}
        titleClassName="max-w-[calc(100%-152px)] truncate"
        subtitleClassName="truncate"
        left={<BackButton href={back.href} label={back.name ? v.backTo(back.name) : v.backToCatalog} />}
        right={
          <KLink iconOnly onClick={() => setMenuOpen(true)} aria-label={v.menu.open} aria-haspopup="dialog">
            <More className="h-6 w-6" />
          </KLink>
        }
        subnavbar={<SearchField value={controls.text} onChange={controls.setText} placeholder={v.searchIn(term.name)} />}
      />

      {/* While searching, the results come first: with the keyboard up, the panel would hide them. */}
      {!searching && (
        <>
          <ControlPanel term={term} onRule={() => setRuleOpen(true)} />
          <TermActionsPanel term={term} onChanged={refreshAll} />
          {term.count > 0 && (
            <PositionsPanel
              term={term}
              onArrange={() => setReorderOpen(true)}
              onRanking={(source) => sourceSheets.apply(source, orderTerm)}
              onManageRankings={sourceSheets.manage}
              onPlace={() => {
                selection.start();
                toast(v.positions.selecting);
              }}
            />
          )}
        </>
      )}

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
            toolbar={
              <SortActions sort={sort} onChange={controls.setSort} onReorder={openReorder} />
            }
            onClearFilters={hasFilters(filter) ? () => setFilter(NO_FILTER) : undefined}
            onProductsChanged={refreshCounts}
            version={version}
            selection={selection}
            listName={term.name}
            orderTerm={orderTerm}
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
          // The panel's rule and counts come from the server; the rows from the list.
          onChanged={refreshAll}
        />
      )}

      <Actions opened={menuOpen} onBackdropClick={() => setMenuOpen(false)}>
        <ActionsGroup>
          <ActionsLabel>{term.name}</ActionsLabel>
          {openReorder && (
            <ActionsButton
              onClick={() => {
                setMenuOpen(false);
                openReorder();
              }}
            >
              {v.menu.reorder}
            </ActionsButton>
          )}
          <ActionsButton onClick={saveAsRule}>{v.menu.saveRule}</ActionsButton>
          <ActionsButton
            onClick={() => {
              setMenuOpen(false);
              ops.openActivity();
            }}
          >
            {v.menu.activity}
          </ActionsButton>
        </ActionsGroup>
        <ActionsGroup>
          <ActionsButton bold onClick={() => setMenuOpen(false)}>
            {v.menu.cancel}
          </ActionsButton>
        </ActionsGroup>
      </Actions>

      <NewCategorySheet request={newRule} onClose={() => setNewRule(null)} />
      <ReorderSheet term={reorderOpen ? orderTerm : null} onClose={() => setReorderOpen(false)} />
      {sourceSheets.sheets}
    </Page>
  );
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
