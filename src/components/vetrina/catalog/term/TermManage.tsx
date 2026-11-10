"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import type { CatalogTaxonomy, CatalogTerm } from "@/lib/vetrina/catalog";
import type { OperationInput } from "@/lib/vetrina/catalog-ops";
import type { TermActionInput } from "@/lib/vetrina/term-ops";
import { previewTermAction, runTermAction } from "@/server/actions/vetrina-terms";
import { undoOperation } from "@/server/actions/vetrina-operations";
import { call } from "../act/call";
import { refreshActData, useCatalogOverview } from "../act/data";
import { matches } from "../act/model";
import {
  ActSheetFrame,
  CARD,
  FailedCard,
  LoadingRows,
  PickList,
  PickRow,
  PreviewView,
  PrimaryButton,
  SheetBody,
  SheetFooter,
  SheetHead,
  SheetSearch,
  useLastShown,
  usePreview,
  useStartAction,
} from "../act/parts";
import { TextField } from "../../menus/parts";
import { CATALOG_HOME, termHref } from "./list-model";

/**
 * A category's or a brand's own actions, from its screen's "⋯": its name,
 * a sub-term, its place in the tree — done at once, with "Annulla" in the
 * toast — and merging it into another or deleting it, which move its
 * products one by one in the background (followed like any catalog action,
 * "Annulla" in Attività). Each says first what it will do, in the server's
 * own sentences (operations/terms.ts, term-removal.ts).
 */

export type TermManageMode = "rename" | "child" | "move" | "merge" | "delete";

type Term = Pick<CatalogTerm, "taxonomy" | "id" | "name" | "parent">;

interface Request {
  mode: TermManageMode;
  term: Term;
}

/** The sheets, and how to open one. */
export function useTermManage(term: Term): { open: (mode: TermManageMode) => void; sheets: React.ReactNode } {
  const [request, setRequest] = React.useState<Request | null>(null);
  const shown = useLastShown(request);
  const close = () => setRequest(null);
  return {
    open: (mode) => setRequest({ mode, term }),
    sheets: (
      <ActSheetFrame open={request != null} onClose={close} detent={shown?.mode === "move" || shown?.mode === "merge" ? undefined : "content"}>
        {shown && <ManageContent key={`${shown.mode}:${shown.term.id}`} request={shown} onClose={close} />}
      </ActSheetFrame>
    ),
  };
}

function ManageContent({ request, onClose }: { request: Request; onClose: () => void }) {
  switch (request.mode) {
    case "rename":
    case "child":
      return <NameContent request={request} onClose={onClose} />;
    case "move":
    case "merge":
      return <PickContent request={request} onClose={onClose} />;
    case "delete":
      return <RemovalContent input={{ kind: "termDelete", taxonomy: request.term.taxonomy, termId: request.term.id }} term={request.term} into={null} onClose={onClose} />;
  }
}

/* ---------------------------------------------------------------- *
 * Done at once, with "Annulla" in the toast
 * ---------------------------------------------------------------- */

function useTermWrite() {
  const { t } = useI18n();
  const network = t.vetrinaCatalog.act.sheet.network;
  const w = t.vetrinaCatalog.terms;
  const router = useRouter();
  return React.useCallback(
    async (input: TermActionInput, done: string): Promise<{ id: number; name: string; parent: number } | null | false> => {
      const res = await call(() => runTermAction(input), network);
      if (!res.ok) {
        toast.error(res.error || t.vetrina.errors[res.code] || t.vetrina.errors.failed);
        return false;
      }
      refreshActData();
      const operation = res.data.operation;
      toast.dismiss();
      toast.success(done, {
        duration: 10_000,
        ...(operation?.undoable
          ? {
              action: {
                label: w.undo,
                onClick: () => {
                  void call(() => undoOperation({ id: operation.id }), network).then((undone) => {
                    if (!undone.ok) {
                      toast.error(undone.error);
                      return;
                    }
                    refreshActData();
                    router.refresh();
                    toast.success(w.done.undone);
                  });
                },
              },
            }
          : {}),
      });
      return res.data.term;
    },
    [network, t, w, router],
  );
}

