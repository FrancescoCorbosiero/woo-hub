"use client";

import * as React from "react";
import { Button, Preloader } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import type { OrderSourceCheck, OrderSourceSummary, UnmatchedItem } from "@/lib/vetrina/order-sources";
import { checkOrderSource, deleteOrderSource, saveOrderSource } from "@/server/actions/vetrina-order-sources";
import { ChevronLeft } from "../../icons";
import { call } from "../act/call";
import { Warning } from "../act/icons";
import { formatTime } from "../act/model";
import {
  ActSheetFrame,
  CARD,
  FailedCard,
  HEADING,
  LoadingRows,
  PickList,
  PickRow,
  PrimaryButton,
  SheetBody,
  SheetFooter,
  SheetHead,
} from "../act/parts";
import { formatCount } from "../format";
import { sourcesChanged, useOrderSources } from "./use-order-sources";

/**
 * "Fonti d'ordine": the order sources, managed. The list (each with how many
 * of its products the shop has), one source (where it comes from, the
 * products the shop does not have, "Usa su tutto il catalogo", edit,
 * delete), and the form: a name, an origin, and the ranking — pasted (an
 * LLM's answer, a CSV, one product per line) or uploaded as a file — read
 * and matched to the shop as it is typed, before it is saved. "Copia le
 * istruzioni per l'LLM" gives the prompt that makes an LLM write the agreed
 * format from a web page (docs/order-sources.md).
 */

type View = { kind: "list" } | { kind: "source"; id: string } | { kind: "form"; id: string | null };

/** What "Usa su tutto il catalogo" hands the screen: the source to apply. */
export interface SourceRef {
  id: string;
  name: string;
}

const INPUT =
  "w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-[16px] outline-none placeholder:opacity-40 focus:border-black/30 dark:border-white/15 dark:bg-white/10 dark:focus:border-white/40";

export function OrderSourcesSheet({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  /** "Usa su tutto il catalogo": the screen opens the apply sheet (this one has closed). */
  onApply: (source: SourceRef) => void;
}) {
  return (
    <ActSheetFrame open={open} onClose={onClose}>
      {open && <SourcesContent onClose={onClose} onApply={onApply} />}
    </ActSheetFrame>
  );
}

function SourcesContent({ onClose, onApply }: { onClose: () => void; onApply: (source: SourceRef) => void }) {
  const [view, setView] = React.useState<View>({ kind: "list" });
  const sources = useOrderSources(true);
  // The source just saved, shown at once: the list it is in is read again meanwhile.
  const [saved, setSaved] = React.useState<OrderSourceSummary | null>(null);
  const find = (id: string) => sources.data?.find((s) => s.id === id) ?? (saved?.id === id ? saved : undefined);
  const opened = view.kind === "source" ? find(view.id) : undefined;
  const editing = view.kind === "form" && view.id ? find(view.id) : undefined;

  if (view.kind === "form") {
    return (
      <SourceForm
        source={editing ?? null}
        onBack={() => setView(view.id ? { kind: "source", id: view.id } : { kind: "list" })}
        onClose={onClose}
        onSaved={(summary) => {
          setSaved(summary);
          setView({ kind: "source", id: summary.id });
        }}
      />
    );
  }
  if (view.kind === "source" && opened) {
    return (
      <SourceView
        source={opened}
        onBack={() => setView({ kind: "list" })}
        onClose={onClose}
        onEdit={() => setView({ kind: "form", id: opened.id })}
        onDeleted={() => setView({ kind: "list" })}
        onApply={() => {
          onClose();
          onApply({ id: opened.id, name: opened.name });
        }}
      />
    );
  }
  return (
    <SourceList
      sources={sources.data}
      error={sources.error ? String((sources.error as Error).message ?? sources.error) : null}
      onRetry={() => void sources.mutate()}
      onClose={onClose}
      onOpen={(id) => setView({ kind: "source", id })}
      onAdd={() => setView({ kind: "form", id: null })}
    />
  );
}

