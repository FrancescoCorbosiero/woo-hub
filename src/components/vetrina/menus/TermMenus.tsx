"use client";

import * as React from "react";
import useSWR from "swr";
import { ListItem } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { layoutOf, rowsOf } from "@/lib/menus/plan";
import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import type { TermInMenus } from "@/server/api/menus";
import { loadMenuForAdd, loadTermInMenus } from "@/server/actions/vetrina-menus";
import { ActSheetFrame, FailedCard, LoadingRows, PickList, PickRow, SheetBody, SheetHead, useLastShown } from "../catalog/act/parts";
import { useAppLink } from "../catalog/term/browse";
import { PanelIcon } from "../catalog/term/PanelIcon";
import { MenuGlyph } from "./parts";
import { useMenuWrites } from "./use-menu-writes";

/**
 * A category's or a brand's place in the site's menus, on its screen in the
 * catalog: each menu item leading to it (a tap opens that menu), or that it
 * is in none — and "Aggiungi al menu": a menu, then where in it. Read after
 * the screen, so WordPress never slows the catalog down; nothing is shown
 * when the menus are not connected.
 */

export interface TermRef {
  taxonomy: CatalogTaxonomy;
  id: number;
  name: string;
}

// Read again on each visit (a change made from the Menu tab shows here at once), deduped across the panel and the "⋯".
const SWR_OPTIONS = { revalidateOnFocus: false, dedupingInterval: 5_000, shouldRetryOnError: false } as const;

async function fetchTermMenus([, kind, id]: readonly [string, CatalogTaxonomy, number]): Promise<TermInMenus | null> {
  const res = await loadTermInMenus({ kind, id });
  // Without WordPress's access the catalog simply has no menu rows.
  if (!res.ok) {
    if (res.code === "not_configured") return null;
    throw new Error(res.error || res.code);
  }
  return res.data;
}

/** The term's place in the menus, read once a while: null when the menus are not connected. */
export function useTermMenus(term: Pick<TermRef, "taxonomy" | "id">) {
  return useSWR(["vetrina:term-menus", term.taxonomy, term.id] as const, fetchTermMenus, SWR_OPTIONS);
}

/** The panel's rows: where it is in the menus, or that it is in none (with "Aggiungi"). Nothing while unknown. */
export function TermMenuRows({ term, onAdd }: { term: TermRef; onAdd: () => void }) {
  const { t } = useI18n();
  const w = t.vetrinaCatalog.menus.term;
  const appLink = useAppLink();
  const { data } = useTermMenus(term);
  if (!data) return null;
  if (data.found.length === 0) {
    return (
      <ListItem
        link
        linkComponent="button"
        linkProps={{ type: "button", onClick: onAdd }}
        contentClassName="w-full text-start"
        media={
          <PanelIcon tone="muted">
            <MenuGlyph className="h-[18px] w-[18px]" />
          </PanelIcon>
        }
        title={<span className="opacity-50">{w.notInMenus}</span>}
        text={w.addHint}
      />
    );
  }
  return (
    <>
      {data.found.map((place) => (
        <ListItem
          key={place.itemId}
          link
          linkProps={appLink(`/vetrina/menu/${place.menuId}`)}
          media={
            <PanelIcon tone={place.shown ? "ink" : "muted"}>
              <MenuGlyph className="h-[18px] w-[18px]" />
            </PanelIcon>
          }
          title={<span className="line-clamp-2">{w.inMenu(place.menu, place.parent)}</span>}
          text={place.shown ? undefined : w.notShown}
        />
      ))}
    </>
  );
}

/* ---------------------------------------------------------------- *
 * "Aggiungi al menu"
 * ---------------------------------------------------------------- */

export function AddToMenuSheet({ term, open, onClose }: { term: TermRef; open: boolean; onClose: () => void }) {
  const shown = useLastShown(open ? term : null);
  return (
    <ActSheetFrame open={open} onClose={onClose}>
      {shown && <AddToMenuContent key={`${shown.taxonomy}:${shown.id}`} term={shown} onClose={onClose} />}
    </ActSheetFrame>
  );
}