/** "Rinomina" and "Nuova sottocategoria": one name. */
function NameContent({ request, onClose }: { request: Request; onClose: () => void }) {
  const { t } = useI18n();
  const w = t.vetrinaCatalog.terms;
  const router = useRouter();
  const write = useTermWrite();
  const { term, mode } = request;
  const tx = term.taxonomy;
  const [name, setName] = React.useState(mode === "rename" ? term.name : "");
  const [busy, setBusy] = React.useState(false);
  const [tried, setTried] = React.useState(false);

  async function save() {
    const value = name.trim();
    if (!value) {
      setTried(true);
      return;
    }
    setBusy(true);
    const made =
      mode === "rename"
        ? await write({ kind: "termRename", taxonomy: tx, termId: term.id, name: value }, w.done.renamed(value))
        : await write({ kind: "termCreate", taxonomy: tx, name: value, parent: term.id }, w.done.created[tx](value));
    setBusy(false);
    if (made === false) return;
    onClose();
    // A new sub-term opens at once; a renamed term's screen reads its new name.
    if (mode === "child" && made) router.push(termHref(tx, made.id));
  }

  return (
    <>
      <SheetHead title={mode === "rename" ? w.name.rename(term.name) : w.name.create[tx](term.name)} onClose={onClose} />
      <SheetBody>
        <TextField
          label={w.name.label}
          value={name}
          onChange={setName}
          hint={mode === "rename" ? w.name.renameHint : undefined}
          problem={tried && name.trim() === "" ? w.name.needName : null}
          autoFocus
        />
      </SheetBody>
      <SheetFooter>
        <PrimaryButton onClick={() => void save()} busy={busy} disabled={mode === "rename" && name.trim() === term.name}>
          {mode === "rename" ? w.name.save : w.name.make}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}

/* ---------------------------------------------------------------- *
 * Where: under another, or into another
 * ---------------------------------------------------------------- */

const collator = new Intl.Collator("it", { sensitivity: "base", numeric: true });

/** A term and every term below it, by the overview's parents. */
function below(terms: readonly CatalogTerm[], id: number): Set<number> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of terms) {
      if (!out.has(t.id) && out.has(t.parent)) {
        out.add(t.id);
        grew = true;
      }
    }
  }
  return out;
}

function PickContent({ request, onClose }: { request: Request; onClose: () => void }) {
  const { t } = useI18n();
  const w = t.vetrinaCatalog.terms;
  const { term, mode } = request;
  const tx = term.taxonomy;
  const overview = useCatalogOverview();
  const [text, setText] = React.useState("");
  const [picked, setPicked] = React.useState<{ id: number; name: string } | null>(null);

  const found = React.useMemo(() => {
    const terms = overview.data ? (tx === "category" ? overview.data.categories : overview.data.brands) : [];
    // Not itself, nor under itself: a term cannot go there, nor merge there.
    const out = below(terms, term.id);
    return terms
      .filter((x) => !out.has(x.id) && (mode !== "move" || x.id !== term.parent) && matches(x.path, text))
      .sort((a, b) => collator.compare(a.path, b.path));
  }, [overview.data, tx, term.id, term.parent, mode, text]);

  if (picked) {
    return mode === "merge" ? (
      <RemovalContent
        input={{ kind: "termMerge", taxonomy: tx, termId: term.id, into: picked.id }}
        term={term}
        into={picked}
        onClose={onClose}
        onBack={() => setPicked(null)}
      />
    ) : (
      <MoveConfirm term={term} parent={picked} onClose={onClose} onBack={() => setPicked(null)} />
    );
  }

  return (
    <>
      <SheetHead title={mode === "move" ? w.pick.move(term.name) : w.pick.merge(term.name)} onClose={onClose} />
      <SheetBody>
        <SheetSearch value={text} onChange={setText} placeholder={w.pick.search[tx]} />
        {overview.error != null && !overview.data ? (
          <FailedCard message={w.pick.failed} onRetry={() => void overview.mutate()} />
        ) : !overview.data ? (
          <LoadingRows label={w.pick.loading} />
        ) : (
          <PickList label={mode === "move" ? w.menu.move : w.menu.merge}>
            {mode === "move" && term.parent !== 0 && !text && <PickRow title={w.pick.top} onPick={() => setPicked({ id: 0, name: "" })} />}
            {found.length === 0 && (mode !== "move" || term.parent === 0 || text) ? (
              <p className="px-4 py-6 text-center text-[15px] opacity-60">{w.pick.empty}</p>
            ) : (
              found.slice(0, 150).map((x) => <PickRow key={x.id} title={x.name} subtitle={x.path !== x.name ? x.path : undefined} onPick={() => setPicked({ id: x.id, name: x.name })} />)
            )}
          </PickList>
        )}
      </SheetBody>
    </>
  );
}

