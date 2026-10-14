"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Actions,
  ActionsButton,
  ActionsGroup,
  ActionsLabel,
  Block,
  Button,
  Link as KLink,
  List,
  ListItem,
  Navbar,
  Page,
  Toggle,
} from "konsta/react";
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
import type { OperationTarget, OperationView, TermActionsState, TermKey } from "@/lib/vetrina/catalog-ops";
import type { VetrinaErrorCode } from "@/lib/vetrina/types";
import { loadTermActions } from "@/server/actions/vetrina-operations";
import type { VetrinaResult } from "@/server/vetrina/service";
import { CollectionSheet } from "../../CollectionSheet";
import { ErrorState } from "../../ErrorState";
import { EyeOff, Funnel, More } from "../../icons";
import { ActSheets, type ActRequest } from "../act/ActSheets";
import { Eye, Percent } from "../act/icons";
import { formatDay, formatTime, queryTarget } from "../act/model";
import { useOperations, useOperationSettled } from "../act/operations-context";
import { useProductSelection } from "../act/selection";
import { MarginRow } from "../margins/MarginRow";
import { ruleState } from "../rule-state";
import { NewCategorySheet, type NewCategoryRequest } from "../rules/NewCategorySheet";
import { ruleFromList } from "../rules/prefill";
import { sectionHref } from "../sheet/links";
import { TabbarSpacer } from "../TabbarSpacer";
import {
  BackButton,
  rememberShape,
  SearchEverywhere,
  SearchField,
  shapeOf,
  useAppLink,
  useListControls,
  useStart,
} from "./browse";
import { ChipRow, FilterChips, NavChip, withinRowShown } from "./FilterChips";
import { House, Stack } from "./glyphs";
import {
  backTarget,
  CATALOG_HOME,
  filterQuery,
  hasFilters,
  NO_FILTER,
  summaryParts,
  termHref,
  type ListState,
} from "./list-model";
import { hasActions, saleState, toggleOn, visibilityState, type SaleState, type VisibilityState } from "./panel-model";
import { ProductList } from "./ProductList";
import { SortActions } from "./SortActions";
import { Ghost } from "./TermSkeleton";

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
  const [newRule, setNewRule] = React.useState<NewCategoryRequest | null>(null);
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
          <TermActionsPanel term={term} />
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
            toolbar={<SortActions sort={sort} onChange={controls.setSort} />}
            onClearFilters={hasFilters(filter) ? () => setFilter(NO_FILTER) : undefined}
            onProductsChanged={refreshCounts}
            version={version}
            selection={selection}
            listName={term.name}
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

      <Actions opened={menuOpen} onBackdropClick={() => setMenuOpen(false)}>
        <ActionsGroup>
          <ActionsLabel>{term.name}</ActionsLabel>
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
    </Page>
  );
}

