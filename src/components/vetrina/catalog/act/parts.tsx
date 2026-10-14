"use client";

import * as React from "react";
import { Sheet } from "react-modal-sheet";
import { Button, Chip, List, ListItem, Preloader, Segmented, SegmentedButton } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { OperationInput, OperationKind, OperationPreview, OperationTarget, OperationView } from "@/lib/vetrina/catalog-ops";
import { previewOperation } from "@/server/actions/vetrina-operations";
import { Close } from "../../icons";
import { SEGMENTED_COLORS } from "../../segmented";
import { useSheetMount } from "../../sheet-mount";
import { formatCount } from "../format";
import { SHEET_CARD, SHEET_LIST_COLORS } from "../sheet/look";
import { Search } from "../term/glyphs";
import { call } from "./call";
import { Arrow, Warning } from "./icons";
import { useOperations } from "./operations-context";

/**
 * The pieces every action sheet is made of: the sheet itself, its title and
 * what it acts on, a mode switch, the preview (named products, before →
 * after, what stays as it is and why, what to know), and the button that
 * starts the action and closes the sheet.
 */

/** What every action sheet takes. */
export interface ActSheetProps {
  /** The products it acts on; null = closed. */
  target: OperationTarget | null;
  /** What that is, in words, under the title: "3 prodotti", "Tutti i 120 prodotti di «Nike»", a product's name. */
  label: string;
  onClose: () => void;
  /** The action started; the sheet has closed itself. The tracker follows it from here. */
  onStarted?: (view: OperationView) => void;
}

/** A card of a sheet: the product sheet's own (look.ts), a step lighter than the sheet in dark mode, as iOS draws it. */
export const CARD = SHEET_CARD;
export const HEADING = "mb-1.5 block px-1 text-[13px] font-semibold uppercase tracking-wide opacity-50";
/** White on the primary: globals.css turns it dark when the primary turns white. */
export const FILL = { fillTextIos: "text-white dark:text-black", fillTextMaterial: "text-white dark:text-black" };
const DANGER = {
  fillBgIos: "bg-red-600 active:bg-red-700",
  fillBgMaterial: "bg-red-600",
  fillTextIos: "text-white",
  fillTextMaterial: "text-white",
};

/**
 * The last value that was not null: a sheet keeps showing what it was
 * opened on while it slides away, after the screen has let go of it.
 */
export function useLastShown<T>(value: T | null): T | null {
  const [last, setLast] = React.useState(value);
  // React's way of keeping something from an earlier render: set while rendering, no effect.
  if (value != null && value !== last) setLast(value);
  return value ?? last;
}

/** A bottom sheet in the Vetrina's look, inside the app shell. Its content mounts fresh at every opening. */
export function ActSheetFrame({
  open,
  onClose,
  detent = "default",
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** "default": nearly the whole screen (lists to pick from); "content": as tall as it needs. */
  detent?: "default" | "content";
  children: React.ReactNode;
}) {
  const mountPoint = useSheetMount();
  return (
    <Sheet isOpen={open} onClose={onClose} detent={detent} avoidKeyboard mountPoint={mountPoint}>
      <Sheet.Container className="!bg-[#f2f2f7] dark:!bg-[#1c1c1e]">{children}</Sheet.Container>
      <Sheet.Backdrop onTap={onClose} />
    </Sheet>
  );
}

/** The grabber, the title, what the action acts on, and a close button. */
export function SheetHead({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Under the title and outside the scroll: the mode switch. */
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <>
      <Sheet.Header />
      <div className="flex items-start gap-2 ps-4 pe-2">
        <div className="min-w-0 flex-1 pb-3">
          <h2 className="text-[20px] font-bold leading-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 line-clamp-2 text-[14px] leading-snug opacity-60">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.vetrinaCatalog.act.sheet.close}
          className="-mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full transition-opacity active:opacity-50"
        >
          <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-black/[0.06] dark:bg-white/10">
            <Close className="h-4 w-4 opacity-60" />
          </span>
        </button>
      </div>
      {children}
    </>
  );
}