/** The server's sentences for what it will do. */
function Lines({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className={`${CARD} space-y-1.5 px-4 py-3 text-[15px] leading-snug`}>
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function MoveConfirm({ term, parent, onClose, onBack }: { term: Term; parent: { id: number; name: string }; onClose: () => void; onBack: () => void }) {
  const { t } = useI18n();
  const w = t.vetrinaCatalog.terms;
  const network = t.vetrinaCatalog.act.sheet.network;
  const write = useTermWrite();
  const input: TermActionInput = { kind: "termMove", taxonomy: term.taxonomy as "category" | "brand", termId: term.id, parent: parent.id };
  const [said, setSaid] = React.useState<{ lines: string[]; warnings: string[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const key = JSON.stringify(input);

  React.useEffect(() => {
    let alive = true;
    void call(() => previewTermAction(JSON.parse(key) as TermActionInput), network).then((res) => {
      if (!alive) return;
      if (res.ok) setSaid(res.data);
      else setError(res.error || t.vetrina.errors.failed);
    });
    return () => {
      alive = false;
    };
  }, [key, network, t]);

  async function move() {
    setBusy(true);
    const done = await write(input, w.done.moved[term.taxonomy as "category" | "brand"](term.name));
    setBusy(false);
    if (done !== false) onClose();
  }

  return (
    <>
      <SheetHead title={w.confirm.move(term.name, parent.id ? parent.name : null)} onClose={onClose} />
      <SheetBody>
        {error ? (
          <p role="alert" className="rounded-2xl bg-amber-50 px-3.5 py-3 text-[14px] leading-snug text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            {error}
          </p>
        ) : !said ? (
          <LoadingRows label={w.pick.loading} />
        ) : (
          <>
            <Lines lines={said.lines} />
            {said.warnings.map((x) => (
              <p key={x} className="rounded-2xl bg-amber-50 px-3.5 py-3 text-[14px] leading-snug text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                {x}
              </p>
            ))}
          </>
        )}
        <button type="button" onClick={onBack} className="w-full py-2 text-center text-[15px] text-primary">
          {w.confirm.other}
        </button>
      </SheetBody>
      <SheetFooter>
        <PrimaryButton onClick={() => void move()} busy={busy} disabled={!said || error != null}>
          {w.confirm.moveButton}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}

/* ---------------------------------------------------------------- *
 * Merged or deleted: in the background
 * ---------------------------------------------------------------- */

function RemovalContent({
  input,
  term,
  into,
  onClose,
  onBack,
}: {
  input: Extract<OperationInput, { kind: "termMerge" | "termDelete" }>;
  term: Term;
  into: { id: number; name: string } | null;
  onClose: () => void;
  onBack?: () => void;
}) {
  const { t } = useI18n();
  const w = t.vetrinaCatalog.terms;
  const router = useRouter();
  const preview = usePreview(input);
  // Once started, its screen is going: the products and the name are the term merged into's, or its parent's.
  const { run, busy, error } = useStartAction(onClose, () => {
    const tx: CatalogTaxonomy = term.taxonomy;
    router.push(into ? termHref(tx, into.id) : term.parent ? termHref(tx, term.parent) : CATALOG_HOME);
  });
  const count = preview.current && preview.preview ? preview.preview.changes : null;

  return (
    <>
      <SheetHead title={into ? w.confirm.merge(term.name, into.name) : w.confirm.delete(term.name)} subtitle={w.confirm.background} onClose={onClose} />
      <SheetBody>
        {preview.preview?.page && <Lines lines={preview.preview.page.lines} />}
        <PreviewView state={preview} headline={false} />
        {onBack && (
          <button type="button" onClick={onBack} className="w-full py-2 text-center text-[15px] text-primary">
            {w.confirm.other}
          </button>
        )}
      </SheetBody>
      <SheetFooter error={error}>
        <PrimaryButton busy={busy} danger={!into} disabled={!preview.current || preview.refused} onClick={() => void run(input)}>
          {into ? w.confirm.mergeButton(count) : w.confirm.deleteButton(count)}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}
