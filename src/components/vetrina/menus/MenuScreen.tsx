"use client";

import * as React from "react";
import { Actions, ActionsButton, ActionsGroup, ActionsLabel, Button, Dialog, DialogButton, List, ListItem, Navbar, NavbarBackLink, Page, Preloader } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { movesOf } from "@/lib/menus/moves";
import { childrenOf, layoutOf, rowsOf, type Row } from "@/lib/menus/plan";
import type { Menu, MenuItem, MenuTarget } from "@/lib/menus/types";
import type { VetrinaResult } from "@/server/vetrina/service";
import { ActivityLink } from "../catalog/act/ActivityLink";
import { FILL } from "../catalog/act/parts";
import { Plus } from "../catalog/act/icons";
import { TabbarSpacer } from "../catalog/TabbarSpacer";
import { ErrorState } from "../ErrorState";
import { More } from "../icons";
import { useBack } from "../use-back";
import { AddItemsSheet, type AddRequest } from "./AddItemsSheet";
import { ItemBadge } from "./parts";
import { RenameSheet, type RenameRequest } from "./RenameSheet";
import { useMenuWrites } from "./use-menu-writes";

/**
 * One menu of the site: its items top to bottom, each under its parent, as
 * the theme shows them — and the owner's to arrange: "Aggiungi voci" (the
 * shop's categories and brands, the site's pages, a link), and each item's
 * "⋯" — up, down, under the item above, out of its parent, items under it,
 * its name, taking it away. Each is written at once, with "Annulla".
 */

export interface MenuScreenData {
  menu: Menu;
  /** The menu's fingerprint as read: each write is refused if the menu changed since. */
  digest: string;
}

const targetKey = (target: MenuTarget) => (target.kind === "link" ? `link:${target.url}` : target.kind === "other" ? "" : `${target.kind}:${target.id}`);