/** The sheet's scrolling part. Without a footer, it keeps clear of the home indicator itself. */
export function SheetBody({
  children,
  disableDrag = false,
  footer = true,
}: {
  children: React.ReactNode;
  /** A slider inside: dragging it must not drag the sheet. */
  disableDrag?: boolean;
  footer?: boolean;
}) {
  return (
    <Sheet.Content disableDrag={disableDrag}>
      <div className={`space-y-5 px-4 pt-1 ${footer ? "pb-5" : "pb-[calc(env(safe-area-inset-bottom)+24px)]"}`}>{children}</div>
    </Sheet.Content>
  );
}

/** Below the scroll, above the home indicator: the action's button, and why it did not start. */
export function SheetFooter({ error, children }: { error?: string | null; children: React.ReactNode }) {
  return (
    <div className="shrink-0 space-y-2 border-t border-black/[0.06] px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 dark:border-white/10">
      {error && (
        <p role="alert" className="px-1 text-[14px] leading-snug text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled = false,
  busy = false,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  danger?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Button large rounded disabled={disabled || busy} onClick={onClick} colors={danger ? DANGER : FILL} className="w-full">
      <span className="truncate">{busy ? t.vetrinaCatalog.act.sheet.starting : children}</span>
    </Button>
  );
}

/** Two or three ways of the same action (Metti in saldo / Togli il saldo), as iOS's segmented control. */
export function ModeSwitch<T extends string>({
  value,
  options,
  onChange,
  label,
  className = "px-4 pb-3",
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  /** Under a sheet's title by default; inside the form, its own spacing. */
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={className}>
      <Segmented strong rounded colors={SEGMENTED_COLORS}>
        {options.map((o) => (
          <SegmentedButton
            key={o.value}
            className="!h-11"
            active={o.value === value}
            aria-pressed={o.value === value}
            onClick={() => o.value !== value && onChange(o.value)}
          >
            {o.label}
          </SegmentedButton>
        ))}
      </Segmented>
    </div>
  );
}

const CHIP_IDLE = {
  fillBgIos: "bg-black/[0.06] dark:bg-white/10",
  fillBgMaterial: "bg-black/[0.06] dark:bg-white/10",
  fillTextIos: "text-black dark:text-white",
  fillTextMaterial: "text-black dark:text-white",
};
// White text on the primary: globals.css turns it dark when the primary turns white.
const CHIP_ACTIVE = {
  fillBgIos: "bg-primary",
  fillBgMaterial: "bg-primary",
  fillTextIos: "text-white",
  fillTextMaterial: "text-white",
};

/** A quick choice (−20%, Domenica): a chip inside a 44px-tall button, like the catalog's filter chips. */
export function ChoiceChip({
  active,
  onClick,
  fill = false,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** As wide as its grid column, words centred: a row of choices that all stay in sight. */
  fill?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`py-1 transition-opacity active:opacity-60 ${fill ? "min-w-0" : "shrink-0"}`}
    >
      <Chip
        component="span"
        colors={active ? CHIP_ACTIVE : CHIP_IDLE}
        className={
          fill
            ? "!h-9 w-full min-w-0 justify-center !px-1 text-[14px] font-medium tabular-nums max-[359px]:text-[12px]"
            : "!h-9 !px-4 text-[15px] font-medium tabular-nums"
        }
      >
        {fill ? <span className="truncate">{children}</span> : children}
      </Chip>
    </button>
  );
}

/** A search field for a sheet's list: 16px, so the phone does not zoom; no autocorrect on names. */
export function SheetSearch({
  value,
  onChange,
  placeholder,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** "Invio" on the keyboard. */
  onSubmit?: () => void;
}) {
  const { t } = useI18n();
  return (
    <label className="flex h-11 items-center gap-2 rounded-xl bg-black/[0.06] px-3 dark:bg-white/10">
      <Search className="h-[18px] w-[18px] shrink-0 opacity-40" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint={onSubmit ? "done" : "search"}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (onSubmit) onSubmit();
          else (e.target as HTMLElement).blur();
        }}
        // The field's own rounded box shows it has focus: no square ring inside it (globals.css draws one on every focus).
        className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:opacity-40 focus-visible:!outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t.vetrinaCatalog.act.sheet.clear}
          className="-me-3 grid h-11 w-11 shrink-0 place-items-center opacity-40 active:opacity-20"
        >
          <Close className="h-4 w-4" />
        </button>
      )}
    </label>
  );
}