/** A back link above a view's title: to the list, or to the source. */
function Back({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="-ms-1 mb-1 flex h-11 items-center gap-0.5 px-1 text-[16px] text-primary active:opacity-50">
      <ChevronLeft className="h-5 w-5" />
      {label}
    </button>
  );
}

function SourceList({
  sources,
  error,
  onRetry,
  onClose,
  onOpen,
  onAdd,
}: {
  sources: OrderSourceSummary[] | undefined;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const { t, locale } = useI18n();
  const s = t.vetrinaCatalog.sources;
  return (
    <>
      <SheetHead title={s.title} onClose={onClose} />
      <SheetBody>
        <p className={`${CARD} px-4 py-3 text-[15px] leading-snug`}>{s.intro}</p>
        {error && !sources ? (
          <FailedCard message={error} onRetry={onRetry} />
        ) : !sources ? (
          <LoadingRows label={s.loading} />
        ) : sources.length === 0 ? (
          <p className={`${CARD} px-4 py-3 text-center text-[15px] opacity-60`}>{s.empty}</p>
        ) : (
          <PickList label={s.title}>
            {sources.map((source) => (
              <PickRow
                key={source.id}
                title={source.name}
                subtitle={`${s.matched(source.matched, source.items)} · ${s.updated(formatTime(source.updatedAt, locale))}`}
                onPick={() => onOpen(source.id)}
              />
            ))}
          </PickList>
        )}
      </SheetBody>
      <SheetFooter>
        <PrimaryButton onClick={onAdd}>{s.add}</PrimaryButton>
      </SheetFooter>
    </>
  );
}

/** The products of a source the shop does not have: the first of them, with their place in it. */
function UnmatchedCard({ unmatched, total }: { unmatched: readonly UnmatchedItem[]; total: number }) {
  const { t, locale } = useI18n();
  const s = t.vetrinaCatalog.sources;
  if (total === 0) return <p className={`${CARD} px-4 py-3 text-[15px] leading-snug`}>{s.allMatched}</p>;
  return (
    <div>
      <span className={HEADING}>
        {s.unmatched} · {formatCount(total, locale)}
      </span>
      <ul className={`${CARD} divide-y divide-black/5 dark:divide-white/10`}>
        {unmatched.map((u) => (
          <li key={u.position} className="flex gap-3 px-4 py-2.5 text-[14px] leading-snug">
            <span className="w-9 shrink-0 text-end tabular-nums opacity-45">#{u.position}</span>
            <span className="min-w-0 flex-1">
              <span className="block break-words">{u.name ?? u.sku}</span>
              {(u.sku && u.name) || u.ambiguous ? (
                <span className="mt-0.5 block text-[12px] opacity-55">
                  {[u.sku && u.name ? u.sku : null, u.ambiguous ? s.ambiguous : null].filter(Boolean).join(" · ")}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 px-1 text-[13px] leading-snug opacity-60">
        {total > unmatched.length ? `${s.unmatchedMore(total - unmatched.length)}. ` : ""}
        {s.unmatchedHint}
      </p>
    </div>
  );
}

const isUrl = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());

function SourceView({
  source,
  onBack,
  onClose,
  onEdit,
  onDeleted,
  onApply,
}: {
  source: OrderSourceSummary;
  onBack: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onApply: () => void;
}) {
  const { t } = useI18n();
  const s = t.vetrinaCatalog.sources;
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function remove() {
    setBusy(true);
    const res = await call(() => deleteOrderSource({ id: source.id }), t.vetrinaCatalog.act.sheet.network);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(s.removed(source.name));
    sourcesChanged();
    onDeleted();
  }

  return (
    <>
      <SheetHead title={source.name} subtitle={s.matched(source.matched, source.items)} onClose={onClose} />
      <SheetBody>
        <Back label={s.title} onBack={onBack} />
        {source.origin && (
          <div>
            <span className={HEADING}>{s.origin}</span>
            <p className={`${CARD} break-words px-4 py-3 text-[15px] leading-snug`}>
              {isUrl(source.origin) ? (
                <a href={source.origin} target="_blank" rel="noreferrer" className="text-primary">
                  {source.origin}
                </a>
              ) : (
                source.origin
              )}
            </p>
          </div>
        )}
        <UnmatchedCard unmatched={source.unmatched} total={source.unmatchedCount} />
        <p className="px-1 text-[13px] leading-snug opacity-60">{s.applyAllHint}</p>
        {confirming ? (
          <div className={`${CARD} space-y-3 p-4`}>
            <p className="text-[15px] leading-snug">{s.removeConfirm(source.name)}</p>
            <div className="flex gap-2">
              <Button rounded tonal disabled={busy} onClick={() => setConfirming(false)} className="!h-11 flex-1">
                {s.removeNo}
              </Button>
              <Button
                rounded
                disabled={busy}
                onClick={() => void remove()}
                colors={{ fillBgIos: "bg-red-600", fillBgMaterial: "bg-red-600", fillTextIos: "text-white", fillTextMaterial: "text-white" }}
                className="!h-11 flex-1"
              >
                {busy ? <Preloader className="!h-5 !w-5" /> : s.removeYes}
              </Button>
            </div>
          </div>
        ) : (
          <div className={`${CARD} divide-y divide-black/5 dark:divide-white/10`}>
            <button type="button" onClick={onEdit} className="block h-12 w-full px-4 text-start text-[16px] text-primary active:bg-black/5">
              {s.edit}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="block h-12 w-full px-4 text-start text-[16px] text-red-600 active:bg-black/5 dark:text-red-500"
            >
              {s.remove}
            </button>
          </div>
        )}
      </SheetBody>
      <SheetFooter>
        <PrimaryButton disabled={source.matched === 0} onClick={onApply}>
          {s.applyAll}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}

/** How long typing in the ranking must pause before it is read. */
const CHECK_PAUSE_MS = 500;

type CheckState = { text: string; result: OrderSourceCheck | null; error: string | null } | null;

function SourceForm({
  source,
  onBack,
  onClose,
  onSaved,
}: {
  /** The source changed; null for a new one. */
  source: OrderSourceSummary | null;
  onBack: () => void;
  onClose: () => void;
  onSaved: (saved: OrderSourceSummary) => void;
}) {
  const { t } = useI18n();
  const s = t.vetrinaCatalog.sources;
  const network = t.vetrinaCatalog.act.sheet.network;
  const [name, setName] = React.useState(source?.name ?? "");
  const [origin, setOrigin] = React.useState(source?.origin ?? "");
  const [text, setText] = React.useState("");
  const [check, setCheck] = React.useState<CheckState>(null);
  const [showPrompt, setShowPrompt] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const file = React.useRef<HTMLInputElement>(null);
  // The name and the origin the ranking states fill the fields the owner left empty, once.
  const named = React.useRef(name.trim() !== "");

  React.useEffect(() => {
    const body = text.trim();
    if (!body) {
      setCheck(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void call(() => checkOrderSource({ text: body }), network).then((res) => {
        if (!alive) return;
        setCheck(res.ok ? { text: body, result: res.data, error: null } : { text: body, result: null, error: res.error });
        if (res.ok && !named.current && res.data.name) {
          named.current = true;
          setName(res.data.name);
          if (res.data.origin) setOrigin((o) => o || res.data.origin!);
        }
      });
    }, CHECK_PAUSE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [text, network]);

  const body = text.trim();
  const checked = check != null && check.text === body;
  const checking = body !== "" && !checked;
  const readable = checked && check.result != null;
  const canSave = name.trim() !== "" && !busy && (body === "" ? source != null : readable);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(s.llmPrompt);
      toast.success(s.promptCopied);
    } catch {
      setShowPrompt(true);
      toast.error(s.promptFailed);
    }
  }

  async function readFile(picked: File | undefined) {
    if (!picked) return;
    try {
      setText(await picked.text());
    } catch {
      toast.error(s.fileFailed);
    }
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    const res = await call(
      () => saveOrderSource({ id: source?.id, name: name.trim(), origin: origin.trim() || null, text: body || null }),
      network,
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success(s.saved(res.data.name));
    sourcesChanged();
    onSaved(res.data);
  }

  return (
    <>
      <SheetHead title={source ? s.editTitle : s.newTitle} subtitle={source?.name} onClose={onClose} />
      <SheetBody>
        <Back label={source ? source.name : s.title} onBack={onBack} />
        <label className="block">
          <span className={HEADING}>{s.name}</span>
          <input
            className={INPUT}
            value={name}
            maxLength={80}
            placeholder={s.namePlaceholder}
            enterKeyHint="next"
            onChange={(e) => {
              named.current = true;
              setName(e.target.value);
            }}
          />
        </label>
        <label className="block">
          <span className={HEADING}>{s.originLabel}</span>
          <input
            className={INPUT}
            value={origin}
            maxLength={500}
            placeholder={s.originPlaceholder}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="next"
            onChange={(e) => setOrigin(e.target.value)}
          />
        </label>

        <div>
          <span className={HEADING}>{s.text}</span>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Button rounded tonal onClick={() => void copyPrompt()} className="!h-11 !px-2 text-[14px]">
              <span className="truncate">{s.promptCopy}</span>
            </Button>
            <Button rounded tonal onClick={() => file.current?.click()} className="!h-11 !px-2 text-[14px]">
              <span className="truncate">{s.file}</span>
            </Button>
          </div>
          <input
            ref={file}
            type="file"
            accept=".json,.csv,.txt,.tsv,application/json,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              void readFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <textarea
            value={text}
            rows={8}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder={s.textPlaceholder}
            onChange={(e) => setText(e.target.value)}
            className={`${INPUT} resize-y font-mono text-[13px] leading-snug`}
          />
          {source && body === "" && <p className="mt-1.5 px-1 text-[13px] leading-snug opacity-60">{s.textKeep}</p>}
          <button type="button" onClick={() => setShowPrompt((v) => !v)} className="mt-1 h-11 px-1 text-[14px] text-primary active:opacity-50">
            {s.promptShow}
          </button>
          {showPrompt && (
            <pre className={`${CARD} max-h-72 select-text overflow-auto whitespace-pre-wrap px-4 py-3 text-[12px] leading-snug`}>{s.llmPrompt}</pre>
          )}
        </div>

        {checking && (
          <p aria-live="polite" className="flex items-center gap-2 px-1 text-[15px] opacity-60">
            <Preloader className="!h-4 !w-4" />
            {s.checking}
          </p>
        )}
        {checked && check.error && (
          <p role="alert" className="flex gap-2.5 rounded-2xl bg-amber-50 px-3.5 py-3 text-[14px] leading-snug text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            <Warning className="mt-px h-[18px] w-[18px] shrink-0" />
            <span className="min-w-0">{check.error}</span>
          </p>
        )}
        {checked && check.result && (
          <section aria-live="polite" className="space-y-3">
            <p className="px-1 text-[17px] font-semibold leading-snug">
              {s.checkSummary(check.result.matched, check.result.items)}
              {check.result.duplicates > 0 && <span className="block text-[14px] font-normal opacity-60">{s.duplicates(check.result.duplicates)}</span>}
            </p>
            {check.result.unmatchedCount > 0 && <UnmatchedCard unmatched={check.result.unmatched} total={check.result.unmatchedCount} />}
          </section>
        )}
      </SheetBody>
      <SheetFooter error={error}>
        <PrimaryButton busy={busy} disabled={!canSave} onClick={() => void save()}>
          {s.save}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}