const ICON_TONES = {
  gold: "bg-[#d4a017] text-white",
  // White on the primary: globals.css turns it dark when the primary turns white.
  ink: "bg-primary text-white",
  muted: "bg-black/[0.07] text-black/55 dark:bg-white/15 dark:text-white/70",
  // iOS's own green and red, as Settings uses them.
  green: "bg-[#34c759] text-white dark:bg-[#30d158]",
  red: "bg-[#ff3b30] text-white dark:bg-[#ff453a]",
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
            linkProps={appLink(sectionHref(section.key))}
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

/* ---------------------------------------------------------------- *
 * The term's actions: Visibile nel negozio, Saldo
 * ---------------------------------------------------------------- */

const TERM_ACTIONS_KEY = "vetrina-term-actions";

async function fetchTermActions([, taxonomy, id]: readonly [string, CatalogTaxonomy, number]): Promise<TermActionsState> {
  const res = await loadTermActions({ taxonomy, id });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/**
 * The actions standing on a whole term — its hide, its sale — read when the
 * screen opens (kept for the next visit) and again whenever an action ends.
 */
function useTermActions(taxonomy: CatalogTaxonomy, id: number) {
  const swr = useSWR([TERM_ACTIONS_KEY, taxonomy, id] as const, fetchTermActions, {
    shouldRetryOnError: false,
    dedupingInterval: 2_000,
  });
  useOperationSettled(() => void swr.mutate());
  return swr;
}

// A switch in the iOS green: Konsta's own takes the primary, which turns white in dark mode.
const TOGGLE_COLORS = { checkedBgIos: "bg-[#34c759] dark:bg-[#30d158]" };
/** The switch reaches 44px with an invisible margin. */
const SWITCH_TARGET = "relative before:absolute before:-inset-x-2 before:-inset-y-2 before:content-['']";
const DANGER_TEXT = { textIos: "text-red-600 dark:text-red-500", textMaterial: "text-red-600 dark:text-red-400" };

/** While the term's actions are read, the rows hold the words they will most likely show, as ghosts: nothing jumps when they land. */
const GHOST = "motion-safe:animate-pulse";

/**
 * "Visibile nel negozio" and "Saldo" for the whole term. Turning the switch
 * off previews a hide of every product in it, then hides them; on again, it
 * undoes exactly that hide (a product hidden before stays hidden). Products
 * hidden one by one, by no hide of the term, are shown with "Mostra i N
 * nascosti" — not those another hidden category or brand holds: that one's
 * switch brings them back, and the row says so. The sale row puts the whole
 * term on sale, or changes or ends the sale standing on it.
 */
function TermActionsPanel({ term }: { term: CatalogTerm }) {
  const { t, locale } = useI18n();
  const p = t.vetrinaCatalog.term.panel;
  const ops = useOperations();
  const actions = useTermActions(term.taxonomy, term.id);
  const termKey = `${term.taxonomy}:${term.id}` as TermKey;
  const target = React.useMemo<OperationTarget>(
    () => queryTarget({ taxonomy: term.taxonomy, termId: term.id }),
    [term.taxonomy, term.id],
  );
  const hiddenTarget = React.useMemo<OperationTarget>(
    () => queryTarget({ taxonomy: term.taxonomy, termId: term.id, visibility: "hidden" }),
    [term.taxonomy, term.id],
  );

  const [act, setAct] = React.useState<ActRequest | null>(null);
  const [saleMenu, setSaleMenu] = React.useState(false);
  // What the owner just asked of the switch, shown at once: "hide" while its
  // confirmation is open, "show" while "Mostra" is being asked for.
  const [intent, setIntent] = React.useState<"hide" | "show" | null>(null);
  // The switch's own "show them all" is running (products hidden one by one): it stays on meanwhile.
  const [showingAll, setShowingAll] = React.useState<string | null>(null);
  const showAllAsked = React.useRef(false);

  const loaded = actions.data;
  const failed = actions.error != null && loaded == null;
  const vis = visibilityState(term, loaded);
  const sale = saleState(term, loaded);
  /** An action as the tracker sees it now: its progress while it runs. */
  const live = (view: OperationView) => ops.active.find((a) => a.id === view.id) ?? view;

  // The counts came back from the server with the products shown: the switch reads them again.
  React.useEffect(() => {
    if (showingAll && vis.kind !== "allHidden" && vis.kind !== "loading") setShowingAll(null);
  }, [showingAll, vis.kind]);
  useOperationSettled((view, outcome) => {
    // Shown again: the counts are on their way (the list refreshes the screen). Otherwise it is off again.
    if (view.id === showingAll && (outcome !== "done" || view.changed === 0)) setShowingAll(null);
  });

  let on = toggleOn(vis);
  if (intent === "hide") on = false;
  if (intent === "show" || (vis.kind === "allHidden" && showingAll)) on = true;
  const switchable =
    !failed &&
    intent == null &&
    showingAll == null &&
    (vis.kind === "visible" || vis.kind === "hidden" || vis.kind === "allHidden");

  function flip() {
    if (!switchable) return;
    if (vis.kind === "visible") {
      // Off: the whole term's hide, after its preview (what it touches, which sections lose products).
      setIntent("hide");
      setAct({ kind: "hide", target, label: term.name, termKey, switchable: false });
    } else if (vis.kind === "hidden") {
      // On: undo exactly the hide that stands — those hidden before it stay hidden.
      setIntent("show");
      void ops.undo(vis.view.id).then((res) => {
        if (res.ok) void actions.mutate((state) => (state ? { ...state, hiddenBy: res.data } : state), { revalidate: true });
        setIntent(null);
      });
    } else if (vis.kind === "allHidden") {
      // On, with no hide of the term to undo: show the products hidden one by one, after their preview.
      setIntent("show");
      showAllAsked.current = true;
      openShowHidden(vis.hidden);
    }
  }

  function openShowHidden(count: number) {
    // Only those hidden one by one: what another hidden term holds stays for its own "Mostra".
    setAct({ kind: "show", target: hiddenTarget, label: p.hiddenOf(count, term.name), switchable: false, keepHeld: true });
  }

  function closeSheet() {
    setAct(null);
    setIntent(null);
  }

  /**
   * "Togli il saldo": always the end of the sale — every product in the
   * term back to full price, after its preview, filed under the term so its
   * screen lets the sale go. Never an undo: an undo puts back what was there
   * before this sale, which may be an earlier sale (that is "Annulla").
   */
  function stopSale() {
    setSaleMenu(false);
    if (sale.kind !== "on") return;
    setAct({ kind: "unsale", target, label: term.name, termKey });
  }

  /** "Annulla questo saldo" (or the change of discount): the prices from before it come back, an earlier sale's too. */
  function undoSale() {
    setSaleMenu(false);
    if (sale.kind !== "on" || !sale.view.undoable) return;
    void ops.undo(sale.view.id).then((res) => {
      if (!res.ok) return;
      void actions.mutate(
        (state) => (state?.sale ? { ...state, sale: { ...state.sale, operation: res.data } } : state),
        { revalidate: true },
      );
    });
  }

  function started(view: OperationView) {
    if (view.kind === "hide" && view.termKey === termKey) {
      // The switch stays off: the hide that just started is the one standing.
      void actions.mutate((state) => (state ? { ...state, hiddenBy: view } : state), { revalidate: true });
    } else {
      void actions.mutate();
    }
    if (view.kind === "show" && showAllAsked.current) setShowingAll(view.id);
    showAllAsked.current = false;
  }

  if (!hasActions(term, loaded)) return null;

  return (
    <>
      <List strong inset className="!mb-5 !mt-0">
        {/* Only the switch flips, as in iOS Settings: a tap on the row's words starts nothing. */}
        <ListItem
          media={
            <PanelIcon tone={on ? "green" : "muted"}>
              {on ? <Eye className="h-[18px] w-[18px]" /> : <EyeOff className="h-[18px] w-[18px]" />}
            </PanelIcon>
          }
          title={p.visible}
          text={
            failed ? (
              p.stateFailed
            ) : (
              <VisibilityText state={vis} counts={term} showingAll={showingAll} live={live} locale={locale} />
            )
          }
          after={
            failed ? (
              <Button small rounded tonal inline onClick={() => void actions.mutate()} className="!h-11 !px-4">
                {p.retry}
              </Button>
            ) : (
              <Toggle
                className={SWITCH_TARGET}
                checked={on}
                disabled={!switchable}
                onChange={flip}
                colors={TOGGLE_COLORS}
                aria-label={p.visible}
              />
            )
          }
        />
        {/* Some hidden one by one, most likely: the row it will have, still to be confirmed. */}
        {vis.kind === "loading" && term.hidden > 0 && term.hidden < term.count && (
          <ListItem
            media={
              <PanelIcon tone="muted">
                <Eye className="h-[18px] w-[18px]" />
              </PanelIcon>
            }
            title={<Ghost className={GHOST}>{p.showHidden(term.hidden)}</Ghost>}
          />
        )}
        {vis.kind === "visible" && vis.hiddenHere > 0 && (
          <ListItem
            link
            linkComponent="button"
            linkProps={{
              type: "button",
              onClick: () => {
                // Not the switch's own "show them all": the switch stays as it is.
                showAllAsked.current = false;
                openShowHidden(vis.hiddenHere);
              },
            }}
            contentClassName="w-full text-start"
            media={
              <PanelIcon tone="muted">
                <Eye className="h-[18px] w-[18px]" />
              </PanelIcon>
            }
            title={<span className="text-primary">{p.showHidden(vis.hiddenHere)}</span>}
          />
        )}
        {!failed && (
          <SaleRow
            state={sale}
            live={live}
            onStart={() => setAct({ kind: "sale", target, label: term.name, termKey })}
            onMenu={() => setSaleMenu(true)}
            onActivity={ops.openActivity}
          />
        )}
        {/* The margin the Hub prices the term's products with (phase 4): read on its own, shown where it can act —
            after the panel's own read, which it would otherwise hold up (server actions run one at a time). */}
        <MarginRow term={term} ready={loaded != null || failed} />
      </List>

      <Actions opened={saleMenu} onBackdropClick={() => setSaleMenu(false)}>
        <ActionsGroup>
          {sale.kind === "on" && (
            // Konsta's label is one 56px row: a title and its note need their own lines, as iOS's action sheets give them.
            <ActionsLabel className="!h-auto min-h-14 py-3">
              <span className="flex flex-col items-center gap-0.5 text-center">
                <span className="font-semibold">{p.saleMenu(sale.percent, term.name)}</span>
                <span>{p.saleStopHint}</span>
              </span>
            </ActionsLabel>
          )}
          <ActionsButton
            onClick={() => {
              setSaleMenu(false);
              // The change keeps what the running sale was asked with: its last day, its rounding.
              setAct({
                kind: "sale",
                target,
                label: term.name,
                termKey,
                ...(sale.kind === "on" ? { percent: sale.percent, endsOn: sale.endsOn, rounding: sale.rounding } : {}),
              });
            }}
          >
            {p.saleChange}
          </ActionsButton>
          {sale.kind === "on" && sale.view.undoable && (
            <ActionsButton onClick={undoSale}>
              {sale.replaces != null ? p.saleUndoBack(sale.replaces) : p.saleUndo}
            </ActionsButton>
          )}
          <ActionsButton colors={DANGER_TEXT} onClick={stopSale}>
            {p.saleStop}
          </ActionsButton>
        </ActionsGroup>
        <ActionsGroup>
          <ActionsButton bold onClick={() => setSaleMenu(false)}>
            {p.cancel}
          </ActionsButton>
        </ActionsGroup>
      </Actions>

      <ActSheets request={act} onClose={closeSheet} onStarted={started} />
    </>
  );
}

/** Under "Visibile nel negozio": how things stand, or how far the action got. */
function VisibilityText({
  state,
  counts,
  showingAll,
  live,
  locale,
}: {
  state: VisibilityState;
  /** The term's counts: while its actions are read, they say which words are coming. */
  counts: { count: number; hidden: number };
  showingAll: string | null;
  live: (view: OperationView) => OperationView;
  locale: string;
}) {
  const { t } = useI18n();
  const p = t.vetrinaCatalog.term.panel;
  const ops = useOperations();
  switch (state.kind) {
    case "loading":
      return (
        <Ghost className={GHOST}>
          {counts.hidden === 0
            ? p.visibleHint
            : counts.hidden < counts.count
              ? p.hiddenOneByOne(counts.hidden)
              : p.hiddenSince(formatTime(new Date().toISOString(), locale))}
        </Ghost>
      );
    case "visible": {
      const parts = [
        state.hiddenHere > 0 ? p.hiddenOneByOne(state.hiddenHere) : null,
        state.held.count > 0 ? p.heldBy(state.held.count, state.held.terms) : null,
      ].filter(Boolean);
      return <>{parts.length > 0 ? parts.join(" · ") : p.visibleHint}</>;
    }
    case "allHidden": {
      const running = showingAll ? ops.active.find((a) => a.id === showingAll) : undefined;
      if (running) return <>{running.queued ? p.waiting : p.showingAll(running.progress.done, running.progress.total)}</>;
      if (state.held.count === 0) return <>{p.allHiddenOneByOne}</>;
      return <>{`${p.hiddenOneByOne(state.hidden)} · ${p.heldBy(state.held.count, state.held.terms)}`}</>;
    }
    case "held":
      return <>{p.heldBy(state.held.count, state.held.terms)}</>;
    case "hiding": {
      const now = live(state.view);
      return <>{now.queued ? p.waiting : p.hiding(now.progress.done, now.progress.total)}</>;
    }
    case "hidden":
      return (
        <>
          {state.view.status === "failed"
            ? p.hiddenPartly(state.view.changed, state.view.progress.total)
            : p.hiddenSince(formatTime(state.view.finishedAt ?? state.view.createdAt, locale))}
        </>
      );
    case "showing":
      return <>{live(state.view).queued ? p.waiting : p.showing}</>;
  }
}

/** "Metti in saldo"; or the sale standing on the term ("Saldo −20%", until when), which a tap changes or ends. */
function SaleRow({
  state,
  live,
  onStart,
  onMenu,
  onActivity,
}: {
  state: SaleState;
  live: (view: OperationView) => OperationView;
  onStart: () => void;
  onMenu: () => void;
  onActivity: () => void;
}) {
  const { t, locale } = useI18n();
  const p = t.vetrinaCatalog.term.panel;
  const tone = state.kind === "on" || state.kind === "busy" ? "red" : "muted";
  const media = (
    <PanelIcon tone={tone}>
      <Percent className="h-[18px] w-[18px]" />
    </PanelIcon>
  );

  if (state.kind === "loading") {
    return (
      <ListItem
        media={media}
        title={p.sale}
        text={<Ghost className={GHOST}>{state.onSale > 0 ? p.saleOthers(state.onSale) : p.saleHint}</Ghost>}
      />
    );
  }

  let title: string;
  let text: string;
  let onTap: () => void;
  if (state.kind === "none") {
    title = p.saleStart;
    text = state.onSale > 0 ? p.saleOthers(state.onSale) : p.saleHint;
    onTap = onStart;
  } else if (state.kind === "busy") {
    const now = live(state.view);
    title = p.saleOn(state.percent);
    text =
      now.status === "undoing" ? p.saleUndoing : now.queued ? p.waiting : p.saleRunning(now.progress.done, now.progress.total);
    // While it runs, the log is where it can be followed.
    onTap = onActivity;
  } else {
    title = p.saleOn(state.percent);
    text = state.endsOn ? p.saleUntil(formatDay(state.endsOn, locale)) : p.saleNoEnd;
    onTap = onMenu;
  }

  return (
    <ListItem
      link
      linkComponent="button"
      linkProps={{ type: "button", onClick: onTap, "aria-haspopup": state.kind === "on" ? "dialog" : undefined }}
      contentClassName="w-full text-start"
      media={media}
      title={title}
      text={text}
    />
  );
}

/** "Automatica: <the rule in words>", with its state, like the section editor's card; or "Rendi automatica". */
function RuleRow({ collection, onOpen }: { collection: RailCollection | null; onOpen: () => void }) {
  const { t } = useI18n();
  const p = t.vetrinaCatalog.term.panel;
  const auto = t.vetrina.auto;
  const state = collection ? ruleState(collection) : null;
  const note =
    state === "paused"
      ? { text: auto.cardPaused, warn: false }
      : state === "held"
        ? { text: auto.heldHint, warn: true }
        : state === "problem"
          ? { text: auto.problem, warn: true }
          : null;

  return (
    <ListItem
      link
      linkComponent="button"
      linkProps={{ type: "button", onClick: onOpen }}
      contentClassName="w-full text-start"
      media={
        <PanelIcon tone={state === "working" ? "gold" : "muted"}>
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
          note && <span className={note.warn ? "text-amber-700 dark:text-amber-400" : undefined}>{note.text}</span>
        ) : (
          p.makeHint
        )
      }
    />
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
