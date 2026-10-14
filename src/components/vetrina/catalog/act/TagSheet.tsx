"use client";

import * as React from "react";
import { useI18n } from "@/i18n/provider";
import type { TermOption } from "@/lib/collections/types";
import type { OperationInput, OperationTarget } from "@/lib/vetrina/catalog-ops";
import { Tag } from "../term/glyphs";
import { useCatalogOverview, useStoreTags } from "./data";
import { Plus } from "./icons";
import { matches, readersOfTag, sameName } from "./model";
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
 * A tag on many products at once, or off them: picked from the store's tags
 * (or typed: a new one is created), then the preview. Tags are what the
 * automatic categories read, so the sheet names the ones reading this tag:
 * products may join or leave them.
 */

export type TagMode = "add" | "remove";

export interface TagSheetProps extends ActSheetProps {
  /** Default "add". */
  mode?: TagMode;
}

/** Rows a search shows at most: typing narrows the rest. */
const MAX_ROWS = 150;

const collator = new Intl.Collator("it", { sensitivity: "base", numeric: true });

interface ChosenTag {
  /** None: a tag the store does not have yet, created when the action runs. */
  id?: number;
  name: string;
}

export function TagSheet(props: TagSheetProps) {
  const target = useLastShown(props.target);
  return (
    <ActSheetFrame open={props.target != null} onClose={props.onClose}>
      {target && <TagContent {...props} target={target} />}
    </ActSheetFrame>
  );
}

function TagContent({ target, label, onClose, onStarted, mode: startMode = "add" }: TagSheetProps & { target: OperationTarget }) {
  const { t } = useI18n();
  const g = t.vetrinaCatalog.act.tag;
  const [mode, setMode] = React.useState<TagMode>(startMode);
  const [text, setText] = React.useState("");
  const [chosen, setChosen] = React.useState<ChosenTag | null>(null);
  const tags = useStoreTags();
  const overview = useCatalogOverview();
  const categories = overview.data?.categories;

  const readers = React.useCallback(
    (id: number | undefined) => (id != null && categories ? readersOfTag(categories, id) : []),
    [categories],
  );

  const input: OperationInput | null = !chosen
    ? null
    : mode === "add"
      ? { kind: "tag", target, tag: chosen.id != null ? { id: chosen.id, name: chosen.name } : { name: chosen.name } }
      : chosen.id != null
        ? { kind: "untag", target, tagId: chosen.id }
        : null;
  const preview = usePreview(input);
  const { run, busy, error, setError } = useStartAction(onClose, onStarted);
  const count = buttonCount(preview);

  function switchMode(next: TagMode) {
    setMode(next);
    setError(null);
    // A tag still to be created cannot be taken off anything: back to the list.
    if (next === "remove" && chosen?.id == null) setChosen(null);
  }

  const chosenReaders = readers(chosen?.id);

  return (
    <>
      <SheetHead title={g.title} subtitle={label} onClose={onClose}>
        <ModeSwitch
          value={mode}
          onChange={switchMode}
          label={g.title}
          options={[
            { value: "add", label: g.modes.add },
            { value: "remove", label: g.modes.remove },
          ]}
        />
      </SheetHead>

      {chosen ? (
        <>
          <SheetBody>
            {/* A new tag is said once, by the preview: the server knows whether the store has it by now. */}
            <ChosenCard media={<TagBadge />} title={chosen.name} onChange={() => setChosen(null)} />
            {chosenReaders.length > 0 && (
              <p className="px-1 text-[13px] leading-snug opacity-60">{g.readByNote(chosenReaders)}</p>
            )}
            <PreviewView state={preview} />
          </SheetBody>
          <SheetFooter error={error}>
            <PrimaryButton
              busy={busy}
              disabled={!input || !preview.current || count === 0}
              onClick={() => input && void run(input)}
            >
              {count ? g.start[mode](chosen.name, count) : g.plain[mode]}
            </PrimaryButton>
          </SheetFooter>
        </>
      ) : (
        <SheetBody footer={false}>
          <TagPicker
            mode={mode}
            text={text}
            onText={setText}
            tags={tags.data}
            loading={tags.isLoading}
            failed={tags.error != null && !tags.data}
            onRetry={() => void tags.mutate()}
            readers={readers}
            onPick={(tag) => {
              setError(null);
              setChosen(tag);
            }}
          />
        </SheetBody>
      )}
    </>
  );
}

function TagPicker({
  mode,
  text,
  onText,
  tags,
  loading,
  failed,
  onRetry,
  readers,
  onPick,
}: {
  mode: TagMode;
  text: string;
  onText: (text: string) => void;
  tags: TermOption[] | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  readers: (id: number) => string[];
  onPick: (tag: ChosenTag) => void;
}) {
  const { t } = useI18n();
  const g = t.vetrinaCatalog.act.tag;
  const typed = text.trim().replace(/\s+/g, " ");
  const known = React.useMemo(() => tags ?? [], [tags]);
  const exact = typed ? sameName(known, typed) : undefined;
  // A name the store does not have: offered as a new tag, only when adding.
  const creatable = mode === "add" && typed !== "" && !exact;
  const found = React.useMemo(
    () => known.filter((tag) => matches(tag.name, typed)).sort((a, b) => collator.compare(a.name, b.name)),
    [known, typed],
  );

  const pickTyped = () => {
    if (exact) onPick({ id: exact.id, name: exact.name });
    else if (creatable) onPick({ name: typed });
  };

  return (
    <>
      <SheetSearch value={text} onChange={onText} placeholder={g.search[mode]} onSubmit={pickTyped} />
      {failed ? (
        <FailedCard message={g.failed} onRetry={onRetry} />
      ) : loading && !tags ? (
        <LoadingRows label={g.loading} />
      ) : (
        <>
          {(creatable || found.length > 0) && (
            <PickList label={g.title}>
              {creatable && (
                <PickRow
                  media={
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-primary">
                      <Plus className="h-[18px] w-[18px]" />
                    </span>
                  }
                  title={<span className="text-primary">{g.create(typed)}</span>}
                  subtitle={g.createHint}
                  onPick={() => onPick({ name: typed })}
                />
              )}
              {found.slice(0, MAX_ROWS).map((tag) => {
                const by = readers(tag.id);
                return (
                  <PickRow
                    key={tag.id}
                    media={<TagBadge />}
                    title={tag.name}
                    subtitle={by.length > 0 ? g.readBy(by) : undefined}
                    onPick={() => onPick({ id: tag.id, name: tag.name })}
                  />
                );
              })}
            </PickList>
          )}
          {found.length > MAX_ROWS && (
            <p className="px-1 text-center text-[13px] opacity-60">{g.more(found.length - MAX_ROWS)}</p>
          )}
          {!creatable && found.length === 0 && (
            <p className="px-1 py-6 text-center text-[15px] opacity-60">{known.length === 0 ? g.empty : g.none}</p>
          )}
        </>
      )}
    </>
  );
}

function TagBadge() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/[0.06] dark:bg-white/10">
      <Tag className="h-[18px] w-[18px] opacity-70" />
    </span>
  );
}