export function MenuScreen({ result }: { result: VetrinaResult<MenuScreenData> }) {
  const { t, locale } = useI18n();
  const m = t.vetrinaCatalog.menus;
  const back = useBack("/vetrina/menu");
  const writes = useMenuWrites();
  const data = result.ok ? result.data : null;
  const list = new Intl.ListFormat(locale === "en" ? "en-GB" : "it-IT", { style: "long", type: "conjunction" });

  const layout = React.useMemo(() => (data ? layoutOf(data.menu.items) : new Map()), [data]);
  const rows = React.useMemo(() => rowsOf(layout), [layout]);
  const byId = React.useMemo(() => new Map((data?.menu.items ?? []).map((i) => [i.id, i])), [data]);
  const present = React.useMemo(() => new Set((data?.menu.items ?? []).map((i) => targetKey(i.target)).filter(Boolean)), [data]);

  const [actionsFor, setActionsFor] = React.useState<MenuItem | null>(null);
  const [removing, setRemoving] = React.useState<MenuItem | null>(null);
  const [adding, setAdding] = React.useState<AddRequest | null>(null);
  const [renaming, setRenaming] = React.useState<RenameRequest | null>(null);
  const [busy, setBusy] = React.useState(false);

  const subtitle = data ? (data.menu.locations.length > 0 ? m.shownIn(list.format(data.menu.locations.map((l) => l.name))) : m.shownNowhere) : undefined;

  async function write(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  function move(item: MenuItem, place: { parent: number; position: number | null }) {
    if (!data) return;
    setActionsFor(null);
    void write(() =>
      writes.run({ kind: "menuItemMove", menuId: data.menu.id, itemId: item.id, place, expected: { digest: data.digest } }, m.done.moved(item.title)),
    );
  }

  function addUnder(parent: MenuItem | null) {
    if (!data) return;
    setActionsFor(null);
    setAdding({ menuId: data.menu.id, digest: data.digest, parent: parent?.id ?? 0, parentTitle: parent?.title ?? null, present });
  }

  return (
    <Page>
      <Navbar
        title={data?.menu.name ?? m.title}
        subtitle={subtitle}
        titleClassName="truncate max-w-[calc(100%-176px)]"
        subtitleClassName="truncate"
        left={<NavbarBackLink onClick={back} text={m.back} />}
        right={<ActivityLink />}
      />
      {!result.ok ? (
        <div className="pt-3">
          <ErrorState code={result.code} error={result.error} words={m.errors} />
        </div>
      ) : (
        <div className="space-y-3 pt-3">
          <div className="px-4">
            <Button large rounded colors={FILL} onClick={() => addUnder(null)} disabled={busy} className="w-full gap-1.5">
              <Plus className="h-5 w-5" />
              {m.menu.add}
            </Button>
          </div>
          {rows.length === 0 ? (
            <p className="px-5 py-6 text-center text-[15px] opacity-60">{m.menu.emptyMenu}</p>
          ) : (
            <List strong inset dividers aria-label={data!.menu.name}>
              {rows.map((row: Row) => {
                const item = byId.get(row.id)!;
                return (
                  <ListItem
                    key={item.id}
                    media={
                      <span className="flex items-center" style={{ paddingInlineStart: `${row.depth * 20}px` }}>
                        <ItemBadge kind={item.target.kind} />
                      </span>
                    }
                    title={<span className={item.invalid ? "line-through opacity-50" : undefined}>{item.title}</span>}
                    subtitle={
                      item.invalid ? (
                        <span className="text-red-600 dark:text-red-400">{m.menu.invalid}</span>
                      ) : (
                        [m.menu.kinds[item.target.kind], item.target.kind === "link" ? item.target.url : item.label != null ? m.menu.renamed : ""].filter(Boolean).join(" · ")
                      )
                    }
                    after={
                      <button
                        type="button"
                        aria-label={m.menu.actionsFor(item.title)}
                        disabled={busy}
                        onClick={() => setActionsFor(item)}
                        className="-me-2 -my-[11px] grid h-11 w-11 place-items-center rounded-full active:bg-black/[0.06] disabled:opacity-40 dark:active:bg-white/10"
                      >
                        <More className="h-5 w-5" />
                      </button>
                    }
                  />
                );
              })}
            </List>
          )}
        </div>
      )}
      <TabbarSpacer />

      {data && (
        <ItemActions
          item={actionsFor}
          layout={layout}
          byId={byId}
          onClose={() => setActionsFor(null)}
          onMove={move}
          onAddUnder={addUnder}
          onRename={(item) => {
            setActionsFor(null);
            setRenaming({ menuId: data.menu.id, digest: data.digest, item });
          }}
          onRemove={(item) => {
            setActionsFor(null);
            setRemoving(item);
          }}
        />
      )}
      <Dialog
        opened={removing != null}
        onBackdropClick={() => setRemoving(null)}
        title={m.remove.title}
        content={removing ? m.remove.confirm(removing.title, childrenOf(layout, removing.id).length) : ""}
        buttons={
          <>
            <DialogButton onClick={() => setRemoving(null)}>{m.remove.no}</DialogButton>
            <DialogButton
              strong
              className="!text-red-600 dark:!text-red-500"
              onClick={() => {
                const item = removing;
                setRemoving(null);
                if (item && data) {
                  void write(() =>
                    writes.run({ kind: "menuItemRemove", menuId: data.menu.id, itemId: item.id, expected: { digest: data.digest } }, m.done.removed(item.title)),
                  );
                }
              }}
            >
              {m.remove.yes}
            </DialogButton>
          </>
        }
      />
      <AddItemsSheet request={adding} onClose={() => setAdding(null)} />
      <RenameSheet request={renaming} onClose={() => setRenaming(null)} />
    </Page>
  );
}

/** An item's "⋯": its one-tap moves, items under it, its name, the site, taking it away. */
function ItemActions({
  item,
  layout,
  byId,
  onClose,
  onMove,
  onAddUnder,
  onRename,
  onRemove,
}: {
  item: MenuItem | null;
  layout: ReturnType<typeof layoutOf>;
  byId: ReadonlyMap<number, MenuItem>;
  onClose: () => void;
  onMove: (item: MenuItem, place: { parent: number; position: number | null }) => void;
  onAddUnder: (item: MenuItem) => void;
  onRename: (item: MenuItem) => void;
  onRemove: (item: MenuItem) => void;
}) {
  const { t } = useI18n();
  const a = t.vetrinaCatalog.menus.actions;
  const [shown, setShown] = React.useState(item);
  if (item != null && item !== shown) setShown(item);
  const current = item ?? shown;
  const moves = current ? movesOf(layout, current.id) : null;
  const titleOf = (id: number) => byId.get(id)?.title ?? "";
  const opens = current != null && current.url !== "" && !current.url.startsWith("#");

  return (
    <Actions opened={item != null} onBackdropClick={onClose}>
      <ActionsGroup>
        <ActionsLabel>{current?.title ?? ""}</ActionsLabel>
        {current && moves?.up && <ActionsButton onClick={() => onMove(current, moves.up!)}>{a.moveUp}</ActionsButton>}
        {current && moves?.down && <ActionsButton onClick={() => onMove(current, moves.down!)}>{a.moveDown}</ActionsButton>}
        {current && moves?.indent && <ActionsButton onClick={() => onMove(current, moves.indent!)}>{a.indent(titleOf(moves.indent.parent))}</ActionsButton>}
        {current && moves?.outdent && <ActionsButton onClick={() => onMove(current, moves.outdent!)}>{a.outdent(titleOf(current.parent))}</ActionsButton>}
        {current && <ActionsButton onClick={() => onAddUnder(current)}>{a.addBelow}</ActionsButton>}
        {current && <ActionsButton onClick={() => onRename(current)}>{a.rename}</ActionsButton>}
        {opens && (
          <ActionsButton
            onClick={() => {
              onClose();
              window.open(current.url, "_blank", "noreferrer");
            }}
          >
            {a.open}
          </ActionsButton>
        )}
      </ActionsGroup>
      {current && (
        <ActionsGroup>
          <ActionsButton
            colors={{ textIos: "text-red-600 dark:text-red-500", textMaterial: "text-red-600 dark:text-red-400" }}
            onClick={() => onRemove(current)}
          >
            {a.remove}
          </ActionsButton>
        </ActionsGroup>
      )}
      <ActionsGroup>
        <ActionsButton bold onClick={onClose}>
          {a.cancel}
        </ActionsButton>
      </ActionsGroup>
    </Actions>
  );
}

/** A menu while WordPress answers: its navbar's way back already there. */
export function MenuScreenSkeleton() {
  const { t } = useI18n();
  const back = useBack("/vetrina/menu");
  return (
    <Page>
      <Navbar left={<NavbarBackLink onClick={back} text={t.vetrinaCatalog.menus.back} />} />
      <div className="grid place-items-center pt-24">
        <Preloader className="!h-8 !w-8" />
      </div>
    </Page>
  );
}
