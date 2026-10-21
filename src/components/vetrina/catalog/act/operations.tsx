"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Preloader } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import type { OperationInput, OperationView } from "@/lib/vetrina/catalog-ops";
import { isPageActionKind } from "@/lib/vetrina/page-ops";
import { listOperations, loadOperation, startOperation, undoOperation } from "@/server/actions/vetrina-operations";
import type { VetrinaResult } from "@/server/vetrina/service";
import { ActivitySheet } from "./ActivitySheet";
import { SELECTION_BAR_EXTRA, useSelectionBarShown } from "./bottom-bar";
import { call } from "./call";
import { refreshActData } from "./data";
import { isActive, outcomeOf, pollDelay, refusedText, type Outcome } from "./model";
import { OperationsContext, type Operations, type SettledListener } from "./operations-context";

/**
 * The catalog's actions, followed in the background wherever the owner
 * goes in the Vetrina: mounted once in the app shell. While one runs, a pill
 * above the tab bar shows its progress ("Metto in saldo · 34/120"); when it
 * ends, a toast says how it went, with "Annulla"; and the screens hear of it
 * (useOperationSettled) to read their rows again. After a reload it picks up
 * the actions still running.
 */
export function OperationsProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const a = t.vetrinaCatalog.act;
  const network = a.sheet.network;
  const [active, setActive] = React.useState<OperationView[]>([]);
  const [activityOpen, setActivityOpen] = React.useState(false);
  const listeners = React.useRef(new Set<SettledListener>());
  // The poll reads the list as it is now, not as it was when the loop started.
  const activeRef = React.useRef(active);
  React.useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const follow = React.useCallback((view: OperationView) => {
    setActive((list) => [view, ...list.filter((v) => v.id !== view.id)]);
  }, []);

  const subscribe = React.useCallback((listener: SettledListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  // The toast's "Annulla" outlives the render that made it.
  const undoRef = React.useRef<(id: string) => Promise<VetrinaResult<OperationView>>>(async () => ({
    ok: false,
    code: "failed",
    error: "",
  }));

  /** Say how it went, and tell the screens. */
  const settle = React.useCallback(
    (view: OperationView, outcome: Outcome) => {
      const toasts = a.toast;
      const undo =
        view.undoable && view.changed > 0 ? { label: toasts.undo, onClick: () => void undoRef.current(view.id) } : undefined;
      switch (outcome) {
        case "done":
          toast.success(view.label, {
            id: view.id,
            description:
              view.failed > 0
                ? refusedText(view.kind, view.failed, { products: toasts.refused, sizes: toasts.refusedSizes })
                : undefined,
            action: undo,
            duration: 10_000,
          });
          break;
        case "failed":
          toast.error(view.label, { id: view.id, description: view.error ?? toasts.failed, action: undo, duration: 12_000 });
          break;
        case "undone": {
          const u = view.undo;
          const said = u
            ? [
                u.restored > 0 ? toasts.restored(u.restored) : "",
                u.kept > 0 ? toasts.kept(u.kept) : "",
                (u.held ?? 0) > 0 ? toasts.held(u.held ?? 0, u.heldBy ?? []) : "",
                u.failed > 0
                  ? refusedText(view.kind, u.failed, { products: toasts.undoRefused, sizes: toasts.undoRefusedSizes })
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")
            : "";
          toast.success(toasts.undone(view.label), { id: view.id, description: said || undefined, duration: 8_000 });
          break;
        }
        case "undoFailed":
          toast.error(view.error ?? toasts.undoFailed, { id: view.id, description: view.label, duration: 10_000 });
          break;
      }
      // What the sheets pick from may have moved (a new tag, the sections' pins).
      refreshActData();
      for (const listener of listeners.current) listener(view, outcome);
    },
    [a],
  );

  const start = React.useCallback(
    async (input: OperationInput) => {
      const res = await call(() => startOperation(input), network);
      if (res.ok) {
        if (isActive(res.data)) follow(res.data);
        else settle(res.data, outcomeOf("running", res.data) ?? "done");
      }
      return res;
    },
    [network, follow, settle],
  );

  const undo = React.useCallback(
    async (id: string) => {
      const res = await call(() => undoOperation({ id }), network);
      if (res.ok) {
        // The "done" toast with its "Annulla" has been answered.
        toast.dismiss(id);
        if (isActive(res.data)) follow(res.data);
        else settle(res.data, outcomeOf("undoing", res.data) ?? "undone");
      } else {
        toast.error(res.error, { id });
      }
      return res;
    },
    [network, follow, settle],
  );
  React.useEffect(() => {
    undoRef.current = undo;
  }, [undo]);

  // After a reload, the actions still going are followed again.
  React.useEffect(() => {
    let alive = true;
    void call(() => listOperations({ limit: 10 }), network).then((res) => {
      if (!alive || !res.ok) return;
      const going = res.data.filter(isActive);
      if (going.length === 0) return;
      setActive((list) => [...list, ...going.filter((g) => !list.some((v) => v.id === g.id))]);
    });
    return () => {
      alive = false;
    };
  }, [network]);

  // While anything is followed: ask how each one is doing, until it ends.
  const following = active.length > 0;
  React.useEffect(() => {
    if (!following) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let round = 0;
    let failures = 0;

    const tick = async () => {
      // A phone in a pocket does not poll; the next look picks up where it was.
      if (document.visibilityState === "hidden") {
        timer = setTimeout(tick, 2_000);
        return;
      }
      const asked = activeRef.current;
      const answers = await Promise.all(asked.map((v) => call(() => loadOperation({ id: v.id }), network)));
      if (stopped) return;
      // id → the action as it is now, or null when it ended (or is gone from the log).
      const updates = new Map<string, OperationView | null>();
      const ended: [OperationView, Outcome][] = [];
      let unreachable = false;
      asked.forEach((before, i) => {
        const res = answers[i];
        if (!res.ok) {
          if (res.code === "not_found") updates.set(before.id, null);
          else unreachable = true;
          return;
        }
        const outcome = outcomeOf(before.status, res.data);
        if (outcome) {
          updates.set(before.id, null);
          ended.push([res.data, outcome]);
        } else {
          updates.set(before.id, res.data);
        }
      });
      failures = unreachable ? failures + 1 : 0;
      round += 1;
      // Started meanwhile: kept as they are, asked about next time.
      setActive((list) =>
        list.flatMap((v) => {
          if (!updates.has(v.id)) return [v];
          const now = updates.get(v.id);
          return now ? [now] : [];
        }),
      );
      for (const [view, outcome] of ended) settle(view, outcome);
      timer = setTimeout(tick, pollDelay(round, failures));
    };

    timer = setTimeout(tick, pollDelay(0, 0));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [following, network, settle]);

  const openActivity = React.useCallback(() => setActivityOpen(true), []);
  const value = React.useMemo<Operations>(
    () => ({ start, undo, openActivity, active, subscribe }),
    [start, undo, openActivity, active, subscribe],
  );

  // While the pill shows, the pages keep their last row clear of it: TabbarSpacer reads --vetrina-tabbar,
  // here the bar's room (--vetrina-tabbar-bar, the shell's) plus the pill's.
  const room = following
    ? ({ "--vetrina-tabbar": `calc(var(--vetrina-tabbar-bar, 0px) + ${PILL_ROOM})` } as React.CSSProperties)
    : undefined;

  return (
    <OperationsContext.Provider value={value}>
      <div className="contents" style={room}>
        {children}
      </div>
      <ProgressPill active={active} onOpen={openActivity} />
      <ActivitySheet open={activityOpen} onClose={() => setActivityOpen(false)} />
    </OperationsContext.Provider>
  );
}

/** The pill's height (44px) and the gap under it: the room a page keeps below its last row while it shows. */
const PILL_ROOM = "54px";

/**
 * Above the tab bar (or the selection bar) while an action runs: what it is
 * and how far it got, filling as it goes. A tap opens the log. Not a live
 * region: a screen reader reads it when it reaches it, and hears how the
 * action ended from the toast — not every step of the count.
 */
function ProgressPill({ active, onOpen }: { active: readonly OperationView[]; onOpen: () => void }) {
  const { t } = useI18n();
  const p = t.vetrinaCatalog.act.pill;
  const selecting = useSelectionBarShown();
  const view = active[0];
  // At least clear of the home indicator and a bottom bar, where no tab bar is shown (the section editor).
  const above = `max(var(--vetrina-tabbar-bar, 0px), calc(env(safe-area-inset-bottom) + 84px))`;
  const bottom = selecting ? `calc(${above} + ${SELECTION_BAR_EXTRA} + 10px)` : `calc(${above} + 10px)`;

  let text = "";
  let share = 0;
  if (view?.status === "undoing") {
    // An undo starts from the action's own numbers until it writes its own: words only.
    text = view.queued ? p.queued(p.undoing) : p.undoing;
  } else if (view) {
    // A homepage action is written at once, never followed here: its label, should one ever be.
    const what = isPageActionKind(view.kind) ? view.label : p.kinds[view.kind];
    const { done, total } = view.progress;
    text = view.queued ? p.queued(what) : p.progress(what, done, total);
    share = total > 0 ? Math.min(1, done / total) : 0;
  }

  return (
    <AnimatePresence>
      {view && (
        <motion.div
          key="ops-pill"
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.96 }}
          transition={{ type: "spring", damping: 28, stiffness: 360 }}
          className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4"
          style={{ bottom }}
        >
          <button
            type="button"
            onClick={onOpen}
            aria-label={`${text}. ${p.label}`}
            className="pointer-events-auto relative flex h-11 max-w-full items-center gap-2.5 overflow-hidden rounded-full bg-white/85 pe-4 ps-3.5 text-[14px] font-medium shadow-[0_4px_24px_rgba(0,0,0,0.14)] backdrop-blur-xl transition-transform active:scale-95 dark:bg-[#2c2c2e]/85"
          >
            {/* How far it got, as a fill behind the words. */}
            <span
              aria-hidden
              className="absolute inset-y-0 start-0 bg-black/[0.06] transition-[width] duration-500 ease-out dark:bg-white/10"
              style={{ width: `${Math.round(share * 100)}%` }}
            />
            <Preloader className="relative !h-4 !w-4 shrink-0" />
            {/* Read when focused, not announced at every step: the toast says how it ended. */}
            <span className="relative min-w-0 truncate tabular-nums">{text}</span>
            {active.length > 1 && (
              <span className="relative shrink-0 rounded-full bg-black/[0.08] px-1.5 text-[12px] font-semibold dark:bg-white/15">
                {p.more(active.length - 1)}
              </span>
            )}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
