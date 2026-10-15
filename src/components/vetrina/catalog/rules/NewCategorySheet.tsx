"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { CollectionCondition } from "@core/collections";
import { useI18n } from "@/i18n/provider";
import type { CollectionsStatus, TermEditor } from "@/lib/collections/types";
import { loadCollectionOptions, pollCollections, saveCollectionDraft } from "@/server/actions/collections";
import {
  blankCondition,
  editorFrom,
  toDraft,
  useDraftCheck,
  waitForRuns,
  type EditorCondition,
  type EditorState,
} from "@/components/collections/editor-model";
import { ConditionsField, MatchField, RuleProblems, type Look } from "@/components/collections/RuleFields";
import { RulePreview, type PreviewLook } from "@/components/collections/RulePreview";
import {
  ActSheetFrame,
  CARD,
  FailedCard,
  HEADING,
  LoadingRows,
  PrimaryButton,
  SheetBody,
  SheetFooter,
  SheetHead,
  useLastShown,
} from "../act/parts";
import { termHref } from "../term/list-model";
import { NETWORK_CODE, plainError } from "./errors";
import { takenBy } from "./naming";

/**
 * "Nuova categoria automatica", from the catalog's "+" or from a list's
 * filters ("Salva come categoria automatica"): a name, where it sits, and the
 * rule that fills it — the Hub's own rule editor (editor-model, RuleFields,
 * RulePreview), with the same checks and preview as the section editor's
 * sheet. Saving creates the category on the store and applies the rule;
 * once its products have moved, the new category's screen opens.
 */

export interface NewCategoryRequest {
  /** The rule it starts from; none: one empty condition. */
  conditions?: CollectionCondition[];
  /** Under the title: where it comes from ("Dai filtri di «Nike»"). */
  from?: string;
  /** What the filters could not carry into the rule, said above it. */
  notes?: string[];
}

// The same skin as the section editor's sheet (CollectionSheet), so a rule looks the same wherever it is made.
const field =
  "w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-[16px] outline-none focus-visible:!outline-none dark:border-white/15 dark:bg-white/10";

/** A native select's chevron, drawn: with the platform's arrow taken away (appearance-none) it read as a text field. */
const CHEVRON =
  "bg-[url(data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2012%208%27%3E%3Cpath%20d=%27M1%201.5l5%205%205-5%27%20fill=%27none%27%20stroke=%27%238e8e93%27%20stroke-width=%271.6%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E)] bg-[length:12px_8px] bg-[position:right_12px_center] bg-no-repeat pe-9";

const PHONE_LOOK: Look = {
  label: "text-[13px] font-semibold uppercase tracking-wide opacity-60",
  hint: "mt-1 block text-[13px] leading-snug opacity-60",
  select: `${field} appearance-none ${CHEVRON}`,
  input: `${field} placeholder:opacity-40 focus:border-black/30 dark:focus:border-white/40 disabled:opacity-40`,
  problem: "text-[13px] text-red-600 dark:text-red-400",
  segment: "flex w-full rounded-xl bg-black/[0.06] p-0.5 dark:bg-white/10",
  // 44px tall: a thumb's target, unlike the Hub's desktop editor.
  segmentOn: "min-h-11 flex-1 rounded-[10px] bg-white px-3 py-1.5 text-[15px] font-semibold shadow-sm dark:bg-white/25",
  segmentOff: "min-h-11 flex-1 rounded-[10px] px-3 py-1.5 text-[15px] opacity-70",
  // The sheet's cards (look.ts): a step lighter than the sheet in dark mode, as every Vetrina sheet draws them.
  row: "space-y-2 rounded-2xl bg-white p-3 shadow-sm dark:bg-[#2c2c2e]",
  add: "w-full rounded-2xl border border-dashed border-black/15 py-3 text-[15px] font-semibold text-primary disabled:opacity-40 dark:border-white/20",
  // Drawn small, so its row under the fields stays slim; 44px to the finger with its invisible margin.
  remove:
    "relative -my-1 grid h-7 w-11 place-items-center rounded-full text-[15px] opacity-50 before:absolute before:-inset-y-2 before:inset-x-0 before:content-[''] active:opacity-30",
};

const PHONE_PREVIEW: PreviewLook = {
  frame: "space-y-2 rounded-2xl bg-white p-4 shadow-sm dark:bg-[#2c2c2e]",
  title: "text-[15px] font-bold",
  numbers: "text-[15px] font-semibold tabular-nums",
  listTitle: "text-[12px] font-semibold uppercase tracking-wide opacity-50",
  item: "truncate text-[14px] opacity-70",
  note: "text-[13px] opacity-60",
  warn: "text-[13px] font-medium text-amber-700 dark:text-amber-400",
};

