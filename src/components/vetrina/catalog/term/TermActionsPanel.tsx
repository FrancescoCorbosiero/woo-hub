"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Actions, ActionsButton, ActionsGroup, ActionsLabel, Button, List, ListItem, Toggle } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { CatalogTaxonomy, CatalogTerm } from "@/lib/vetrina/catalog";
import type { OperationTarget, OperationView, TermActionsState, TermKey } from "@/lib/vetrina/catalog-ops";
import { hideTermNewcomers, loadTermActions } from "@/server/actions/vetrina-operations";
import { EyeOff } from "../../icons";
import { ActSheets, type ActRequest } from "../act/ActSheets";
import { call } from "../act/call";
import { Eye, Percent } from "../act/icons";
import { formatDay, formatTime, queryTarget } from "../act/model";
import { useOperations, useOperationSettled } from "../act/operations-context";
import { MarginRow } from "../margins/MarginRow";
import {
  hasActions,
  saleState,
  saleUndoBack,
  toggleOn,
  visibilityState,
  type SaleState,
  type VisibilityState,
} from "./panel-model";
import { PanelIcon } from "./PanelIcon";
import { Ghost } from "./TermSkeleton";

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
export function TermActionsPanel({
  term,
  onChanged,
}: {
  term: CatalogTerm;
  /** Products changed by what the tracker does not follow (the newcomers' hide): the screen reads its counts and rows again. */
  onChanged: () => void;
}) {
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
  if (showingAll && vis.kind !== "allHidden" && vis.kind !== "loading") setShowingAll(null);
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

  const [hidingAdded, setHidingAdded] = React.useState(false);
  /** "Nascondi i nuovi arrivati": the products that joined the hidden term since, hidden now under its hide. */
  async function hideAdded() {
    setHidingAdded(true);
    const res = await call(() => hideTermNewcomers(), t.vetrinaCatalog.act.sheet.network);
    if (!res.ok) toast.error(res.error);
    await actions.mutate();
    setHidingAdded(false);
    // Not an action the tracker follows: the counts row and the rows' "Nascosto" are read again here.
    // A failure too: some may have been hidden before it stopped.
    onChanged();
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

  function undoSaleLabel(state: Extract<SaleState, { kind: "on" }>): string {
    const back = saleUndoBack(state);
    if (back.kind === "percent") return p.saleUndoBack(back.percent);
    if (back.kind === "end") return p.saleUndoBackEnd(back.endsOn ? formatDay(back.endsOn, locale) : null);
    return p.saleUndo;
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
                // Held by another hidden term, it cannot be switched here: it looks so, not like a switch that is merely off.
                className={`${SWITCH_TARGET} ${vis.kind === "held" ? "opacity-40" : ""}`}
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
        {/* Joined the term after its hide and still showing: hidden with it shortly, or now from here. */}
        {vis.kind === "hidden" && vis.addedSince > 0 && (
          <ListItem
            link
            linkComponent="button"
            linkProps={{ type: "button", disabled: hidingAdded, onClick: () => void hideAdded() }}
            contentClassName="w-full text-start"
            media={
              <PanelIcon tone="muted">
                <EyeOff className="h-[18px] w-[18px]" />
              </PanelIcon>
            }
            title={<span className="text-primary">{hidingAdded ? p.hidingAdded : p.hideAdded(vis.addedSince)}</span>}
            text={p.hideAddedHint}
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
                ...(sale.kind === "on"
                  ? { percent: sale.percent, endsOn: sale.endsOn, rounding: sale.rounding, change: true }
                  : {}),
              });
            }}
          >
            {p.saleChange}
          </ActionsButton>
          {sale.kind === "on" && sale.view.undoable && (
            <ActionsButton onClick={undoSale}>{undoSaleLabel(sale)}</ActionsButton>
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
              : p.hiddenSince(formatTime(new Date().toISOString(), locale), counts.count)}
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
            : p.hiddenSince(formatTime(state.view.finishedAt ?? state.view.createdAt, locale), counts.count)}
        </>
      );
    case "showing":
      return <>{live(state.view).queued ? p.waiting : p.showing(counts.count)}</>;
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