/** A sheet's list to pick from (tags, categories, sections): a grouped list, edge to edge in the sheet. */
export function PickList({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <List strong inset dividers colors={SHEET_LIST_COLORS} className="!mx-0 !my-0" aria-label={label}>
      {children}
    </List>
  );
}

/** A row of a PickList: a tap picks it (and moves on, hence the chevron); a disabled one, greyed whole, says why below its name. */
export function PickRow({
  title,
  subtitle,
  after,
  media,
  onPick,
  disabled = false,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  after?: React.ReactNode;
  media?: React.ReactNode;
  onPick: () => void;
  disabled?: boolean;
}) {
  if (disabled) {
    // Every part at the same strength, the reason too: the row reads as one thing that cannot be picked.
    const dim = (part: React.ReactNode) => part != null && part !== false && <span className="opacity-40">{part}</span>;
    return (
      <ListItem
        aria-disabled
        media={dim(media)}
        title={dim(title)}
        subtitle={dim(subtitle)}
        after={dim(after)}
        titleFontSizeIos="text-[16px]"
        titleFontSizeMaterial="text-[16px]"
      />
    );
  }
  return (
    <ListItem
      link
      linkComponent="button"
      linkProps={{ type: "button", onClick: onPick }}
      contentClassName="w-full text-start"
      media={media}
      title={title}
      subtitle={subtitle}
      after={after}
      titleFontSizeIos="text-[16px]"
      titleFontSizeMaterial="text-[16px]"
    />
  );
}

/** A list being read: its place held, so the sheet does not jump. */
export function LoadingRows({ label }: { label: string }) {
  return (
    <div
      aria-busy
      aria-label={label}
      className={`${CARD} flex min-h-40 items-center justify-center gap-2 text-[14px] opacity-60`}
    >
      <Preloader className="!h-5 !w-5" />
      {label}
    </div>
  );
}

/** A list that could not be read, with a way to try again. */
export function FailedCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className={`${CARD} flex items-center gap-3 p-3`}>
      <p className="min-w-0 flex-1 text-[14px] leading-snug opacity-70">{message}</p>
      <Button rounded tonal inline onClick={onRetry} className="!h-11 shrink-0 !px-4">
        {t.vetrinaCatalog.act.sheet.retry}
      </Button>
    </div>
  );
}