/** How long the sheet waits for the rule's first run before opening the category anyway. */
const APPLY_WAIT_MS = 45_000;

export function NewCategorySheet({ request, onClose }: { request: NewCategoryRequest | null; onClose: () => void }) {
  // While the sheet slides away it keeps what it was opened on.
  const shown = useLastShown(request);
  return (
    <ActSheetFrame open={request != null} onClose={onClose}>
      {shown && <NewCategoryContent request={shown} onClose={onClose} />}
    </ActSheetFrame>
  );
}

type Loaded = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; editor: TermEditor };

/** The conditions it opens with, each with the key the editor needs for React. */
function startConditions(conditions: CollectionCondition[] | undefined): EditorCondition[] {
  if (!conditions || conditions.length === 0) return [blankCondition()];
  const at = Date.now();
  return conditions.map((c, i) => ({ ...c, key: `prefill-${at}-${i}` }));
}

function NewCategoryContent({ request, onClose }: { request: NewCategoryRequest; onClose: () => void }) {
  const { t } = useI18n();
  const r = t.vetrinaCatalog.rules;
  const router = useRouter();
  const [loaded, setLoaded] = React.useState<Loaded>({ state: "loading" });
  const [tries, setTries] = React.useState(0);
  const [state, setState] = React.useState<EditorState>(() => ({
    ...editorFrom(null),
    categoryMode: "new",
    conditions: startConditions(request.conditions),
  }));
  // The conditions the owner has changed (or that came filled in): a blank one just opened is not "missing a value" yet.
  const [touched, setTouched] = React.useState<ReadonlySet<string>>(
    () => new Set(request.conditions && request.conditions.length > 0 ? state.conditions.map((c) => c.key) : []),
  );
  // "saving": the category and its rule are written; "applying": its products are moving in.
  const [phase, setPhase] = React.useState<"edit" | "saving" | "applying">("edit");
  const [error, setError] = React.useState<string | null>(null);
  // The sheet closed while the products moved: no screen opens by itself then.
  const open = React.useRef(true);
  React.useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  // The store's categories, tags, brands and attributes, read fresh at every opening (this also brings the index up to date).
  React.useEffect(() => {
    let alive = true;
    void loadCollectionOptions()
      .catch(() => ({ ok: false as const, code: NETWORK_CODE, error: "" }))
      .then((res) => {
        if (!alive) return;
        // Our words, never the server's: its detail is in its log.
        const error = !res.ok && res.code === NETWORK_CODE ? r.network : r.loadFailed;
        setLoaded(res.ok ? { state: "ready", editor: res.data } : { state: "failed", error });
      });
    return () => {
      alive = false;
    };
  }, [tries, r]);

  const editor = loaded.state === "ready" ? loaded.editor : null;
  const name = state.newName.trim();
  const draft = React.useMemo(() => (editor ? toDraft(state) : null), [editor, state]);
  const { check, checking, error: checkError } = useDraftCheck(draft, editor?.indexProducts ?? 0);
  // A new category has no category to choose: until it has a name, the button says so instead.
  const problems = (check?.problems ?? []).filter((p) => p.kind !== "noCategory");
  // Said under a condition once the owner has been at it: the button waits for every problem all the same.
  const shownProblems = problems.filter(
    (p) => !(p.kind === "badValue" && !touched.has(state.conditions[p.index]?.key ?? "")),
  );
  const patch = (next: Partial<EditorState>) => setState((prev) => ({ ...prev, ...next }));
  const busy = phase !== "edit";
  const taken = editor ? takenBy(editor.options.categories, name, state.newParent) : undefined;
  const canSave =
    editor != null && name !== "" && !taken && check != null && !checking && problems.length === 0 && !busy;

  async function save() {
    if (!draft || !canSave) return;
    setPhase("saving");
    setError(null);
    const res = await saveCollectionDraft(draft).catch(() => ({ ok: false as const, code: NETWORK_CODE, error: "" }));
    if (!res.ok) {
      // A failed query, the store's English: none of it is for the owner (the server logs it).
      setError(plainError(res.code, { ...r.errors, network: r.network }));
      setPhase("edit");
      return;
    }
    // The rule's first run moves the products in: wait for it, so the screen opens full.
    setPhase("applying");
    // A connection lost while waiting is not a failed save: the rule is saved, the products follow.
    const { status, done } = await waitForRuns(APPLY_WAIT_MS).catch(() => ({ status: null, done: false }));
    const termId = termOf(status, res.data.id) ?? termOf(await pollStatus(), res.data.id);
    const href = termId != null ? termHref("category", termId) : null;
    const openIt = href ? { label: r.open, onClick: () => router.push(href) } : undefined;
    const said = !done
      ? r.slow(name)
      : status?.runner.lastError
        ? r.errors.moved
        : r.created(name, status?.runner.lastMoved ?? 0);
    const tone = done && status?.runner.lastError ? toast.error : done ? toast.success : toast;
    if (open.current && href) {
      tone(said);
      onClose();
      router.push(href);
    } else {
      // Closed meanwhile (or the category could not be found): the toast offers to open it.
      tone(said, { action: openIt, duration: 10_000 });
      if (open.current) onClose();
    }
  }

  const buttonText =
    phase === "saving" ? r.saving : phase === "applying" ? r.applying(name) : name === "" ? r.nameFirst : r.save;

  return (
    <>
      <SheetHead title={r.title} subtitle={request.from} onClose={onClose} />
      <SheetBody>
        <p className="px-1 text-[14px] leading-snug opacity-60">{r.intro}</p>

        {loaded.state === "loading" ? (
          <LoadingRows label={r.loading} />
        ) : loaded.state === "failed" ? (
          <FailedCard
            message={loaded.error}
            onRetry={() => {
              setLoaded({ state: "loading" });
              setTries((n) => n + 1);
            }}
          />
        ) : (
          <>
            {loaded.editor.demo && <p className="px-1 text-[13px] opacity-60">{t.vetrina.demo}</p>}

            <section className={`${CARD} space-y-3 p-4`}>
              <label className="block">
                <span className={HEADING}>{r.name}</span>
                <input
                  className={PHONE_LOOK.input}
                  value={state.newName}
                  placeholder={r.namePlaceholder}
                  maxLength={120}
                  enterKeyHint="done"
                  disabled={busy}
                  onChange={(e) => patch({ newName: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLElement).blur();
                  }}
                  aria-invalid={taken ? true : undefined}
                />
                {taken && <span className={`${PHONE_LOOK.problem} mt-1.5 block leading-snug`}>{r.nameTaken(taken.name)}</span>}
              </label>
              <label className="block">
                <span className={HEADING}>{r.parent}</span>
                <select
                  className={PHONE_LOOK.select}
                  value={state.newParent}
                  disabled={busy}
                  onChange={(e) => patch({ newParent: Number(e.target.value) })}
                >
                  <option value={0}>{r.topLevel}</option>
                  {loaded.editor.options.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.path}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <section className="space-y-3">
              <span className={HEADING}>{r.rule}</span>
              {request.notes && request.notes.length > 0 && (
                <ul className="space-y-1.5">
                  {request.notes.map((note) => (
                    <li key={note} className="px-1 text-[13px] leading-snug opacity-60">
                      {note}
                    </li>
                  ))}
                </ul>
              )}
              <MatchField value={state.match} onChange={(match) => patch({ match })} look={PHONE_LOOK} />
              <ConditionsField
                conditions={state.conditions}
                onChange={(conditions) => {
                  const before = new Map(state.conditions.map((c) => [c.key, JSON.stringify(c)]));
                  const changed = conditions.filter((c) => before.has(c.key) && before.get(c.key) !== JSON.stringify(c));
                  if (changed.length > 0) setTouched((prev) => new Set([...prev, ...changed.map((c) => c.key)]));
                  patch({ conditions });
                }}
                options={loaded.editor.options}
                problems={shownProblems}
                look={PHONE_LOOK}
              />
              <RuleProblems problems={shownProblems} look={PHONE_LOOK} />
            </section>

            <RulePreview
              preview={check?.preview ?? null}
              checking={checking}
              error={checkError && r.errors.check}
              indexProducts={loaded.editor.indexProducts}
              isNew
              look={PHONE_PREVIEW}
            />
          </>
        )}
      </SheetBody>
      <SheetFooter error={error}>
        <PrimaryButton disabled={!canSave} onClick={() => void save()}>
          {buttonText}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}

/** The category a saved rule fills, from the automatic categories' status. */
function termOf(status: CollectionsStatus | null, collectionId: string): number | null {
  return status?.collections.find((c) => c.id === collectionId)?.termId ?? null;
}

async function pollStatus(): Promise<CollectionsStatus | null> {
  try {
    const res = await pollCollections();
    return res.ok ? res.data : null;
  } catch {
    return null;
  }
}