function AddToMenuContent({ term, onClose }: { term: TermRef; onClose: () => void }) {
  const { t } = useI18n();
  const w = t.vetrinaCatalog.menus.term;
  const menus = useTermMenus(term);
  const [picked, setPicked] = React.useState<number | null>(null);
  // One menu only: straight to where in it.
  const only = menus.data && menus.data.menus.length === 1 ? menus.data.menus[0].id : null;
  const menuId = picked ?? only;

  return (
    <>
      <SheetHead title={w.sheetTitle(term.name)} subtitle={menuId == null ? w.pickMenu : w.pickPlace} onClose={onClose} />
      <SheetBody>
        {menus.error != null && !menus.data ? (
          <FailedCard message={t.vetrinaCatalog.menus.add.failed} onRetry={() => void menus.mutate()} />
        ) : !menus.data ? (
          <LoadingRows label={t.vetrinaCatalog.menus.add.loading} />
        ) : menuId == null ? (
          <PickList label={w.pickMenu}>
            {menus.data.menus.map((menu) => {
              const there = menus.data!.found.some((f) => f.menuId === menu.id);
              return (
                <PickRow
                  key={menu.id}
                  media={<MenuBadge />}
                  title={menu.name}
                  subtitle={[menu.shown ? w.shown : w.hidden, there ? w.there : ""].filter(Boolean).join(" · ")}
                  onPick={() => setPicked(menu.id)}
                />
              );
            })}
          </PickList>
        ) : (
          <PlaceRows term={term} menuId={menuId} onDone={onClose} onBack={only == null ? () => setPicked(null) : undefined} />
        )}
      </SheetBody>
    </>
  );
}

/** Where in the menu: at its bottom, or under one of its items, at the end of that item's own. */
function PlaceRows({ term, menuId, onDone, onBack }: { term: TermRef; menuId: number; onDone: () => void; onBack?: () => void }) {
  const { t } = useI18n();
  const m = t.vetrinaCatalog.menus;
  const w = m.term;
  const writes = useMenuWrites();
  const termMenus = useTermMenus(term);
  const read = useSWR(["vetrina:menu-for-add", menuId] as const, async ([, id]) => {
    const res = await loadMenuForAdd(id);
    if (!res.ok) throw new Error(res.error || res.code);
    return res.data;
  });
  const [busy, setBusy] = React.useState(false);
  const rows = React.useMemo(() => (read.data ? rowsOf(layoutOf(read.data.menu.items)) : []), [read.data]);
  const byId = React.useMemo(() => new Map((read.data?.menu.items ?? []).map((i) => [i.id, i])), [read.data]);

  async function add(parent: number) {
    if (!read.data || busy) return;
    setBusy(true);
    const written = await writes.run(
      { kind: "menuItemAdd", menuId, items: [{ kind: term.taxonomy, id: term.id }], place: { parent }, expected: { digest: read.data.digest } },
      w.added(term.name, read.data.menu.name),
      { afterUndo: () => void termMenus.mutate() },
    );
    setBusy(false);
    if (!written) return;
    void termMenus.mutate();
    onDone();
  }

  if (read.error != null && !read.data) return <FailedCard message={m.add.failed} onRetry={() => void read.mutate()} />;
  if (!read.data) return <LoadingRows label={m.add.loading} />;
  return (
    <div className="space-y-3">
      <PickList label={w.pickPlace}>
        <PickRow chevron={false} media={<MenuBadge />} title={w.end} subtitle={read.data.menu.name} onPick={() => void add(0)} disabled={busy} />
        {rows.map((row) => {
          const item = byId.get(row.id)!;
          return (
            <PickRow
              key={row.id}
              chevron={false}
              media={<span style={{ paddingInlineStart: `${row.depth * 16}px` }} className="flex"><MenuBadge /></span>}
              title={w.under(item.title)}
              onPick={() => void add(row.id)}
              disabled={busy}
            />
          );
        })}
      </PickList>
      {onBack && (
        <button type="button" onClick={onBack} className="w-full py-2 text-center text-[15px] text-primary">
          {w.otherMenu}
        </button>
      )}
    </div>
  );
}

function MenuBadge() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/[0.06] dark:bg-white/10">
      <MenuGlyph className="h-[18px] w-[18px] opacity-70" />
    </span>
  );
}