/** What was picked, at the top of the confirm step, with "Cambia" back to the list. */
export function ChosenCard({
  media,
  title,
  note,
  onChange,
}: {
  media?: React.ReactNode;
  title: React.ReactNode;
  note?: React.ReactNode;
  onChange: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={`${CARD} flex items-center gap-3 py-2 ps-4 pe-2`}>
      {media}
      <div className="min-w-0 flex-1 py-1">
        <div className="truncate text-[16px] font-semibold leading-snug">{title}</div>
        {note && <div className="mt-0.5 text-[13px] leading-snug opacity-60">{note}</div>}
      </div>
      <Button clear rounded inline onClick={onChange} className="!h-11 shrink-0 !px-3">
        {t.vetrinaCatalog.act.sheet.change}
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * The preview
 * ---------------------------------------------------------------- */

export interface PreviewState {
  /** The last preview that arrived — maybe for an earlier choice, while the new one is read. */
  preview: OperationPreview | null;
  /** The preview answers what is chosen now: the button may start it. */
  current: boolean;
  loading: boolean;
  error: string | null;
  /**
   * The server said no to what is chosen (too many products, a term already
   * hidden): its words are the whole answer, and asking again would not
   * help. Otherwise the error is the way there (offline, a failure).
   */
  refused: boolean;
  retry: () => void;
}

/** Answers that are the server's verdict on what is asked, not a failure to ask. */
const REFUSALS = new Set(["invalid", "stale", "not_found"]);

/**
 * The preview of what is chosen now, read again when the choice changes —
 * after `delay` ms of quiet, so a slider does not ask at every step. Only
 * the latest answer is kept; the previous one stays on screen, dimmed,
 * until it arrives, so nothing jumps.
 */
export function usePreview(input: OperationInput | null, delay = 0): PreviewState {
  const { t } = useI18n();
  const network = t.vetrinaCatalog.act.sheet.network;
  const key = input ? JSON.stringify(input) : "";
  const [state, setState] = React.useState<{
    key: string;
    preview: OperationPreview | null;
    error: string | null;
    refused: boolean;
  }>({
    key: "",
    preview: null,
    error: null,
    refused: false,
  });
  const [tries, setTries] = React.useState(0);

  React.useEffect(() => {
    if (!key) return;
    let alive = true;
    const timer = setTimeout(() => {
      void call(() => previewOperation(JSON.parse(key) as OperationInput), network).then((res) => {
        if (!alive) return;
        setState(
          res.ok
            ? { key, preview: res.data, error: null, refused: false }
            : { key, preview: null, error: res.error, refused: REFUSALS.has(res.code) },
        );
      });
    }, delay);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, delay, tries, network]);

  const answered = key !== "" && state.key === key;
  return {
    preview: state.preview,
    current: answered && state.preview != null,
    loading: key !== "" && !answered,
    error: answered ? state.error : null,
    refused: answered && state.refused,
    retry: () => {
      setState((s) => ({ ...s, key: "" }));
      setTries((n) => n + 1);
    },
  };
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Previews whose before → after are lists of names (tags, categories): too long to sit on one line with an arrow. */
const LIST_KINDS = new Set<OperationKind>(["tag", "untag", "categorize", "uncategorize"]);

/**
 * The preview, as the owner reads it: how many change, what to know, the
 * first products before → after, and those left as they are with why.
 */
export function PreviewView({ state }: { state: PreviewState }) {
  const { t, locale } = useI18n();
  const p = t.vetrinaCatalog.act.preview;
  const { preview, loading, error } = state;

  if (error && state.refused) {
    // The server's no, in its words: nothing failed, and trying again would say the same.
    return (
      <p role="alert" className="flex gap-2.5 rounded-2xl bg-amber-50 px-3.5 py-3 text-[14px] leading-snug text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
        <Warning className="mt-px h-[18px] w-[18px] shrink-0" />
        <span className="min-w-0">{error}</span>
      </p>
    );
  }
  if (error) {
    return (
      <div className={`${CARD} flex items-center gap-3 p-3`}>
        <p className="min-w-0 flex-1 text-[14px] leading-snug">
          <span className="block font-semibold">{p.failed}</span>
          <span className="opacity-70">{error}</span>
        </p>
        <Button rounded tonal inline onClick={state.retry} className="!h-11 shrink-0 !px-4">
          {t.vetrinaCatalog.act.sheet.retry}
        </Button>
      </div>
    );
  }
  if (!preview) return <PreviewSkeleton label={p.loading} />;

  const left = preview.untouched.reduce((sum, u) => sum + u.count, 0);
  const more = Math.max(0, preview.changes - preview.sample.length);
  const sampledFew = preview.sampled != null && preview.sampled < preview.changes + left;

  return (
    <section aria-busy={loading} className={`space-y-4 transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
      <p aria-live="polite" className="flex items-center gap-2 px-1 text-[17px] font-semibold leading-snug">
        {p.changes(preview.changes)}
        {loading && <Preloader className="!h-4 !w-4" />}
      </p>

      {preview.warnings.length > 0 && (
        <ul className="space-y-2">
          {preview.warnings.map((w) => (
            <li
              key={w}
              className="flex gap-2.5 rounded-2xl bg-amber-50 px-3.5 py-3 text-[14px] leading-snug text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
            >
              <Warning className="mt-px h-[18px] w-[18px] shrink-0" />
              <span className="min-w-0">{w}</span>
            </li>
          ))}
        </ul>
      )}

      {preview.sample.length > 0 && (
        <div>
          <ul className={`${CARD} divide-y divide-black/5 dark:divide-white/10`}>
            {preview.sample.map((s) => (
              <li key={s.id} className="px-4 py-2.5">
                <div className="truncate text-[15px] leading-snug">{s.name}</div>
                {LIST_KINDS.has(preview.kind) ? (
                  <dl className="mt-0.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-[13px] leading-snug">
                    <dt className="opacity-55">{p.before}</dt>
                    <dd className="opacity-55">{s.before}</dd>
                    <dt className="opacity-55">{p.after}</dt>
                    <dd className="font-semibold">{s.after}</dd>
                  </dl>
                ) : (
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] tabular-nums">
                    <span className="opacity-55">{s.before}</span>
                    {/* The arrow goes with what comes after it: a line that wraps never leaves it alone. */}
                    <span className="inline-flex min-w-0 items-center gap-x-1.5">
                      <Arrow className="h-3.5 w-3.5 shrink-0 opacity-40" />
                      <span className="font-semibold">{s.after}</span>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {more > 0 && <p className="mt-1.5 px-1 text-[13px] opacity-60">{p.more(more)}</p>}
          {sampledFew && <p className="mt-1.5 px-1 text-[12px] leading-snug opacity-50">{p.sampled(preview.sampled ?? 0)}</p>}
        </div>
      )}

      {preview.untouched.length > 0 && (
        <div>
          <span className={HEADING}>{p.untouched}</span>
          <ul className={`${CARD} divide-y divide-black/5 dark:divide-white/10`}>
            {preview.untouched.map((u) => (
              <li key={u.reason} className="flex min-h-11 items-center gap-3 px-4 py-2 text-[15px]">
                <span className="min-w-0 flex-1 leading-snug">{capitalized(u.reason)}</span>
                <span className="shrink-0 tabular-nums opacity-60">{formatCount(u.count, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** The preview's shape while it is read the first time: the sheet does not jump when it arrives. */
function PreviewSkeleton({ label }: { label: string }) {
  const bar = "block rounded-full bg-black/[0.08] dark:bg-white/15";
  return (
    <section aria-busy aria-label={label} className="space-y-4">
      <p className="flex items-center gap-2 px-1 text-[15px] opacity-60">
        <Preloader className="!h-4 !w-4" />
        {label}
      </p>
      <div className={`${CARD} divide-y divide-black/5 motion-safe:animate-pulse dark:divide-white/10`} aria-hidden>
        {["w-48", "w-40", "w-52"].map((w) => (
          <div key={w} className="space-y-2 px-4 py-3">
            <span className={`${bar} h-3.5 ${w}`} />
            <span className={`${bar} h-3 w-28`} />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- *
 * Starting
 * ---------------------------------------------------------------- */

/**
 * The sheet's button: start the action through the tracker; on success the
 * sheet closes and the screen hears of it, on a refusal the server's words
 * show above the button and the sheet stays.
 */
export function useStartAction(onClose: () => void, onStarted?: (view: OperationView) => void) {
  const ops = useOperations();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // A second tap before the button greys out must not start it twice.
  const going = React.useRef(false);
  const run = async (input: OperationInput) => {
    if (going.current) return;
    going.current = true;
    setBusy(true);
    setError(null);
    const res = await ops.start(input);
    going.current = false;
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onClose();
    onStarted?.(res.data);
  };
  return { run, busy, error, setError };
}

/** The button's label: with the preview's count once it answers what is chosen, plain before. */
export function buttonCount(state: PreviewState): number | null {
  return state.current && state.preview ? state.preview.changes : null;
}
