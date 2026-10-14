"use client";

import * as React from "react";
import { useI18n } from "@/i18n/provider";
import type { CatalogTerm } from "@/lib/vetrina/catalog";
import type { OperationInput, OperationTarget } from "@/lib/vetrina/catalog-ops";
import { Funnel } from "../../icons";
import { formatCount } from "../format";
import { Check, Folder } from "../term/glyphs";
import { useCatalogOverview } from "./data";
import { matches } from "./model";
import {
  ActSheetFrame,
  buttonCount,
  ChosenCard,
  FailedCard,
  LoadingRows,
  ModeSwitch,
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
  type ActSheetProps,
} from "./parts";

/**
 * Many products into a category, or out of it: picked from the store's
 * categories by name or path, then the preview. An automatic category is
 * shown but cannot be picked: its rule decides its products.
 */

export type CategoryMode = "add" | "remove";

export interface CategorySheetProps extends ActSheetProps {
  /** Default "add". */
  mode?: CategoryMode;
  /** The categories the product is in already (one product, from its sheet): marked "Già qui", not offered to add. */
  has?: readonly number[];
}

const MAX_ROWS = 150;
const collator = new Intl.Collator("it", { sensitivity: "base", numeric: true });

export function CategorySheet(props: CategorySheetProps) {
  const target = useLastShown(props.target);
  return (
    <ActSheetFrame open={props.target != null} onClose={props.onClose}>
      {target && <CategoryContent {...props} target={target} />}
    </ActSheetFrame>
  );
}

function CategoryContent({
  target,
  label,
  onClose,
  onStarted,
  mode: startMode = "add",
  has,
}: CategorySheetProps & { target: OperationTarget }) {
  const { t } = useI18n();
  const c = t.vetrinaCatalog.act.category;
  const [mode, setMode] = React.useState<CategoryMode>(startMode);
  const [text, setText] = React.useState("");
  const [chosen, setChosen] = React.useState<CatalogTerm | null>(null);
  const overview = useCatalogOverview();

  const input: OperationInput | null = chosen
    ? { kind: mode === "add" ? "categorize" : "uncategorize", target, categoryId: chosen.id }
    : null;
  const preview = usePreview(input);
  const { run, busy, error, setError } = useStartAction(onClose, onStarted);
  const count = buttonCount(preview);

  return (
    <>
      <SheetHead title={c.title} subtitle={label} onClose={onClose}>
        <ModeSwitch
          value={mode}
          onChange={(next) => {
            setMode(next);
            setError(null);
          }}
          label={c.title}
          options={[
            { value: "add", label: c.modes.add },
            { value: "remove", label: c.modes.remove },
          ]}
        />
      </SheetHead>

      {chosen ? (
        <>
          <SheetBody>
            <ChosenCard media={<FolderBadge />} title={chosen.path} onChange={() => setChosen(null)} />
            <PreviewView state={preview} />
          </SheetBody>
          <SheetFooter error={error}>
            <PrimaryButton
              busy={busy}
              disabled={!input || !preview.current || count === 0}
              onClick={() => input && void run(input)}
            >
              {count ? c.start[mode](chosen.name, count) : c.plain[mode]}
            </PrimaryButton>
          </SheetFooter>
        </>
      ) : (
        <SheetBody footer={false}>
          <SheetSearch value={text} onChange={setText} placeholder={c.search} />
          {overview.error != null && !overview.data ? (
            <FailedCard message={c.failed} onRetry={() => void overview.mutate()} />
          ) : !overview.data ? (
            <LoadingRows label={c.loading} />
          ) : (
            <CategoryList
              categories={overview.data.categories}
              text={text}
              here={mode === "add" ? has : undefined}
              onPick={(category) => {
                setError(null);
                setChosen(category);
              }}
            />
          )}
        </SheetBody>
      )}
    </>
  );
}

function CategoryList({
  categories,
  text,
  here,
  onPick,
}: {
  categories: readonly CatalogTerm[];
  text: string;
  /** Already in these: shown, marked, not picked. */
  here?: readonly number[];
  onPick: (category: CatalogTerm) => void;
}) {
  const { t, locale } = useI18n();
  const c = t.vetrinaCatalog.act.category;
  const found = React.useMemo(
    () => categories.filter((cat) => matches(cat.path, text)).sort((a, b) => collator.compare(a.path, b.path)),
    [categories, text],
  );

  if (found.length === 0) {
    return <p className="px-1 py-6 text-center text-[15px] opacity-60">{categories.length === 0 ? c.empty : c.none}</p>;
  }
  return (
    <>
      <PickList label={c.title}>
        {found.slice(0, MAX_ROWS).map((cat) => {
          const cut = cat.path.lastIndexOf(" › ");
          const parents = cut >= 0 ? cat.path.slice(0, cut) : "";
          const automatic = cat.automatic != null;
          const inIt = here?.includes(cat.id) ?? false;
          return (
            <PickRow
              key={cat.id}
              disabled={automatic || inIt}
              media={<FolderBadge automatic={automatic} />}
              title={cat.name}
              subtitle={
                automatic || parents ? (
                  <span className="line-clamp-1">{[parents, automatic ? c.automatic : ""].filter(Boolean).join(" · ")}</span>
                ) : undefined
              }
              after={
                inIt ? (
                  <span className="flex items-center gap-1 text-[14px] text-primary">
                    <Check className="h-4 w-4" />
                    {c.here}
                  </span>
                ) : (
                  <span className="tabular-nums">{formatCount(cat.count, locale)}</span>
                )
              }
              onPick={() => onPick(cat)}
            />
          );
        })}
      </PickList>
      {found.length > MAX_ROWS && <p className="px-1 text-center text-[13px] opacity-60">{c.more(found.length - MAX_ROWS)}</p>}
    </>
  );
}

function FolderBadge({ automatic = false }: { automatic?: boolean }) {
  const Icon = automatic ? Funnel : Folder;
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/[0.06] dark:bg-white/10">
      <Icon className="h-[18px] w-[18px] opacity-70" />
    </span>
  );
}
