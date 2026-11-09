"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/provider";
import type { MenuSummary } from "@/lib/menus/types";
import { ActSheetFrame, PickList, PickRow, PrimaryButton, SheetBody, SheetFooter, SheetHead, useLastShown } from "../catalog/act/parts";
import { Check } from "../catalog/term/glyphs";
import { ItemBadge, TextField } from "./parts";
import { useMenuWrites } from "./use-menu-writes";

/**
 * A whole menu's name: "Nuovo menu" — empty, or a copy of a menu to rework
 * before the site shows it — and "Rinomina il menu". A new menu opens at
 * once; the site shows it only once it is put in a place of the theme. One
 * write each, with "Annulla".
 */

export interface NewMenuRequest {
  /** The menus it may start as a copy of. */
  menus: Pick<MenuSummary, "id" | "name" | "count">[];
  /** The one it starts as a copy of ("Duplica"); null: empty, unless picked. */
  copyOf: number | null;
}

export function NewMenuSheet({ request, onClose }: { request: NewMenuRequest | null; onClose: () => void }) {
  const shown = useLastShown(request);
  return (
    <ActSheetFrame open={request != null} onClose={onClose} detent="content">
      {shown && <NewMenuContent key={shown.copyOf ?? 0} request={shown} onClose={onClose} />}
    </ActSheetFrame>
  );
}

function NewMenuContent({ request, onClose }: { request: NewMenuRequest; onClose: () => void }) {
  const { t } = useI18n();
  const m = t.vetrinaCatalog.menus;
  const c = m.create;
  const router = useRouter();
  const writes = useMenuWrites();
  const copied = request.menus.find((menu) => menu.id === request.copyOf) ?? null;
  const [name, setName] = React.useState(copied ? c.copyName(copied.name) : "");
  const [from, setFrom] = React.useState<number | null>(request.copyOf);
  const [busy, setBusy] = React.useState(false);
  const [tried, setTried] = React.useState(false);

  async function create() {
    if (name.trim() === "") {
      setTried(true);
      return;
    }
    setBusy(true);
    const written = await writes.run({ kind: "menuCreate", name: name.trim(), copyOf: from }, m.done.created(name.trim()));
    setBusy(false);
    if (!written) return;
    onClose();
    if (written.menuId != null) router.push(`/vetrina/menu/${written.menuId}`);
  }

  return (
    <>
      <SheetHead title={copied ? c.copyTitle(copied.name) : c.title} subtitle={c.notShown} onClose={onClose} />
      <SheetBody>
        <TextField label={c.name} value={name} onChange={setName} hint={c.nameHint} problem={tried && name.trim() === "" ? c.needName : null} autoFocus />
        {/* "Duplica" starts from its menu: the choice is "Nuovo menu"'s. */}
        {!copied && request.menus.length > 0 && (
          <PickList label={c.start}>
            <PickRow
              chevron={false}
              media={<ItemBadge kind="new" />}
              title={c.empty}
              after={from == null ? <Check className="h-5 w-5 text-primary" /> : undefined}
              onPick={() => setFrom(null)}
            />
            {request.menus.map((menu) => (
              <PickRow
                key={menu.id}
                chevron={false}
                media={<ItemBadge kind="other" />}
                title={c.copyOf(menu.name)}
                subtitle={m.items(menu.count)}
                after={from === menu.id ? <Check className="h-5 w-5 text-primary" /> : undefined}
                onPick={() => setFrom(menu.id)}
              />
            ))}
          </PickList>
        )}
      </SheetBody>
      <SheetFooter>
        <PrimaryButton onClick={() => void create()} busy={busy}>
          {c.button}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}

export interface RenameMenuRequest {
  menuId: number;
  name: string;
}

export function RenameMenuSheet({ request, onClose }: { request: RenameMenuRequest | null; onClose: () => void }) {
  const shown = useLastShown(request);
  return (
    <ActSheetFrame open={request != null} onClose={onClose} detent="content">
      {shown && <RenameMenuContent key={shown.menuId} request={shown} onClose={onClose} />}
    </ActSheetFrame>
  );
}

function RenameMenuContent({ request, onClose }: { request: RenameMenuRequest; onClose: () => void }) {
  const { t } = useI18n();
  const m = t.vetrinaCatalog.menus;
  const writes = useMenuWrites();
  const [name, setName] = React.useState(request.name);
  const [busy, setBusy] = React.useState(false);
  const [tried, setTried] = React.useState(false);

  async function save() {
    if (name.trim() === "") {
      setTried(true);
      return;
    }
    setBusy(true);
    const written = await writes.run({ kind: "menuRename", menuId: request.menuId, name: name.trim() }, m.done.menuRenamed(name.trim()));
    setBusy(false);
    if (written) onClose();
  }

  return (
    <>
      <SheetHead title={m.renameMenu.title} onClose={onClose} />
      <SheetBody>
        <TextField label={m.renameMenu.label} value={name} onChange={setName} hint={m.create.nameHint} problem={tried && name.trim() === "" ? m.create.needName : null} autoFocus />
      </SheetBody>
      <SheetFooter>
        <PrimaryButton onClick={() => void save()} busy={busy} disabled={name.trim() === request.name}>
          {m.renameMenu.save}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}
