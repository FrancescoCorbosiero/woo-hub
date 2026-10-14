"use client";

import * as React from "react";
import { Button, Preloader } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import type { ProductTagsView } from "@/lib/collections/types";
import { loadProductTags, saveProductTags } from "@/server/actions/collections";
import { HEADING, ROW, ROW_INNER, ROWS, SHEET_CARD } from "./catalog/sheet/look";
import { Close } from "./icons";

/**
 * A product's tags, in its sheet: the convenient way to move it in and out
 * of the automatic categories without leaving the phone. The tags are saved
 * on the store, the product is decided at once, and the sheet says which
 * sections it joined or left. Drawn as one of the sheet's grouped cards
 * (./catalog/sheet/look.ts): the chips, the field to add one, and the
 * automatic categories reading them, each a row.
 */

type Chip = { id?: number; name: string };

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const signature = (chips: Chip[]) =>
  chips
    .map((c) => c.name.trim().toLowerCase())
    .sort()
    .join("\n");

export function TagsSection({ productId, onChanged }: { productId: number; onChanged: () => void }) {
  const { t } = useI18n();
  const tg = t.vetrina.tags;
  const [view, setView] = React.useState<ProductTagsView | null | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);
  const [chips, setChips] = React.useState<Chip[]>([]);
  const [typed, setTyped] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const listId = React.useId();

  const load = React.useCallback(async () => {
    setView(undefined);
    setError(null);
    const res = await loadProductTags({ productId });
    if (!res.ok) {
      setError(res.error);
      setView(null);
      return;
    }
    setView(res.data);
    setChips(res.data.tags.map((x) => ({ id: x.id, name: x.name })));
  }, [productId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (view === undefined) {
    // The card's shape while it loads, so the sheet does not jump when the tags arrive.
    return (
      <div aria-busy aria-label={tg.loading}>
        <span className={HEADING}>{tg.title}</span>
        <ul className={`${SHEET_CARD} ${ROWS}`}>
          <li className={ROW}>
            <div className={`${ROW_INNER} py-2.5`}>
              <span className="flex h-10 items-center gap-2 text-[14px] opacity-60">
                <Preloader className="!h-4 !w-4" />
                {tg.loading}
              </span>
            </div>
          </li>
          <li className={ROW}>
            <div className={`${ROW_INNER} py-2 !pe-2`}>
              <span className="block h-11 rounded-xl bg-black/[0.03] dark:bg-white/10" />
            </div>
          </li>
        </ul>
        <p className="mt-1.5 px-1 text-[12px] opacity-50">{tg.hint}</p>
      </div>
    );
  }
  if (view === null) {
    return (
      <div>
        <span className={HEADING}>{tg.title}</span>
        <p className={`${SHEET_CARD} p-4 text-[14px] leading-snug text-black/70 dark:text-white/70`}>{error}</p>
      </div>
    );
  }

  const dirty = signature(chips) !== signature(view.tags);

  function add() {
    const name = typed.trim();
    if (!name) return;
    setTyped("");
    if (chips.some((c) => sameName(c.name, name))) return;
    const known = view?.available.find((x) => sameName(x.name, name));
    setChips((prev) => [...prev, known ? { id: known.id, name: known.name } : { name }]);
  }

  async function save() {
    setSaving(true);
    try {
      // Only the change: a tag a bulk "Tag +" put on the product since the sheet opened stays.
      const res = await saveProductTags({ productId, tags: chips, base: view!.tags.map((x) => x.id) });
      if (!res.ok) {
        toast.error(`${tg.failed}: ${res.error}`);
        return;
      }
      const { joined, left, pending, error: refused } = res.data;
      if (refused) toast.error(tg.refused(refused));
      else if (pending) toast(tg.pending);
      else {
        const said = [joined.length ? tg.joined(joined.join(", ")) : "", left.length ? tg.left(left.join(", ")) : ""]
          .filter(Boolean)
          .join(" · ");
        toast.success(said || tg.saved);
      }
      await load();
      if (joined.length > 0 || left.length > 0 || pending) onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <span className={HEADING}>{tg.title}</span>
      <ul className={`${SHEET_CARD} ${ROWS}`}>
        <li className={ROW}>
          <div className={`${ROW_INNER} py-2.5`}>
            {chips.length === 0 ? (
              <p className="py-1.5 text-[15px] leading-6 opacity-50">{tg.none}</p>
            ) : (
              <ul className="flex flex-wrap gap-2 py-1">
                {chips.map((chip) => (
                  <li
                    key={chip.name.toLowerCase()}
                    className="inline-flex h-8 items-center gap-0.5 rounded-full bg-black/[0.06] pe-0.5 ps-3 text-[14px] dark:bg-white/15"
                  >
                    {chip.name}
                    {/* 28px drawn, 44px to the finger. */}
                    <button
                      type="button"
                      aria-label={tg.remove(chip.name)}
                      onClick={() => setChips((prev) => prev.filter((c) => c !== chip))}
                      className="relative grid h-7 w-7 place-items-center rounded-full opacity-50 before:absolute before:-inset-2 active:opacity-30"
                    >
                      <Close className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
        <li className={ROW}>
          <div className={`${ROW_INNER} flex items-center gap-2 py-2 !pe-2`}>
            <input
              list={listId}
              value={typed}
              placeholder={tg.placeholder}
              aria-label={tg.placeholder}
              autoCapitalize="none"
              enterKeyHint="done"
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              className="h-11 min-w-0 flex-1 rounded-xl border border-black/10 bg-black/[0.03] px-3 text-[16px] outline-none placeholder:opacity-40 focus:border-black/30 dark:border-white/15 dark:bg-white/10"
            />
            <datalist id={listId}>
              {view.available
                .filter((x) => !chips.some((c) => sameName(c.name, x.name)))
                .map((x) => (
                  <option key={x.id} value={x.name} />
                ))}
            </datalist>
            <Button rounded tonal inline disabled={!typed.trim()} onClick={add} className="!h-11 shrink-0 !px-4">
              {tg.add}
            </Button>
          </div>
        </li>
        {view.inCollections.length > 0 && (
          <li className={ROW}>
            <p className={`${ROW_INNER} py-3 text-[13px] leading-snug text-black/55 dark:text-white/55`}>
              {tg.inCollections(view.inCollections.join(", "))}
            </p>
          </li>
        )}
      </ul>
      <p className="mt-1.5 px-1 text-[12px] opacity-50">{tg.hint}</p>
      {dirty && (
        <Button
          large
          rounded
          className="mt-3"
          disabled={saving}
          onClick={() => void save()}
          colors={{ fillTextIos: "text-white dark:text-black", fillTextMaterial: "text-white dark:text-black" }}
        >
          {saving ? tg.saving : tg.save}
        </Button>
      )}
    </div>
  );
}
