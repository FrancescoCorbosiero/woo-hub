"use client";

import * as React from "react";
import { Button, Preloader } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { OperationView } from "@/lib/vetrina/catalog-ops";
import { listOperations } from "@/server/actions/vetrina-operations";
import { call } from "./call";
import { Done, Failed, UndoArrow } from "./icons";
import { formatTime, isActive, refusedText } from "./model";
import { useOperations, useOperationSettled } from "./operations-context";
import { ActSheetFrame, CARD, FailedCard, LoadingRows, SheetBody, SheetHead } from "./parts";

/**
 * The log of the catalog's actions, newest first: what each did, how it
 * went, when — and "Annulla" where it still can be undone. Opened from the
 * progress pill, or from a screen (useOperations().openActivity).
 */

const LIMIT = 30;

export function ActivitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ActSheetFrame open={open} onClose={onClose} detent="content">
      <ActivityContent onClose={onClose} />
    </ActSheetFrame>
  );
}

function ActivityContent({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const a = t.vetrinaCatalog.act.activity;
  const network = t.vetrinaCatalog.act.sheet.network;
  const ops = useOperations();
  const [views, setViews] = React.useState<OperationView[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [asked, setAsked] = React.useState<ReadonlySet<string>>(() => new Set());
  const alive = React.useRef(true);

  const load = React.useCallback(
    () =>
      call(() => listOperations({ limit: LIMIT }), network).then((res) => {
        if (!alive.current) return;
        if (res.ok) {
          setViews(res.data);
          setFailed(false);
        } else {
          // A refresh that fails keeps the log already shown; only a first read says so.
          setFailed(true);
        }
      }),
    [network],
  );

  React.useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);
  // An action that ends changes its row: read the log again.
  useOperationSettled(() => void load());

  // The tracker's views are fresher (their progress); one it follows but the log has not shown yet goes on top.
  const live = new Map(ops.active.map((v) => [v.id, v]));
  const shown = views
    ? [...ops.active.filter((v) => !views.some((w) => w.id === v.id)), ...views.map((v) => live.get(v.id) ?? v)]
    : null;

  async function undo(id: string) {
    setAsked((s) => new Set(s).add(id));
    await ops.undo(id);
    if (!alive.current) return;
    setAsked((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    void load();
  }

  return (
    <>
      <SheetHead title={a.title} onClose={onClose} />
      <SheetBody footer={false}>
        <p className="px-1 text-[14px] leading-snug opacity-60">{a.intro}</p>
        {failed && !shown ? (
          <FailedCard
            message={a.failed}
            onRetry={() => {
              setFailed(false);
              void load();
            }}
          />
        ) : !shown ? (
          <LoadingRows label={a.loading} />
        ) : shown.length === 0 ? (
          <p className="px-1 py-8 text-center text-[15px] opacity-60">{a.empty}</p>
        ) : (
          <ul className={`${CARD} divide-y divide-black/5 dark:divide-white/10`}>
            {shown.map((view) => (
              <ActivityRow key={view.id} view={view} busy={asked.has(view.id)} onUndo={() => void undo(view.id)} />
            ))}
          </ul>
        )}
      </SheetBody>
    </>
  );
}

function ActivityRow({ view, busy, onUndo }: { view: OperationView; busy: boolean; onUndo: () => void }) {
  const { t, locale } = useI18n();
  const a = t.vetrinaCatalog.act.activity;
  const words = t.vetrinaCatalog.act.toast;
  const going = isActive(view);
  const when = formatTime(view.undoneAt ?? view.finishedAt ?? view.createdAt, locale);

  const status =
    view.status === "running"
      ? view.queued
        ? a.status.queued
        : a.status.running(view.progress.done, view.progress.total)
      : view.status === "undoing"
        ? a.status.undoing
        : a.status[view.status];
  const parts = [status];
  if (!going && when) parts.push(when);
  if (view.status === "done" && view.failed > 0) {
    parts.push(refusedText(view.kind, view.failed, { products: a.refused, sizes: a.refusedSizes }));
  }

  const undo = view.undo;
  const undoLine =
    view.status === "undone" && undo
      ? [
          undo.restored > 0 ? words.restored(undo.restored) : "",
          undo.kept > 0 ? words.kept(undo.kept) : "",
          (undo.held ?? 0) > 0 ? words.held(undo.held ?? 0) : "",
          undo.failed > 0
            ? refusedText(view.kind, undo.failed, { products: words.undoRefused, sizes: words.undoRefusedSizes })
            : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
  const canUndo = view.undoable && view.changed > 0 && !going;

  return (
    <li className="flex items-center gap-3 py-3 ps-4 pe-2">
      <StatusIcon view={view} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[15px] font-medium leading-snug">{view.label}</p>
        <p className="mt-0.5 text-[13px] leading-snug opacity-60">{parts.join(" · ")}</p>
        {view.error && (view.status === "failed" || view.status === "done") && (
          <p className="mt-0.5 line-clamp-3 text-[13px] leading-snug text-red-600 dark:text-red-400">{view.error}</p>
        )}
        {undoLine && <p className="mt-0.5 text-[13px] leading-snug opacity-60">{undoLine}</p>}
      </div>
      {canUndo && (
        <Button rounded tonal inline disabled={busy} onClick={onUndo} className="!h-11 shrink-0 !px-4">
          {a.undo}
        </Button>
      )}
    </li>
  );
}

function StatusIcon({ view }: { view: OperationView }) {
  const box = "grid h-8 w-8 shrink-0 place-items-center";
  if (isActive(view)) {
    return (
      <span className={box}>
        <Preloader className="!h-5 !w-5" />
      </span>
    );
  }
  if (view.status === "undone") {
    return (
      <span className={box}>
        <UndoArrow className="h-6 w-6 opacity-40" />
      </span>
    );
  }
  if (view.status === "failed") {
    return (
      <span className={`${box} text-red-600 dark:text-red-400`}>
        <Failed className="h-6 w-6" />
      </span>
    );
  }
  return (
    <span className={`${box} text-green-600 dark:text-green-500`}>
      <Done className="h-6 w-6" />
    </span>
  );
}
